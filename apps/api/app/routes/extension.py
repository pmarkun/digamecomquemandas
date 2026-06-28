from urllib.parse import urlparse
from uuid import UUID
from math import isfinite

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session, and_, select

from ..config import get_settings
from ..db import get_session
from ..models import (
    AllowedDomain,
    Article,
    ArticleImage,
    DetectedFace,
    FaceEmbedding,
    FaceMatch,
    FaceSuggestion,
    Person,
    PersonReferenceImage,
)
from ..services.face_detector import detect_faces
from ..services.article_image_discovery import discover_article_images
from ..services.image_fetcher import fetch_image
from ..services.match import cosine, match_candidates, normalize_embedding
from ..services.privacy import hash_sha256, ensure_domain
from ..services.audit import write_action
from ..schemas import (
    AnalyzeImageOut,
    AnalyzePageRequest,
    AnalyzePageResponse,
    ArticleImageCandidate,
    BBox,
    DebugPersonScoreOut,
    DiscoverArticleImagesRequest,
    DiscoverArticleImagesResponse,
    FaceOut,
    IgnoredArticleImageCandidate,
    MatchOut,
    SuggestionCreate,
)

router = APIRouter()


def _as_uuid(value: str) -> UUID:
    try:
        return UUID(value)
    except ValueError:
        raise HTTPException(status_code=400, detail="UUID inválido") from None


def _ensure_allowed_domain(session: Session, domain: str) -> bool:
    settings = get_settings()
    normalized = domain.replace("www.", "").lower()
    if normalized in settings.allowed_domains:
        return True

    db_domains = session.exec(
        select(AllowedDomain).where(AllowedDomain.enabled == True)  # noqa: E712
    ).all()
    return any(item.domain.replace("www.", "").lower() == normalized for item in db_domains)


def _is_allowed(session: Session, page_url: str) -> bool:
    return _ensure_allowed_domain(session, urlparse(page_url).netloc)


def _clamp_face(face, width: int | None, height: int | None) -> dict | None:
    image_width = width or 0
    image_height = height or 0
    values = [face.x, face.y, face.w, face.h]
    if not all(isfinite(value) for value in values):
        return None

    x = max(0.0, min(float(face.x), float(image_width)))
    y = max(0.0, min(float(face.y), float(image_height)))
    w = max(0.0, min(float(face.w), float(image_width) - x))
    h = max(0.0, min(float(face.h), float(image_height) - y))

    if w < 24 or h < 24:
        return None

    return {
        "bbox": {"x": x, "y": y, "w": w, "h": h},
        "quality_score": face.score if face.score is not None and isfinite(face.score) else None,
        "embedding": normalize_embedding(face.embedding),
        "embedding_model": face.embedding_model or "face-api.js",
    }


def _faces_for_image(item, image: ArticleImage) -> list[dict]:
    if item.faces is not None:
        return [
            normalized
            for face in item.faces
            if (normalized := _clamp_face(face, image.width, image.height)) is not None
        ]

    return [
        {"bbox": vars(face.bbox), "quality_score": None}
        for face in detect_faces(image.width, image.height)
    ]


def _serialize_face(session: Session, detected: DetectedFace, person_map: dict[str, Person]) -> FaceOut:
    settings = get_settings()
    faces_matches: list[MatchOut] = []

    for match in session.exec(
        select(FaceMatch)
        .where(FaceMatch.detected_face_id == detected.id)
        .order_by(FaceMatch.score.desc())
    ).all():
        if match.score < settings.face_display_threshold:
            continue

        person_obj = person_map.get(str(match.person_id))
        if person_obj is None:
            person_obj = session.get(Person, match.person_id)
            if not person_obj:
                continue
            person_map[str(match.person_id)] = person_obj

        faces_matches.append(
            MatchOut(
                person_id=str(person_obj.id),
                name=person_obj.name,
                slug=person_obj.slug,
                score=round(match.score, 4),
                profile_url=f"{settings.web_base_url.rstrip('/')}/pessoa/{person_obj.slug}",
                status=match.status,
            )
        )

    return FaceOut(
        face_id=str(detected.id),
        bbox=BBox(**detected.bbox),
        matches=faces_matches,
    )


def _is_active_person(person: Person | None) -> bool:
    return bool(person and str(person.status) not in {"OPTOUT_LIMITED", "REMOVED"})


def _should_auto_approve(candidates: list[dict]) -> bool:
    if not candidates:
        return False
    settings = get_settings()
    top = candidates[0]
    second_score = candidates[1]["score"] if len(candidates) > 1 else 0.0
    return (
        top["score"] >= settings.face_auto_approve_threshold
        and (top["score"] - second_score) >= settings.face_auto_approve_gap
    )


