from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Header, HTTPException
from collections import defaultdict
from hashlib import sha256
import re
import unicodedata
from typing import Final
from uuid import UUID
from sqlmodel import Session, select

from ..config import get_settings
from ..db import get_session
from ..models import (
    AllowedDomain,
    OptoutRequest,
    AuditLog,
    BootstrapRun,
    BootstrapRunArticle,
    FaceMatch,
    FaceSuggestion,
    Article,
    ArticleImage,
    Person,
    PersonReferenceImage,
    DetectedFace,
    FaceEmbedding,
)
from ..schemas import (
    AdminAddFacesIn,
    BootstrapLabelGroupIn,
    BootstrapRunArticleAttach,
    BootstrapRunCreate,
    LoginIn,
    LoginOut,
    MatchReassignIn,
    MatchReviewIn,
    PersonCreate,
    PersonUpdate,
    ReferenceImageIn,
    ReferenceImageOut,
)
from ..services.audit import write_action
from ..services.bootstrap_discovery import POLITICS_SOURCES, discover_politics_articles
from ..services.image_fetcher import fetch_image
from ..services.match import cosine, embedding_from_image, match_candidates, normalize_embedding
from .extension import promote_face_reference, _upsert_manual_match

router = APIRouter(prefix="/admin")

ALLOWED_MATCH_STATUS: Final = {"APPROVED", "APPROVED_MANUAL", "REJECTED", "HIDDEN_OPTOUT", "AUTO", "AUTO_APPROVED"}
ALLOWED_SUGGESTION_STATUS: Final = {
    "APPROVED",
    "REJECTED",
    "MERGED",
    "NEEDS_MORE_INFO",
    "PENDING_REVIEW",
}
BOOTSTRAP_GROUP_THRESHOLD: Final = 0.88
ACTIVE_MATCH_STATUS: Final = {"AUTO", "AUTO_APPROVED", "APPROVED", "APPROVED_MANUAL"}


def _require_admin(
    authorization: str | None = Header(default=None, alias="Authorization"),
    x_admin_token: str | None = Header(default=None, alias="X-Admin-Token"),
):
    settings = get_settings()
    token = settings.admin_password
    if x_admin_token == token:
        return True
    if authorization and authorization.replace("Bearer ", "") == token:
        return True
    raise HTTPException(status_code=401, detail="Unauthorized")


def _as_uuid(value: str) -> UUID:
    try:
        return UUID(value)
    except ValueError:
        raise HTTPException(status_code=400, detail="UUID inválido") from None


@router.post("/login", response_model=LoginOut)
def login(payload: LoginIn):
    settings = get_settings()
    if payload.email == settings.admin_email and payload.password == settings.admin_password:
        return LoginOut(token=settings.admin_password)
    raise HTTPException(status_code=401, detail="Invalid credentials")


@router.post("/bootstrap-runs")
def create_bootstrap_run(
    payload: BootstrapRunCreate,
    session: Session = Depends(get_session),
    _: bool = Depends(_require_admin),
):
    run = BootstrapRun(
        status="DISCOVERING",
        limit_per_source=payload.limit_per_source,
        render_browser=payload.render_browser,
    )
    session.add(run)
    session.flush()

    warnings: list[str] = []
    discovered = discover_politics_articles(payload.limit_per_source, payload.render_browser)
    for result in discovered:
        warnings.extend(f"{result.source.source}: {warning}" for warning in result.warnings)
        for article in result.articles:
            session.add(
                BootstrapRunArticle(
                    run_id=run.id,
                    source=article.source,
                    domain=article.domain,
                    section_url=article.section_url,
                    article_url=article.article_url,
                    title=article.title,
                    status="DISCOVERED",
                )
            )

    run.status = "READY"
    run.warnings = warnings
    run.updated_at = datetime.now(timezone.utc)
    session.add(run)
    write_action(
        session,
        actor_type="admin",
        actor_id="system",
        action="create_bootstrap_run",
        entity_type="bootstrap_run",
        entity_id=run.id,
        metadata={"limit_per_source": payload.limit_per_source, "render_browser": payload.render_browser},
    )
    session.commit()
    session.refresh(run)
    return _bootstrap_run_payload(session, run)


