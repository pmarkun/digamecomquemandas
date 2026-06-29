from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select
from typing import Final
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from uuid import UUID

from ..db import get_session
from ..models import Article, ArticleImage, DetectedFace, FaceMatch, OptoutRequest, Person, AllowedDomain, FaceEmbedding
from ..schemas import ContestRequest, InfluenceGraphOut
from ..services.audit import write_action

router = APIRouter()

PUBLIC_MATCH_STATUSES = {"APPROVED", "APPROVED_MANUAL", "AUTO_APPROVED"}
TRACKING_QUERY_KEYS: Final = {"fbclid", "gclid", "igshid", "mc_cid", "mc_eid", "srsltid"}


def _as_uuid(value: str) -> UUID:
    try:
        return UUID(value)
    except ValueError:
        raise HTTPException(status_code=400, detail="UUID inválido") from None


def _normalize_article_url(url: str) -> str:
    parsed = urlparse(url)
    query = urlencode(
        [
            (key, value)
            for key, value in parse_qsl(parsed.query, keep_blank_values=True)
            if key.lower() not in TRACKING_QUERY_KEYS and not key.lower().startswith("utm_")
        ]
    )
    return urlunparse((parsed.scheme, parsed.netloc.lower(), parsed.path.rstrip("/") or "/", "", query, ""))


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


@router.get("/people/{slug}/influence-graph", response_model=InfluenceGraphOut)
def person_influence_graph(slug: str, limit: int = 40, session: Session = Depends(get_session)):
    person = session.exec(select(Person).where(Person.slug == slug)).first()
    if not person:
        raise HTTPException(status_code=404, detail="Pessoa não encontrada")

    center = {
        "id": str(person.id),
        "slug": person.slug,
        "name": person.name,
        "display_name": person.display_name,
    }
    if not person.is_public_figure or person.status != "ACTIVE":
        return {
            "center": center,
            "nodes": [],
            "edges": [],
            "image_scope_count": 0,
            "article_scope_count": 0,
        }

    own_scope_rows = session.exec(
        select(ArticleImage.id, Article.id)
        .join(DetectedFace, DetectedFace.article_image_id == ArticleImage.id)
        .join(FaceMatch, FaceMatch.detected_face_id == DetectedFace.id)
        .join(Article, Article.id == ArticleImage.article_id)
        .where(FaceMatch.person_id == person.id)
        .where(FaceMatch.status.in_(PUBLIC_MATCH_STATUSES))
    ).all()
    own_image_ids = {row[0] for row in own_scope_rows}
    own_article_ids = {row[1] for row in own_scope_rows}

    if not own_image_ids and not own_article_ids:
        return {
            "center": center,
            "nodes": [],
            "edges": [],
            "image_scope_count": 0,
            "article_scope_count": 0,
        }

    def empty_entry(other_id: UUID, slug: str, name: str, display_name: str) -> dict:
        return {
            "id": str(other_id),
            "slug": slug,
            "name": name,
            "display_name": display_name,
            "image_ids": set(),
            "article_ids": set(),
            "last_article_id": None,
            "last_article_title": None,
            "last_seen": None,
        }

    by_person: dict[UUID, dict] = {}
    seen_image_pairs: set[tuple[UUID, UUID]] = set()
    seen_article_pairs: set[tuple[UUID, UUID]] = set()

    if own_image_ids:
        image_rows = session.exec(
            select(
                FaceMatch.person_id,
                Person.slug,
                Person.name,
                Person.display_name,
                ArticleImage.id,
                Article.id,
                Article.title,
                Article.captured_at,
            )
            .join(Person, Person.id == FaceMatch.person_id)
            .join(DetectedFace, DetectedFace.id == FaceMatch.detected_face_id)
            .join(ArticleImage, ArticleImage.id == DetectedFace.article_image_id)
            .join(Article, Article.id == ArticleImage.article_id)
            .where(DetectedFace.article_image_id.in_(own_image_ids))
            .where(FaceMatch.person_id != person.id)
            .where(FaceMatch.status.in_(PUBLIC_MATCH_STATUSES))
            .where(Person.is_public_figure == True)  # noqa: E712
            .where(Person.status == "ACTIVE")
        ).all()
        for row in image_rows:
            other_id, other_slug, other_name, other_display_name, image_id, article_id, article_title, captured_at = row
            pair = (other_id, image_id)
            if pair in seen_image_pairs:
                continue
            seen_image_pairs.add(pair)
            entry = by_person.setdefault(other_id, empty_entry(other_id, other_slug, other_name, other_display_name))
            entry["image_ids"].add(image_id)
            entry["article_ids"].add(article_id)
            if entry["last_seen"] is None or (captured_at and captured_at > entry["last_seen"]):
                entry["last_seen"] = captured_at
                entry["last_article_id"] = str(article_id)
                entry["last_article_title"] = article_title

    if own_article_ids:
        article_rows = session.exec(
            select(
                FaceMatch.person_id,
                Person.slug,
                Person.name,
                Person.display_name,
                ArticleImage.id,
                Article.id,
                Article.title,
                Article.captured_at,
            )
            .join(Person, Person.id == FaceMatch.person_id)
            .join(DetectedFace, DetectedFace.id == FaceMatch.detected_face_id)
            .join(ArticleImage, ArticleImage.id == DetectedFace.article_image_id)
            .join(Article, Article.id == ArticleImage.article_id)
            .where(ArticleImage.article_id.in_(own_article_ids))
            .where(FaceMatch.person_id != person.id)
            .where(FaceMatch.status.in_(PUBLIC_MATCH_STATUSES))
            .where(Person.is_public_figure == True)  # noqa: E712
            .where(Person.status == "ACTIVE")
        ).all()
        for row in article_rows:
            other_id, other_slug, other_name, other_display_name, _image_id, article_id, article_title, captured_at = row
            pair = (other_id, article_id)
            if pair in seen_article_pairs:
                continue
            seen_article_pairs.add(pair)
            entry = by_person.setdefault(other_id, empty_entry(other_id, other_slug, other_name, other_display_name))
            entry["article_ids"].add(article_id)
            if entry["last_seen"] is None or (captured_at and captured_at > entry["last_seen"]):
                entry["last_seen"] = captured_at
                entry["last_article_id"] = str(article_id)
                entry["last_article_title"] = article_title

    nodes = []
    for entry in by_person.values():
        image_count = len(entry["image_ids"])
        article_count = len(entry["article_ids"])
        weight = image_count * 2 + article_count
        nodes.append(
            {
                "id": entry["id"],
                "slug": entry["slug"],
                "name": entry["name"],
                "display_name": entry["display_name"],
                "image_count": image_count,
                "article_count": article_count,
                "total_count": image_count + article_count,
                "weight": weight,
                "last_article_id": entry["last_article_id"],
                "last_article_title": entry["last_article_title"],
            }
        )

    nodes.sort(key=lambda item: (item["weight"], item["article_count"], item["image_count"], item["name"]), reverse=True)
    nodes = nodes[: max(1, min(limit, 80))]
    edges = [
        {
            "source": person.slug,
            "target": node["slug"],
            "image_count": node["image_count"],
            "article_count": node["article_count"],
            "total_count": node["total_count"],
            "weight": node["weight"],
            "last_article_id": node["last_article_id"],
            "last_article_title": node["last_article_title"],
        }
        for node in nodes
    ]

    return {
        "center": center,
        "nodes": nodes,
        "edges": edges,
        "image_scope_count": len(own_image_ids),
        "article_scope_count": len(own_article_ids),
    }


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


