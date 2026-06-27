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


DIMENSION = 512


def embedding_from_seed(seed: str, dim: int = DIMENSION) -> List[float]:
    digest = sha256(seed.encode("utf-8")).digest()
    values: list[float] = []
    for idx in range(dim):
        chunk = digest[idx % len(digest)]
        mixed = (chunk + digest[(idx * 7) % len(digest)]) / 510.0
        values.append(mixed)
    norm = sqrt(sum(v * v for v in values)) or 1.0
    return [v / norm for v in values]


def embedding_from_image(image_url: str, content: bytes | None, dim: int = DIMENSION) -> List[float]:
    if content:
        digest_seed = sha256(content).hexdigest()
        return embedding_from_seed(digest_seed, dim=dim)
    return embedding_from_seed(image_url, dim=dim)


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
        return "AUTO_APPROVED"
    if score >= settings.face_display_threshold:
        return "APPROVED"
    return "AUTO"


def _match_candidates_pgvector(session: Session, face_embedding: list[float]) -> list[dict]:
    settings = get_settings()
    query = text(
        """
        SELECT
          person_id,
          1 - (embedding_vector <=> CAST(:embedding AS vector)) AS score,
          embedding_vector <=> CAST(:embedding AS vector) AS distance
        FROM faceembedding
        WHERE
          embedding_vector IS NOT NULL
          AND 1 - (embedding_vector <=> CAST(:embedding AS vector)) >= :threshold
        ORDER BY embedding_vector <=> CAST(:embedding AS vector)
        LIMIT :limit
        """
    )
    rows = session.exec(
        query,
        params={
            "embedding": _embedding_literal(face_embedding),
            "threshold": settings.face_match_threshold,
            "limit": settings.max_matches_per_face,
        },
    ).all()
    return [
        {
            "person_id": row.person_id if isinstance(row.person_id, UUID) else UUID(str(row.person_id)),
            "score": float(row.score),
            "status": _status_for_score(float(row.score)),
            "distance": float(row.distance),
        }
        for row in rows
    ]


def _match_candidates_python(face_embedding: list[float], person_embeddings: list[FaceEmbedding]) -> list[dict]:
    settings = get_settings()
    threshold = settings.face_match_threshold

    scored = []
    for pe in person_embeddings:
        score = cosine(face_embedding, pe.embedding)
        if score < threshold:
            continue
        scored.append(
            {
                "person_id": pe.person_id,
                "score": score,
                "status": _status_for_score(score),
                "distance": 1 - score,
            }
        )

    scored.sort(key=lambda item: item["score"], reverse=True)
    return scored[: settings.max_matches_per_face]


def match_candidates(session: Session, face_embedding: list[float], person_embeddings: list[FaceEmbedding]) -> list[dict]:
    if session.bind and session.bind.dialect.name == "postgresql":
        return _match_candidates_pgvector(session, face_embedding)
    return _match_candidates_python(face_embedding, person_embeddings)


def detect_embedding(person_url: str) -> list[float]:
    return embedding_from_seed(person_url)