@router.get("/bootstrap-runs")
def list_bootstrap_runs(session: Session = Depends(get_session), _: bool = Depends(_require_admin)):
    runs = session.exec(select(BootstrapRun).order_by(BootstrapRun.created_at.desc())).all()
    return [
        {
            "id": str(run.id),
            "status": run.status,
            "limit_per_source": run.limit_per_source,
            "render_browser": run.render_browser,
            "warnings": run.warnings,
            "created_at": run.created_at,
            "updated_at": run.updated_at,
        }
        for run in runs
    ]


@router.get("/bootstrap-runs/{run_id}")
def get_bootstrap_run(run_id: str, session: Session = Depends(get_session), _: bool = Depends(_require_admin)):
    run = session.get(BootstrapRun, _as_uuid(run_id))
    if not run:
        raise HTTPException(status_code=404, detail="Run de bootstrap não encontrado")
    return _bootstrap_run_payload(session, run)


@router.post("/bootstrap-runs/{run_id}/articles/{run_article_id}/attach")
def attach_bootstrap_article(
    run_id: str,
    run_article_id: str,
    payload: BootstrapRunArticleAttach,
    session: Session = Depends(get_session),
    _: bool = Depends(_require_admin),
):
    run = session.get(BootstrapRun, _as_uuid(run_id))
    item = session.get(BootstrapRunArticle, _as_uuid(run_article_id))
    if not run or not item or item.run_id != run.id:
        raise HTTPException(status_code=404, detail="Item de bootstrap não encontrado")

    item.article_id = payload.article_id
    item.status = payload.status
    item.image_count = payload.image_count
    item.face_count = payload.face_count
    item.warnings = payload.warnings
    item.updated_at = datetime.now(timezone.utc)
    run.updated_at = item.updated_at
    session.add(item)
    session.add(run)
    session.commit()
    return {"ok": True, "article": _bootstrap_article_payload(item)}


@router.post("/bootstrap-runs/{run_id}/label-group")
def label_bootstrap_group(
    run_id: str,
    payload: BootstrapLabelGroupIn,
    session: Session = Depends(get_session),
    _: bool = Depends(_require_admin),
):
    run = session.get(BootstrapRun, _as_uuid(run_id))
    if not run:
        raise HTTPException(status_code=404, detail="Run de bootstrap não encontrado")
    if not payload.face_ids:
        raise HTTPException(status_code=400, detail="Nenhuma face informada")

    person = session.get(Person, payload.person_id) if payload.person_id else None
    if not person:
        name = (payload.name or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Informe pessoa existente ou nome novo")
        person = Person(
            name=name,
            display_name=name,
            slug=_unique_slug(session, name),
            category="politica",
            description="Criado pela bancada de bootstrap de políticos.",
            public_office=None,
            source_urls=[],
            is_public_figure=True,
        )
        session.add(person)
        session.flush()

    updated = 0
    for face_id in payload.face_ids:
        face = session.get(DetectedFace, face_id)
        if not face:
            continue
        _upsert_manual_match(session, face, person)
        promote_face_reference(session, face, person)
        updated += 1

    write_action(
        session,
        actor_type="admin",
        actor_id="system",
        action="label_bootstrap_group",
        entity_type="bootstrap_run",
        entity_id=run.id,
        metadata={"person_id": str(person.id), "faces": updated},
    )
    session.commit()
    return {"ok": True, "person_id": str(person.id), "updated_faces": updated}


def _person_payload(item: Person) -> dict:
    return {
        "id": str(item.id),
        "name": item.name,
        "display_name": item.display_name,
        "slug": item.slug,
        "category": item.category,
        "description": item.description,
        "public_office": item.public_office,
        "source_urls": item.source_urls,
        "status": item.status,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }


def _slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value.lower().strip())
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9-]", "", re.sub(r"\s+", "-", ascii_value))
    return slug or "pessoa-sugerida"