def _upsert_manual_match(session: Session, face: DetectedFace, person: Person) -> None:
    existing = session.exec(
        select(FaceMatch).where(
            FaceMatch.detected_face_id == face.id,
            FaceMatch.person_id == person.id,
        )
    ).first()
    if existing:
        existing.score = 1.0
        existing.distance = 0.0
        existing.status = "APPROVED_MANUAL"
        session.add(existing)
        return

    session.add(
        FaceMatch(
            detected_face_id=face.id,
            person_id=person.id,
            score=1.0,
            distance=0.0,
            status="APPROVED_MANUAL",
        )
    )


def promote_face_reference(session: Session, face: DetectedFace, person: Person) -> None:
    embedding = normalize_embedding(face.embedding)
    if embedding is None:
        return

    image = session.get(ArticleImage, face.article_image_id)
    source_url = f"{image.image_url if image else 'detected-face'}#face={face.id}"
    existing_ref = session.exec(
        select(PersonReferenceImage).where(
            PersonReferenceImage.person_id == person.id,
            PersonReferenceImage.source_url == source_url,
        )
    ).first()
    if existing_ref:
        existing_embedding = session.exec(
            select(FaceEmbedding).where(FaceEmbedding.reference_image_id == existing_ref.id)
        ).first()
        if existing_embedding:
            existing_embedding.embedding = embedding
            existing_embedding.embedding_vector = embedding
            existing_embedding.model_name = face.model_name
            existing_embedding.model_version = face.model_version
            existing_embedding.quality_score = face.quality_score
            session.add(existing_embedding)
        return

    ref = PersonReferenceImage(
        person_id=person.id,
        source_url=source_url,
        sha256=image.sha256 if image else None,
        phash=image.phash if image else None,
    )
    session.add(ref)
    session.flush()
    session.add(
        FaceEmbedding(
            person_id=person.id,
            reference_image_id=ref.id,
            embedding=embedding,
            embedding_vector=embedding,
            model_name=face.model_name,
            model_version=face.model_version,
            quality_score=face.quality_score,
        )
    )


@router.post("/extension/discover-article-images", response_model=DiscoverArticleImagesResponse)
def discover_images(payload: DiscoverArticleImagesRequest, session: Session = Depends(get_session)):
    if not _is_allowed(session, payload.page_url):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Domínio fora da allowlist; descoberta bloqueada.",
        )

    result = discover_article_images(
        payload.page_url,
        render_browser=payload.render_browser,
        max_images=payload.max_images,
    )
    return DiscoverArticleImagesResponse(
        page_url=result.page_url,
        title=result.title,
        images=[
            ArticleImageCandidate(
                image_url=image.image_url,
                width=image.width,
                height=image.height,
                alt=image.alt,
                source=image.source,
                score=round(image.score, 3),
            )
            for image in result.images
        ],
        ignored_images=[
            IgnoredArticleImageCandidate(
                image_url=image.image_url,
                width=image.width,
                height=image.height,
                alt=image.alt,
                source=image.source,
                score=round(image.score, 3),
                reason=image.reason,
            )
            for image in result.ignored_images
        ]
        if payload.debug
        else [],
        warnings=result.warnings,
    )


@router.get("/extension/debug/faces/{face_id}/people-scores", response_model=list[DebugPersonScoreOut])
def people_scores_for_face(
    face_id: str,
    query: str = Query(default="", max_length=120),
    session: Session = Depends(get_session),
):
    face = session.get(DetectedFace, _as_uuid(face_id))
    if not face:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Face não encontrada",
        )

    stmt = select(Person).where(Person.status == "ACTIVE")
    if query.strip():
        q = f"%{query.strip()}%"
        stmt = stmt.where(Person.name.ilike(q) | Person.display_name.ilike(q) | Person.slug.ilike(q))
    people = session.exec(stmt).all()[:12]
    embedding = normalize_embedding(face.embedding)
    warning = None if embedding else "Face sem embedding disponível para score."

    out: list[DebugPersonScoreOut] = []
    for person in people:
        score: float | None = None
        person_embeddings = session.exec(
            select(FaceEmbedding).where(FaceEmbedding.person_id == person.id)
        ).all()
        if embedding:
            scores = [
                cosine(embedding, normalized)
                for item in person_embeddings
                if (normalized := normalize_embedding(item.embedding)) is not None
            ]
            if scores:
                score = max(scores)

        out.append(
            DebugPersonScoreOut(
                person_id=str(person.id),
                name=person.display_name or person.name,
                slug=person.slug,
                score=round(score, 4) if score is not None else None,
                distance=round(1 - score, 4) if score is not None else None,
                status="DEBUG_SCORE" if score is not None else None,
                warning=warning if score is None else None,
            )
        )

    out.sort(key=lambda item: item.score if item.score is not None else -1, reverse=True)
    return out


