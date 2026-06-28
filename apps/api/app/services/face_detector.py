from dataclasses import dataclass

from .match import BBoxLike


@dataclass
class FaceCandidate:
    bbox: BBoxLike
    score: float | None = None
    embedding: list[float] | None = None
    embedding_model: str | None = None


def detect_faces(
    content: bytes | None,
    image_width: int | None = None,
    image_height: int | None = None,
) -> list[FaceCandidate]:
    # A extensão usa face-api.js em um offscreen document e envia as faces reais.
    # O backend não sintetiza bboxes para evitar um segundo stack de detecção.
    return []
