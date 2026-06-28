from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from uuid import UUID

from ..db import get_session
from ..models import Article, ArticleImage, DetectedFace, FaceMatch, OptoutRequest, Person, AllowedDomain, FaceEmbedding
from ..schemas import ContestRequest
from ..services.audit import write_action

router = APIRouter()

PUBLIC_MATCH_STATUSES = {"APPROVED", "APPROVED_MANUAL", "AUTO_APPROVED"}


def _as_uuid(value: str) -> UUID:
    try:
        return UUID(value)
    except ValueError:
        raise HTTPException(status_code=400, detail="UUID inválido") from None


def _to_people_out(row: Person) -> dict:
    return {
        "id": str(row.id),
        "slug": row.slug,
        "name": row.name,
        "display_name": row.display_name,
        "category": row.category,
        "description": row.description,
        "public_office": row.public_office,
        "status": row.status,
        "created_at": row.created_at,
    }


@router.get("/people")
def list_people(query: str | None = None, session: Session = Depends(get_session)):
    stmt = select(Person)
    if query:
        q = f"%{query}%"
        stmt = stmt.where(Person.name.ilike(q) | Person.display_name.ilike(q) | Person.slug.ilike(q))
    people = session.exec(stmt).all()
    return [_to_people_out(item) for item in people]


@router.get("/people/{slug}")
def get_person(slug: str, session: Session = Depends(get_session)):
    person = session.exec(select(Person).where(Person.slug == slug)).first()
    if not person:
        raise HTTPException(status_code=404, detail="Pessoa não encontrada")
    return _to_people_out(person)


@router.get("/people/{slug}/appearances")
def person_appearances(slug: str, session: Session = Depends(get_session)):
    person = session.exec(select(Person).where(Person.slug == slug)).first()
    if not person:
        raise HTTPException(status_code=404, detail="Pessoa não encontrada")

    matches = session.exec(
        select(FaceMatch)
        .join(DetectedFace, FaceMatch.detected_face_id == DetectedFace.id)
        .where(FaceMatch.person_id == person.id)
        .where(FaceMatch.status.in_(PUBLIC_MATCH_STATUSES))
    ).all()

    appearances_by_image: dict[str, dict] = {}
    for match in matches:
        face = session.get(DetectedFace, match.detected_face_id)
        if not face:
            continue
        image = session.get(ArticleImage, face.article_image_id)
        if not image:
            continue
        article = session.get(Article, image.article_id)
        if not article:
            continue
        image_key = str(image.id)
        existing = appearances_by_image.get(image_key)
        if existing is None or match.score > existing["score"]:
            appearances_by_image[image_key] = {
                "article_id": str(article.id),
                "article_title": article.title,
                "article_url": article.url,
                "article_domain": article.domain,
                "captured_at": article.captured_at,
                "image_id": image_key,
                "image_url": image.image_url,
                "score": match.score,
                "status": match.status,
            }
    return list(appearances_by_image.values())


@router.get("/people/{slug}/connections")
def person_connections(slug: str, session: Session = Depends(get_session)):
    person = session.exec(select(Person).where(Person.slug == slug)).first()
    if not person:
        raise HTTPException(status_code=404, detail="Pessoa não encontrada")

    own = session.exec(
        select(DetectedFace.id)
        .join(FaceMatch, FaceMatch.detected_face_id == DetectedFace.id)
        .where(FaceMatch.person_id == person.id)
        .where(FaceMatch.status.in_(PUBLIC_MATCH_STATUSES))
    ).all()

    own_image_ids = set()
    for fid in own:
        face = session.get(DetectedFace, fid)
        if face:
            own_image_ids.add(face.article_image_id)

    coappear: dict[str, dict[str, str | int | float | None | dict[str, object]]] = {}
    for image_id in own_image_ids:
        faces = session.exec(
            select(FaceMatch)
            .join(DetectedFace, DetectedFace.id == FaceMatch.detected_face_id)
            .where(DetectedFace.article_image_id == image_id)
            .where(FaceMatch.status.in_(PUBLIC_MATCH_STATUSES))
        ).all()
        image = session.get(ArticleImage, image_id)
        article = session.get(Article, image.article_id) if image else None
        best_by_person: dict[str, FaceMatch] = {}
        for f in faces:
            if f.person_id == person.id:
                continue
            other = session.get(Person, f.person_id)
            if not other:
                continue
            other_key = str(other.id)
            existing_match = best_by_person.get(other_key)
            if existing_match is None or f.score > existing_match.score:
                best_by_person[other_key] = f

        for other_key, f in best_by_person.items():
            other = session.get(Person, f.person_id)
            if not other:
                continue
            entry = coappear.get(
                other_key,
                {
                    "slug": other.slug,
                    "name": other.name,
                    "count": 0,
                    "last_score": 0.0,
                    "last_seen": None,
                    "last_article_id": None,
                    "last_article_title": None,
                },
            )
            entry["count"] = int(entry["count"]) + 1
            entry["last_score"] = max(float(entry["last_score"]), float(f.score))
            match_face = session.get(DetectedFace, f.detected_face_id)
            seen_at = match_face.created_at if match_face and match_face.created_at else None
            if article:
                entry["last_article_id"] = str(article.id)
                entry["last_article_title"] = article.title

                previous_seen = entry.get("last_seen")
                if previous_seen is None or (seen_at and seen_at > previous_seen):
                    entry["last_seen"] = seen_at
                    entry["last_article_id"] = str(article.id)
                    entry["last_article_title"] = article.title
            coappear[other_key] = entry

    return [
        {
            "slug": item["slug"],
            "name": item["name"],
            "count": item["count"],
            "last_score": item["last_score"],
            "last_article_id": item["last_article_id"],
            "last_article_title": item["last_article_title"],
        }
        for item in coappear.values()
    ]