@router.get("/articles/recent")
def recent_articles(limit: int = Query(default=12, ge=1, le=50), session: Session = Depends(get_session)):
    rows = session.exec(
        select(Article, ArticleImage, FaceMatch, Person)
        .join(ArticleImage, ArticleImage.article_id == Article.id)
        .join(DetectedFace, DetectedFace.article_image_id == ArticleImage.id)
        .join(FaceMatch, FaceMatch.detected_face_id == DetectedFace.id)
        .join(Person, Person.id == FaceMatch.person_id)
        .where(FaceMatch.status.in_(PUBLIC_MATCH_STATUSES))
        .where(Person.is_public_figure == True)  # noqa: E712
        .where(Person.status == "ACTIVE")
        .order_by(Article.captured_at.desc(), FaceMatch.score.desc())
    ).all()

    by_article: dict[str, dict] = {}
    for article, image, match, person in rows:
        article_key = str(article.id)
        item = by_article.setdefault(
            article_key,
            {
                "article_id": article_key,
                "title": article.title,
                "url": article.url,
                "domain": article.domain,
                "captured_at": article.captured_at,
                "thumbnail_url": image.image_url,
                "people": [],
                "_people": set(),
            },
        )
        if not item["thumbnail_url"] and image.image_url:
            item["thumbnail_url"] = image.image_url
        person_key = str(person.id)
        if person_key not in item["_people"]:
            item["_people"].add(person_key)
            item["people"].append(
                {
                    "person_id": person_key,
                    "name": person.display_name or person.name,
                    "slug": person.slug,
                    "score": round(match.score, 4),
                    "status": match.status,
                }
            )

    out = []
    for item in by_article.values():
        item.pop("_people", None)
        out.append(item)
        if len(out) >= limit:
            break
    return out


@router.get("/articles/resolve")
def resolve_article(url: str = Query(..., min_length=1), session: Session = Depends(get_session)):
    try:
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError
        normalized_url = _normalize_article_url(url)
    except Exception:
        raise HTTPException(status_code=400, detail="URL inválida") from None

    for article in session.exec(select(Article)).all():
        if article.url and _normalize_article_url(article.url) == normalized_url:
            return {
                "found": True,
                "article_id": str(article.id),
                "url": article.url,
                "domain": article.domain,
                "title": article.title,
            }
    return {"found": False}


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
                if match.status not in PUBLIC_MATCH_STATUSES:
                    continue
                person = session.get(Person, match.person_id)
                if not person or not person.is_public_figure or person.status != "ACTIVE":
                    continue
                match_payload.append(
                    {
                        "person_id": str(person.id),
                        "name": person.display_name or person.name,
                        "slug": person.slug,
                        "score": match.score,
                        "status": match.status,
                    }
                )
            if not match_payload:
                continue
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
