from urllib.parse import urlparse
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
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
)
from ..services.face_detector import detect_faces
from ..services.match import embedding_from_seed, match_candidates
from ..services.privacy import hash_sha256, ensure_domain
from ..services.audit import write_action
from ..schemas import (
    AnalyzeImageOut,
    AnalyzePageRequest,
    AnalyzePageResponse,
    BBox,
    FaceOut,
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
        image_hash = hash_sha256(item.image_url)
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
                width=item.width,
                height=item.height,
            )
            session.add(image)
            session.flush()
            process_image = True
        else:
            process_image = False

        faces_payload: list[FaceOut] = []
        if process_image:
            for face in detect_faces(item.width, item.height):
                embed = embedding_from_seed(item.image_url)
                detected = DetectedFace(article_image_id=image.id, bbox=vars(face.bbox), embedding=embed)
                session.add(detected)
                session.flush()

                for item_match in match_candidates(embed, person_embeddings):
                    person_key = str(item_match["person_id"])
                    person_obj = person_map.get(person_key)
                    if person_obj is None:
                        person_obj = session.get(Person, item_match["person_id"])
                        if person_obj:
                            person_map[person_key] = person_obj

                    if person_obj and str(person_obj.status) in {"OPTOUT_LIMITED", "REMOVED"}:
                        continue

                    m = FaceMatch(
                        detected_face_id=detected.id,
                        person_id=item_match["person_id"],
                        score=item_match["score"],
                        distance=item_match["distance"],
                        status=item_match["status"],
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