@router.post("/people/{slug}/contest")
def contest(slug: str, payload: ContestRequest, session: Session = Depends(get_session)):
    person = session.exec(select(Person).where(Person.slug == slug)).first()
    if not person:
        raise HTTPException(status_code=404, detail="Pessoa não encontrada")

    req = OptoutRequest(
        person_id=person.id,
        requester_name=payload.requester_name,
        requester_email=payload.requester_email,
        relationship=payload.relationship,
        message=payload.message,
    )
    session.add(req)
    write_action(
        session,
        actor_type="public",
        actor_id=None,
        action="create_contest_request",
        entity_type="optout_request",
        entity_id=req.id,
        metadata={"person_id": str(person.id)},
    )
    session.commit()
    return {"ok": True, "id": str(req.id)}


@router.get("/articles/{article_id}")
def get_article(article_id: str, session: Session = Depends(get_session)):
    article = session.get(Article, _as_uuid(article_id))
    if not article:
        raise HTTPException(status_code=404, detail="Matéria não encontrada")

    images = session.exec(select(ArticleImage).where(ArticleImage.article_id == article.id)).all()
    image_payload = []
    for image in images:
        faces = session.exec(select(DetectedFace).where(DetectedFace.article_image_id == image.id)).all()
        face_payload = []
        for face in faces:
            matches = session.exec(
                select(FaceMatch)
                .where(FaceMatch.detected_face_id == face.id)
                .order_by(FaceMatch.score.desc())
            ).all()
            match_payload = []
            for match in matches:
                person = session.get(Person, match.person_id)
                if not person:
                    continue
                match_payload.append(
                    {
                        "person_id": str(person.id),
                        "name": person.name,
                        "slug": person.slug,
                        "score": match.score,
                        "status": match.status,
                    }
                )
            face_payload.append(
                {
                    "face_id": str(face.id),
                    "bbox": face.bbox,
                    "matches": match_payload,
                }
            )
        image_payload.append(
            {
                "image_id": str(image.id),
                "image_url": image.image_url,
                "faces": face_payload,
                "width": image.width,
                "height": image.height,
            }
        )

    return {
        "id": str(article.id),
        "url": article.url,
        "domain": article.domain,
        "title": article.title,
        "published_at": article.published_at,
        "captured_at": article.captured_at,
        "images": image_payload,
    }


@router.get("/allowed-domains")
def list_allowed_domains(session: Session = Depends(get_session)):
    return [
        {"domain": row.domain, "enabled": row.enabled}
        for row in session.exec(select(AllowedDomain).where(AllowedDomain.enabled == True)).all()  # noqa: E712
    ]


@router.get("/people/{person_id}/embeddings")
def person_embeddings(person_id: str, session: Session = Depends(get_session)):
    return [
        {
            "id": str(emb.id),
            "person_id": str(emb.person_id),
            "model_name": emb.model_name,
            "model_version": emb.model_version,
        }
        for emb in session.exec(select(FaceEmbedding).where(FaceEmbedding.person_id == person_id)).all()
    ]