def _unique_slug(session: Session, value: str) -> str:
    base_slug = _slugify(value)[:80]
    final_slug = base_slug
    suffix = 2
    while session.exec(select(Person).where(Person.slug == final_slug)).first():
        final_slug = f"{base_slug[:73]}-{suffix}"[:80]
        suffix += 1
    return final_slug


def _article_context(session: Session, face_id: UUID | None) -> dict:
    if not face_id:
        return {
            "face_id": None,
            "bbox": None,
            "image_id": None,
            "image_url": None,
            "article_id": None,
            "article_title": None,
            "article_url": None,
            "captured_at": None,
        }

    face = session.get(DetectedFace, face_id)
    image = session.get(ArticleImage, face.article_image_id) if face else None
    article = session.get(Article, image.article_id) if image else None
    return {
        "face_id": str(face.id) if face else str(face_id),
        "bbox": face.bbox if face else None,
        "image_id": str(image.id) if image else None,
        "image_url": image.image_url if image else None,
        "image_width": image.width if image else None,
        "image_height": image.height if image else None,
        "article_id": str(article.id) if article else None,
        "article_title": article.title if article else None,
        "article_url": article.url if article else None,
        "captured_at": article.captured_at if article else None,
    }


def _match_payload(session: Session, item: FaceMatch) -> dict:
    person = session.get(Person, item.person_id)
    return {
        "id": str(item.id),
        "detected_face_id": str(item.detected_face_id),
        "person_id": str(item.person_id),
        "person_name": person.display_name or person.name if person else None,
        "person_slug": person.slug if person else None,
        "score": item.score,
        "status": item.status,
        "reviewed_by": str(item.reviewed_by) if item.reviewed_by else None,
        "reviewed_at": item.reviewed_at,
        **_article_context(session, item.detected_face_id),
    }


def _suggestion_payload(session: Session, item: FaceSuggestion) -> dict:
    suggested = session.get(Person, item.suggested_person_id) if item.suggested_person_id else None
    return {
        "id": str(item.id),
        "detected_face_id": str(item.detected_face_id),
        "suggested_name": item.suggested_name,
        "suggested_person_id": str(item.suggested_person_id) if item.suggested_person_id else None,
        "suggested_person_name": suggested.display_name or suggested.name if suggested else None,
        "suggested_person_slug": suggested.slug if suggested else None,
        "source_url": item.source_url,
        "comment": item.comment,
        "submitter_email": item.submitter_email,
        "status": item.status,
        "created_at": item.created_at,
        **_article_context(session, item.detected_face_id),
    }


def _bootstrap_article_payload(item: BootstrapRunArticle) -> dict:
    return {
        "id": str(item.id),
        "source": item.source,
        "domain": item.domain,
        "section_url": item.section_url,
        "article_url": item.article_url,
        "title": item.title,
        "status": item.status,
        "article_id": str(item.article_id) if item.article_id else None,
        "image_count": item.image_count,
        "face_count": item.face_count,
        "warnings": item.warnings,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }


def _face_context_payload(session: Session, face: DetectedFace) -> dict | None:
    embedding = normalize_embedding(face.embedding)
    if not embedding:
        return None
    image = session.get(ArticleImage, face.article_image_id)
    article = session.get(Article, image.article_id) if image else None
    return {
        "face_id": str(face.id),
        "bbox": face.bbox,
        "embedding": embedding,
        "image_id": str(image.id) if image else None,
        "image_url": image.image_url if image else None,
        "image_width": image.width if image else None,
        "image_height": image.height if image else None,
        "article_id": str(article.id) if article else None,
        "article_url": article.url if article else None,
        "article_title": article.title if article else None,
    }


def _face_has_active_match(session: Session, face_id: UUID) -> bool:
    return bool(
        session.exec(
            select(FaceMatch).where(
                FaceMatch.detected_face_id == face_id,
                FaceMatch.status.in_(ACTIVE_MATCH_STATUS),
            )
        ).first()
    )


