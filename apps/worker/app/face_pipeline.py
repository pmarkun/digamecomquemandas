import hashlib
from math import sqrt


def embedding_from_seed(seed: str, dim: int = 512) -> list[float]:
    digest = hashlib.sha256(seed.encode("utf-8")).digest()
    values = []
    for idx in range(dim):
        chunk = digest[idx % len(digest)]
        mixed = (chunk + digest[(idx * 7) % len(digest)]) / 510.0
        values.append(mixed)
    norm = sqrt(sum(v * v for v in values)) or 1.0
    return [v / norm for v in values]


def run_face_pipeline(image_url: str, image_width: int = 0, image_height: int = 0) -> dict:
    embedding = embedding_from_seed(f"{image_url}-{image_width}-{image_height}")
    return {
        "status": "ok",
        "image_url": image_url,
        "embedding_size": len(embedding),
    }