@router.post("/extension/analyze-page", response_model=AnalyzePageResponse)
def analyze_page(payload: AnalyzePageRequest, session: Session = Depends(get_session)):
    warnings: list[str] = []
    if not _is_allowed(session, payload.page_url):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Domínio fora da allowlist; análise bloqueada.",
        )

    article = session.exec(select(Article).where(Article.url == payload.page_url)).first()
    if not article:
        article = Article(
            url=payload.page_url,
            domain=ensure_domain(payload.page_url),
            title=payload.title,
        )
        session.add(article)
        session.flush()

    results = []
    person_embeddings = session.exec(select(FaceEmbedding)).all()
    person_map: dict[str, Person] = {}

    for item in payload.images:
        fetched = fetch_image(item.image_url, item.width, item.height)
        image_hash = fetched.sha256 or hash_sha256(item.image_url)
        image = session.exec(
            select(ArticleImage).where(
                and_(ArticleImage.sha256 == image_hash, ArticleImage.article_id == article.id)
            )
        ).first()

        if not image:
            image = ArticleImage(
                article_id=article.id,
                image_url=item.image_url,
                sha256=image_hash,
                phash=fetched.phash,
                width=fetched.width or item.width,
                height=fetched.height or item.height,
            )
            session.add(image)
            session.flush()
            process_image = True
        else:
            process_image = False

        faces_payload: list[FaceOut] = []
        if process_image:
            if not fetched.ok:
                warnings.append(f"Imagem não baixada; usando metadados enviados: {item.image_url}")

            for face in _faces_for_image(item, image):
                embed = face.get("embedding")
                detected = DetectedFace(
                    article_image_id=image.id,
                    bbox=face["bbox"],
                    embedding=embed,
                    embedding_vector=embed,
                    quality_score=face["quality_score"],
                    model_name=face.get("embedding_model") or "face-api.js",
                    model_version="0.1",
                )
                session.add(detected)
                session.flush()

                candidate_matches = match_candidates(session, embed, person_embeddings) if embed else []
                auto_approve = _should_auto_approve(candidate_matches)
                for index, item_match in enumerate(candidate_matches):
                    person_key = str(item_match["person_id"])
                    person_obj = person_map.get(person_key)
                    if person_obj is None:
                        person_obj = session.get(Person, item_match["person_id"])
                        if person_obj:
                            person_map[person_key] = person_obj

                    if not _is_active_person(person_obj):
                        continue

                    m = FaceMatch(
                        detected_face_id=detected.id,
                        person_id=item_match["person_id"],
                        score=item_match["score"],
                        distance=item_match["distance"],
                        status="AUTO_APPROVED" if auto_approve and index == 0 else "AUTO",
                    )
                    session.add(m)

                faces_payload.append(_serialize_face(session, detected, person_map))
        else:
            for existing_face in session.exec(
                select(DetectedFace).where(DetectedFace.article_image_id == image.id)
            ).all():
                faces_payload.append(_serialize_face(session, existing_face, person_map))

        results.append(
            AnalyzeImageOut(
                image_url=item.image_url,
                image_id=str(image.id),
                faces=faces_payload,
            )
        )

        if not faces_payload:
            warnings.append(f"Imagem sem faces elegíveis: {item.image_url}")

    if not results:
        warnings.append("Nenhuma imagem elegível encontrada para análise.")

    session.commit()
    return AnalyzePageResponse(article_id=str(article.id), results=results, warnings=warnings)


@router.post("/extension/faces/{face_id}/suggestions")
def create_suggestion(
    face_id: str,
    payload: SuggestionCreate,
    session: Session = Depends(get_session),
):
    face = session.get(DetectedFace, _as_uuid(face_id))
    if not face:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Face não encontrada",
        )

    suggestion = FaceSuggestion(
        detected_face_id=face.id,
        suggested_name=payload.suggested_name,
        suggested_person_id=payload.suggested_person_id,
        source_url=payload.source_url,
        comment=payload.comment,
        submitter_email=payload.submitter_email,
    )
    session.add(suggestion)
    write_action(
        session,
        actor_type="public",
        actor_id=None,
        action="create_suggestion",
        entity_type="face_suggestion",
        entity_id=suggestion.id,
        metadata={"face_id": face_id},
    )
    session.commit()
    return {"ok": True, "id": str(suggestion.id), "status": "PENDING_REVIEW"}