def _bootstrap_groups(session: Session, run_id: UUID) -> list[dict]:
    run_articles = session.exec(
        select(BootstrapRunArticle).where(BootstrapRunArticle.run_id == run_id)
    ).all()
    article_ids = [item.article_id for item in run_articles if item.article_id]
    if not article_ids:
        return []

    images = session.exec(select(ArticleImage).where(ArticleImage.article_id.in_(article_ids))).all()
    image_ids = [image.id for image in images]
    if not image_ids:
        return []

    candidates: list[dict] = []
    for face in session.exec(select(DetectedFace).where(DetectedFace.article_image_id.in_(image_ids))).all():
        if _face_has_active_match(session, face.id):
            continue
        payload = _face_context_payload(session, face)
        if payload:
            candidates.append(payload)

    groups: list[dict] = []
    for candidate in candidates:
        placed = False
        for group in groups:
            representative = group["faces"][0]["embedding"]
            if cosine(candidate["embedding"], representative) >= BOOTSTRAP_GROUP_THRESHOLD:
                group["faces"].append(candidate)
                placed = True
                break
        if not placed:
            groups.append({"faces": [candidate]})

    for group in groups:
        face_ids = sorted(face["face_id"] for face in group["faces"])
        group["group_id"] = sha256(",".join(face_ids).encode("utf-8")).hexdigest()[:16]
        group["face_count"] = len(group["faces"])
        group["article_count"] = len({face["article_id"] for face in group["faces"] if face["article_id"]})
        for face in group["faces"]:
            face.pop("embedding", None)

    groups.sort(key=lambda item: (item["face_count"], item["article_count"]), reverse=True)
    return groups


def _bootstrap_run_payload(session: Session, run: BootstrapRun) -> dict:
    articles = session.exec(
        select(BootstrapRunArticle)
        .where(BootstrapRunArticle.run_id == run.id)
        .order_by(BootstrapRunArticle.source, BootstrapRunArticle.created_at)
    ).all()
    by_status: dict[str, int] = defaultdict(int)
    for item in articles:
        by_status[item.status] += 1
    return {
        "id": str(run.id),
        "status": run.status,
        "limit_per_source": run.limit_per_source,
        "render_browser": run.render_browser,
        "warnings": run.warnings,
        "created_at": run.created_at,
        "updated_at": run.updated_at,
        "sources": [
            {"source": item.source, "domain": item.domain, "url": item.url}
            for item in POLITICS_SOURCES
        ],
        "counts": {
            "articles": len(articles),
            "images": sum(item.image_count for item in articles),
            "faces": sum(item.face_count for item in articles),
            "statuses": dict(by_status),
        },
        "articles": [_bootstrap_article_payload(item) for item in articles],
        "groups": _bootstrap_groups(session, run.id),
    }


def _bbox_iou(first: dict, second: dict) -> float:
    left = max(float(first.get("x", 0)), float(second.get("x", 0)))
    top = max(float(first.get("y", 0)), float(second.get("y", 0)))
    right = min(float(first.get("x", 0)) + float(first.get("w", 0)), float(second.get("x", 0)) + float(second.get("w", 0)))
    bottom = min(float(first.get("y", 0)) + float(first.get("h", 0)), float(second.get("y", 0)) + float(second.get("h", 0)))
    intersection = max(0.0, right - left) * max(0.0, bottom - top)
    if intersection <= 0:
        return 0.0
    first_area = max(0.0, float(first.get("w", 0))) * max(0.0, float(first.get("h", 0)))
    second_area = max(0.0, float(second.get("w", 0))) * max(0.0, float(second.get("h", 0)))
    union = first_area + second_area - intersection
    return intersection / union if union > 0 else 0.0


