from dataclasses import dataclass
from hashlib import sha256
from math import sqrt
from typing import List
from uuid import UUID

from sqlalchemy import text
from sqlmodel import Session

from ..config import get_settings
from ..models import FaceEmbedding


@dataclass
class BBoxLike:
    x: int
    y: int
    w: int
    h: int


DIMENSION = 128


def embedding_from_seed(seed: str, dim: int = DIMENSION) -> List[float]:
    digest = sha256(seed.encode("utf-8")).digest()
    values: list[float] = []
    for idx in range(dim):
        chunk = digest[idx % len(digest)]
        other = digest[(idx * 7) % len(digest)]
        mixed = (((chunk ^ other) / 255.0) * 2.0) - 1.0
        values.append(mixed)
    norm = sqrt(sum(v * v for v in values)) or 1.0
    return [v / norm for v in values]


def embedding_from_image(image_url: str, content: bytes | None, dim: int = DIMENSION) -> List[float]:
    if content:
        digest_seed = sha256(content).hexdigest()
        return embedding_from_seed(digest_seed, dim=dim)
    return embedding_from_seed(image_url, dim=dim)


def normalize_embedding(values: list[float] | None, dim: int = DIMENSION) -> list[float] | None:
    if values is None or len(values) != dim:
        return None
    cleaned: list[float] = []
    for value in values:
        try:
            number = float(value)
        except (TypeError, ValueError):
            return None
        if number != number or number in {float("inf"), float("-inf")}:
            return None
        cleaned.append(number)
    norm = sqrt(sum(v * v for v in cleaned))
    if not norm:
        return None
    return [v / norm for v in cleaned]


def cosine(a: list[float], b: list[float]) -> float:
    if not a or not b:
        return 0.0
    n = min(len(a), len(b))
    dot = sum(a[i] * b[i] for i in range(n))
    na = sqrt(sum(a[i] * a[i] for i in range(n))) or 1.0
    nb = sqrt(sum(b[i] * b[i] for i in range(n))) or 1.0
    return dot / (na * nb)


def _embedding_literal(face_embedding: list[float]) -> str:
    return "[" + ",".join(f"{value:.12f}" for value in face_embedding) + "]"


def _status_for_score(score: float) -> str:
    settings = get_settings()
    if score >= settings.face_auto_approve_threshold:
        return "AUTO"
    return "AUTO"


def _match_candidates_pgvector(session: Session, face_embedding: list[float]) -> list[dict]:
    settings = get_settings()
    threshold = max(settings.face_match_threshold, settings.face_display_threshold)
    query = text(
        """
        SELECT person_id, score, distance
        FROM (
          SELECT DISTINCT ON (person_id)
            person_id,
            score,
            distance
          FROM (
            SELECT
              person_id,
              1 - (embedding_vector <=> CAST(:embedding AS vector)) AS score,
              embedding_vector <=> CAST(:embedding AS vector) AS distance
            FROM faceembedding
            WHERE
              embedding_vector IS NOT NULL
              AND 1 - (embedding_vector <=> CAST(:embedding AS vector)) >= :threshold
          ) scored
          WHERE
            score >= :threshold
          ORDER BY person_id, score DESC
        ) best_by_person
        ORDER BY score DESC
        LIMIT :limit
        """
    )
    rows = session.exec(
        query,
        params={
            "embedding": _embedding_literal(face_embedding),
            "threshold": threshold,
            "limit": settings.max_matches_per_face,
        },
    ).all()
    matches = [
        {
            "person_id": row.person_id if isinstance(row.person_id, UUID) else UUID(str(row.person_id)),
            "score": float(row.score),
            "status": _status_for_score(float(row.score)),
            "distance": float(row.distance),
        }
        for row in rows
    ]
    matches.sort(key=lambda item: item["score"], reverse=True)
    return matches[: settings.max_matches_per_face]


def _match_candidates_python(face_embedding: list[float], person_embeddings: list[FaceEmbedding]) -> list[dict]:
    settings = get_settings()
    threshold = max(settings.face_match_threshold, settings.face_display_threshold)

    best_by_person: dict[UUID, dict] = {}
    for pe in person_embeddings:
        if len(pe.embedding or []) != len(face_embedding):
            continue
        score = cosine(face_embedding, pe.embedding)
        if score < threshold:
            continue
        existing = best_by_person.get(pe.person_id)
        if existing is None or score > existing["score"]:
            best_by_person[pe.person_id] = {
                "person_id": pe.person_id,
                "score": score,
                "status": _status_for_score(score),
                "distance": 1 - score,
            }

    scored = list(best_by_person.values())
    scored.sort(key=lambda item: item["score"], reverse=True)
    return scored[: settings.max_matches_per_face]


def match_candidates(session: Session, face_embedding: list[float], person_embeddings: list[FaceEmbedding]) -> list[dict]:
    return _match_candidates_python(face_embedding, person_embeddings)


def detect_embedding(person_url: str) -> list[float]:
    return embedding_from_seed(person_url)
