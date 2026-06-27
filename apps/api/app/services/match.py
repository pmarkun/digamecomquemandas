from dataclasses import dataclass
from hashlib import sha256
from math import sqrt
from typing import List

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


def cosine(a: list[float], b: list[float]) -> float:
    if not a or not b:
        return 0.0
    n = min(len(a), len(b))
    dot = sum(a[i] * b[i] for i in range(n))
    na = sqrt(sum(a[i] * a[i] for i in range(n))) or 1.0
    nb = sqrt(sum(b[i] * b[i] for i in range(n))) or 1.0
    return dot / (na * nb)


def match_candidates(face_embedding: list[float], person_embeddings: list[FaceEmbedding]) -> list[dict]:
    settings = get_settings()
    threshold = settings.face_match_threshold
    display_threshold = settings.face_display_threshold
    auto_threshold = settings.face_auto_approve_threshold

    scored = []
    for pe in person_embeddings:
        score = cosine(face_embedding, pe.embedding)
        if score < threshold:
            continue
        status = "AUTO"
        if score >= auto_threshold:
            status = "AUTO_APPROVED"
        elif score >= display_threshold:
            status = "APPROVED"
        scored.append(
            {
                "person_id": pe.person_id,
                "name": pe.person.name,
                "slug": pe.person.slug,
                "score": score,
                "status": status,
                "distance": 1 - score,
            }
        )

    scored.sort(key=lambda item: item["score"], reverse=True)
    return scored[: settings.max_matches_per_face]


def detect_embedding(person_url: str) -> list[float]:
    return embedding_from_seed(person_url)