def _normalized_face_payload(face, image: ArticleImage) -> dict | None:
    image_width = image.width or 0
    image_height = image.height or 0
    x = max(0.0, min(float(face.x), float(image_width)))
    y = max(0.0, min(float(face.y), float(image_height)))
    w = max(0.0, min(float(face.w), float(image_width) - x))
    h = max(0.0, min(float(face.h), float(image_height) - y))
    if w < 18 or h < 18:
        return None
    return {
        "bbox": {"x": x, "y": y, "w": w, "h": h},
        "quality_score": face.score,
        "embedding": normalize_embedding(face.embedding),
        "model_name": face.embedding_model or "face-api.js/faceRecognitionNet",
    }


@router.get("/people")
def list_people(query: str | None = None, session: Session = Depends(get_session), _: bool = Depends(_require_admin)):
    stmt = select(Person)
    if query:
        q = f"%{query}%"
        stmt = stmt.where(Person.name.ilike(q) | Person.display_name.ilike(q) | Person.slug.ilike(q))
    return [
        _person_payload(item)
        for item in session.exec(stmt).all()
    ]


@router.post("/people")
def create_person(payload: PersonCreate, session: Session = Depends(get_session), _: bool = Depends(_require_admin)):
    person = Person(
        name=payload.name,
        display_name=payload.display_name,
        slug=payload.slug,
        category=payload.category,
        description=payload.description,
        public_office=payload.public_office,
        source_urls=payload.source_urls,
    )
    session.add(person)
    session.commit()
    session.refresh(person)
    write_action(
        session,
        actor_type="admin",
        actor_id="system",
        action="create_person",
        entity_type="person",
        entity_id=person.id,
    )
    session.commit()
    return {"id": str(person.id)}


@router.get("/people/{person_id}")
def get_admin_person(person_id: str, session: Session = Depends(get_session), _: bool = Depends(_require_admin)):
    person = session.get(Person, _as_uuid(person_id))
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    reference_images = session.exec(
        select(PersonReferenceImage).where(PersonReferenceImage.person_id == person.id)
    ).all()
    matches = session.exec(select(FaceMatch).where(FaceMatch.person_id == person.id)).all()

    match_payload = [_match_payload(session, match) for match in matches]

    return {
        "person": _person_payload(person),
        "reference_images": [
            {
                "id": str(ref.id),
                "source_url": ref.source_url,
                "sha256": ref.sha256,
                "phash": ref.phash,
                "status": ref.status,
                "created_at": ref.created_at,
            }
            for ref in reference_images
        ],
        "matches": match_payload,
    }


@router.post("/people/{person_id}/update")
def update_person(person_id: str, payload: PersonUpdate, session: Session = Depends(get_session), _: bool = Depends(_require_admin)):
    person = session.get(Person, _as_uuid(person_id))
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    person.name = payload.name
    person.display_name = payload.display_name
    person.slug = payload.slug
    person.category = payload.category
    person.description = payload.description
    person.public_office = payload.public_office
    person.status = payload.status
    person.source_urls = payload.source_urls
    person.updated_at = datetime.now(timezone.utc)
    session.add(person)
    write_action(
        session,
        actor_type="admin",
        actor_id="system",
        action="update_person",
        entity_type="person",
        entity_id=person.id,
    )
    session.commit()
    return {"ok": True, "person": _person_payload(person)}


@router.post("/people/{person_id}/reference-images")
def add_reference_image(person_id: str, payload: ReferenceImageIn, session: Session = Depends(get_session), _: bool = Depends(_require_admin)):
    person = session.get(Person, _as_uuid(person_id))
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    fetched = fetch_image(payload.source_url)
    embedding = embedding_from_image(payload.source_url, fetched.content)
    ref = PersonReferenceImage(person_id=person.id, source_url=payload.source_url)
    ref.sha256 = fetched.sha256
    ref.phash = fetched.phash
    session.add(ref)
    session.flush()

    session.add(
        FaceEmbedding(
            person_id=person.id,
            reference_image_id=ref.id,
            embedding=embedding,
            embedding_vector=embedding,
            model_name=payload.model_name,
            model_version=payload.model_version,
        )
    )
    session.commit()

    write_action(
        session,
        actor_type="admin",
        actor_id="system",
        action="add_reference_image",
        entity_type="person_reference_image",
        entity_id=ref.id,
        metadata={"person_id": str(person.id)},
    )
    session.commit()
    return ReferenceImageOut(id=str(ref.id), source_url=ref.source_url, status=ref.status).dict()


