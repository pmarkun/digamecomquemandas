from dataclasses import dataclass

from .match import BBoxLike


@dataclass
class FaceCandidate:
    bbox: BBoxLike


def detect_faces(image_width: int | None, image_height: int | None) -> list[FaceCandidate]:
    # MVP: um detector determinístico/simples para tornar o fluxo ponta a ponta utilizável.
    w = image_width or 800
    h = image_height or 600

    if w < 160 or h < 160:
        return []

    box_size = int(min(w, h) * 0.35)
    if box_size < 80:
        return []

    box = BBoxLike(
        x=max(10, int(w * 0.25)),
        y=max(10, int(h * 0.2)),
        w=box_size,
        h=box_size,
    )
    return [FaceCandidate(bbox=box)]