@router.post("/matches/{match_id}/review")
def review_match(match_id: str, payload: MatchReviewIn, session: Session = Depends(get_session), _: bool = Depends(_require_admin)):
    if payload.status not in ALLOWED_MATCH_STATUS:
        raise HTTPException(status_code=400, detail="Status inválido para revisão de match.")
    match = session.get(FaceMatch, _as_uuid(match_id))
    if not match:
        raise HTTPException(status_code=404, detail="Match not found")
    match.status = payload.status
    match.reviewed_by = match.reviewed_by or None
    match.reviewed_at = datetime.now(timezone.utc)
    session.add(match)
    write_action(
        session,
        actor_type="admin",
        actor_id="system",
        action="review_match",
        entity_type="face_match",
        entity_id=match.id,
        metadata={"status": payload.status},
    )
    session.commit()
    return {"ok": True, "status": match.status}


@router.post("/matches/{match_id}/reassign")
def reassign_match(match_id: str, payload: MatchReassignIn, session: Session = Depends(get_session), _: bool = Depends(_require_admin)):
    match = session.get(FaceMatch, _as_uuid(match_id))
    if not match:
        raise HTTPException(status_code=404, detail="Match not found")
    person = session.get(Person, payload.person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    old_person_id = str(match.person_id)
    match.person_id = person.id
    match.score = 1.0
    match.distance = 0.0
    match.status = "APPROVED_MANUAL"
    match.reviewed_at = datetime.now(timezone.utc)
    session.add(match)
    face = session.get(DetectedFace, match.detected_face_id)
    if face:
        promote_face_reference(session, face, person)
    write_action(
        session,
        actor_type="admin",
        actor_id="system",
        action="reassign_match",
        entity_type="face_match",
        entity_id=match.id,
        metadata={"old_person_id": old_person_id, "new_person_id": str(person.id), "status": match.status},
    )
    session.commit()
    return {"ok": True, "person_id": str(person.id), "status": match.status}


@router.post("/people/{person_id}/article-images/{image_id}/discard")
def discard_person_image(person_id: str, image_id: str, session: Session = Depends(get_session), _: bool = Depends(_require_admin)):
    person = session.get(Person, _as_uuid(person_id))
    image = session.get(ArticleImage, _as_uuid(image_id))
    if not person or not image:
        raise HTTPException(status_code=404, detail="Pessoa ou imagem não encontrada")

    matches = session.exec(
        select(FaceMatch)
        .join(DetectedFace, FaceMatch.detected_face_id == DetectedFace.id)
        .where(FaceMatch.person_id == person.id)
        .where(DetectedFace.article_image_id == image.id)
    ).all()
    now = datetime.now(timezone.utc)
    for match in matches:
        match.status = "REJECTED"
        match.reviewed_at = now
        session.add(match)

    write_action(
        session,
        actor_type="admin",
        actor_id="system",
        action="discard_person_image",
        entity_type="article_image",
        entity_id=image.id,
        metadata={"person_id": str(person.id), "matches": len(matches)},
    )
    session.commit()
    return {"ok": True, "discarded_matches": len(matches)}


@router.post("/article-images/{image_id}/faces")
def add_faces_to_article_image(
    image_id: str,
    payload: AdminAddFacesIn,
    session: Session = Depends(get_session),
    _: bool = Depends(_require_admin),
):
    image = session.get(ArticleImage, _as_uuid(image_id))
    if not image:
        raise HTTPException(status_code=404, detail="Imagem não encontrada")

    existing_faces = session.exec(select(DetectedFace).where(DetectedFace.article_image_id == image.id)).all()
    person_embeddings = session.exec(select(FaceEmbedding)).all()
    created = 0
    reused = 0
    manual_matches = 0
    automatic_matches = 0

    for incoming in payload.faces:
        normalized = _normalized_face_payload(incoming, image)
        if not normalized:
            continue

        duplicate = next(
            (
                face
                for face in existing_faces
                if _bbox_iou(face.bbox, normalized["bbox"]) >= 0.75
            ),
            None,
        )
        if duplicate:
            detected = duplicate
            reused += 1
        else:
            detected = DetectedFace(
                article_image_id=image.id,
                bbox=normalized["bbox"],
                embedding=normalized["embedding"],
                embedding_vector=normalized["embedding"],
                quality_score=normalized["quality_score"],
                model_name=normalized["model_name"],
                model_version="0.1",
            )
            session.add(detected)
            session.flush()
            existing_faces.append(detected)
            created += 1

        if incoming.person_id:
            person = session.get(Person, incoming.person_id)
            if not person:
                raise HTTPException(status_code=404, detail="Pessoa escolhida não encontrada")
            _upsert_manual_match(session, detected, person)
            promote_face_reference(session, detected, person)
            manual_matches += 1
            continue

        if normalized["embedding"]:
            for item_match in match_candidates(session, normalized["embedding"], person_embeddings):
                person = session.get(Person, item_match["person_id"])
                if not person or person.status in {"OPTOUT_LIMITED", "REMOVED"}:
                    continue
                existing_match = session.exec(
                    select(FaceMatch).where(
                        FaceMatch.detected_face_id == detected.id,
                        FaceMatch.person_id == person.id,
                    )
                ).first()
                if existing_match:
                    continue
                session.add(
                    FaceMatch(
                        detected_face_id=detected.id,
                        person_id=person.id,
                        score=item_match["score"],
                        distance=item_match["distance"],
                        status="AUTO",
                    )
                )
                automatic_matches += 1

    write_action(
        session,
        actor_type="admin",
        actor_id="system",
        action="add_faces_to_article_image",
        entity_type="article_image",
        entity_id=image.id,
        metadata={
            "created": created,
            "reused": reused,
            "manual_matches": manual_matches,
            "automatic_matches": automatic_matches,
        },
    )
    session.commit()
    return {
        "ok": True,
        "created_faces": created,
        "reused_faces": reused,
        "manual_matches": manual_matches,
        "automatic_matches": automatic_matches,
    }


@router.post("/suggestions/{suggestion_id}/review")
def review_suggestion(
    suggestion_id: str,
    payload: MatchReviewIn,
    session: Session = Depends(get_session),
    _: bool = Depends(_require_admin),
):
    if payload.status not in ALLOWED_SUGGESTION_STATUS:
        raise HTTPException(status_code=400, detail="Status inválido para revisão de sugestão.")
    suggestion = session.get(FaceSuggestion, _as_uuid(suggestion_id))
    if not suggestion:
        raise HTTPException(status_code=404, detail="Suggestion not found")

    suggestion.status = payload.status
    suggestion.reviewed_by = suggestion.reviewed_by or None
    suggestion.reviewed_at = datetime.now(timezone.utc)
    session.add(suggestion)

    if payload.status == "APPROVED":
        face = session.get(DetectedFace, suggestion.detected_face_id)
        if not face:
            raise HTTPException(status_code=400, detail="Face inválida")

        person = None
        if suggestion.suggested_person_id:
            person = session.get(Person, suggestion.suggested_person_id)
        if not person:
            person = session.exec(select(Person).where(Person.name == suggestion.suggested_name)).first()
            if not person:
                base_slug = _slugify(suggestion.suggested_name)
                final_slug = base_slug[:80]
                suffix = 2
                while session.exec(select(Person).where(Person.slug == final_slug)).first():
                    final_slug = f"{base_slug[:73]}-{suffix}"[:80]
                    suffix += 1

                person = Person(
                    name=suggestion.suggested_name,
                    display_name=suggestion.suggested_name,
                    slug=final_slug,
                    category="suggested",
                    description="Criado a partir de sugestão manual pendente de revisão.",
                    source_urls=[],
                )
                session.add(person)
                session.flush()
        _upsert_manual_match(session, face, person)
        promote_face_reference(session, face, person)

    write_action(
        session,
        actor_type="admin",
        actor_id="system",
        action="review_suggestion",
        entity_type="face_suggestion",
        entity_id=suggestion.id,
        metadata={"status": payload.status},
    )
    session.commit()
    return {"ok": True, "status": suggestion.status}


@router.post("/people/{person_id}/optout")
def optout_person(person_id: str, session: Session = Depends(get_session), _: bool = Depends(_require_admin)):
    person = session.get(Person, _as_uuid(person_id))
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    person.status = "OPTOUT_LIMITED"
    session.add(person)
    session.commit()
    write_action(
        session,
        actor_type="admin",
        actor_id="system",
        action="optout_person",
        entity_type="person",
        entity_id=person.id,
    )
    return {"ok": True}


@router.get("/suggestions")
def list_suggestions(
    status: str | None = "PENDING_REVIEW",
    session: Session = Depends(get_session),
    _: bool = Depends(_require_admin),
):
    stmt = select(FaceSuggestion).order_by(FaceSuggestion.created_at.desc())
    if status:
        stmt = stmt.where(FaceSuggestion.status == status)
    return [_suggestion_payload(session, item) for item in session.exec(stmt).all()]


@router.get("/matches")
def list_matches(
    status: str | None = None,
    session: Session = Depends(get_session),
    _: bool = Depends(_require_admin),
):
    stmt = select(FaceMatch).order_by(FaceMatch.created_at.desc())
    if status:
        stmt = stmt.where(FaceMatch.status == status)
    return [_match_payload(session, item) for item in session.exec(stmt).all()]


@router.get("/optout-requests")
def list_optout_requests(session: Session = Depends(get_session), _: bool = Depends(_require_admin)):
    return [
        {
            "id": str(item.id),
            "person_id": str(item.person_id),
            "requester_name": item.requester_name,
            "requester_email": item.requester_email,
            "relationship": item.relationship,
            "message": item.message,
            "verification_status": item.verification_status,
            "decision": item.decision,
            "decided_by": str(item.decided_by) if item.decided_by else None,
            "decided_at": item.decided_at,
            "created_at": item.created_at,
        }
        for item in session.exec(select(OptoutRequest)).all()
    ]


@router.get("/audit-logs")
def list_audit_logs(session: Session = Depends(get_session), _: bool = Depends(_require_admin)):
    logs = session.exec(
        select(AuditLog).order_by(AuditLog.created_at.desc())
    ).all()
    return [
        {
            "id": str(item.id),
            "actor_type": item.actor_type,
            "actor_id": item.actor_id,
            "action": item.action,
            "entity_type": item.entity_type,
            "entity_id": str(item.entity_id) if item.entity_id else None,
            "metadata": item.metadata_json,
            "created_at": item.created_at,
        }
        for item in logs
    ]


@router.get("/allowed-domains")
def list_allowed_domains(session: Session = Depends(get_session), _: bool = Depends(_require_admin)):
    return [
        {"id": str(row.id), "domain": row.domain, "enabled": row.enabled}
        for row in session.exec(select(AllowedDomain)).all()
    ]


@router.post("/allowed-domains")
def add_allowed_domain(domain: str, session: Session = Depends(get_session), _: bool = Depends(_require_admin)):
    normalized = domain.strip().lower().replace("www.", "")
    if not normalized:
        raise HTTPException(status_code=400, detail="Invalid domain")
    existing = session.exec(select(AllowedDomain).where(AllowedDomain.domain == normalized)).first()
    if existing:
        raise HTTPException(status_code=409, detail="Dominio ja existe")

    row = AllowedDomain(domain=normalized)
    session.add(row)
    session.commit()
    return {"ok": True, "domain": row.domain}
