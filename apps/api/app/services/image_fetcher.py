from dataclasses import dataclass
from io import BytesIO
from statistics import mean

import httpx
from PIL import Image

from .privacy import hash_sha256


@dataclass
class FetchedImage:
    ok: bool
    width: int | None = None
    height: int | None = None
    content: bytes | None = None
    content_type: str | None = None
    sha256: str | None = None
    phash: str | None = None
    error: str | None = None


async def validate_image_url(url: str, timeout: float = 3.0) -> FetchedImage:
    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            response = await client.head(url)
            content_type = response.headers.get("content-type", "")
            if response.status_code >= 400:
                return FetchedImage(ok=False, error=f"HTTP {response.status_code}")
            if "image" not in (content_type or ""):
                return FetchedImage(ok=False, error="content-type not image")
            return FetchedImage(ok=True, content_type=content_type)
    except Exception as exc:  # pragma: no cover - rede external failure path
        return FetchedImage(ok=False, error=str(exc))


def _average_hash(image: Image.Image, size: int = 8) -> str:
    gray = image.convert("L").resize((size, size))
    pixels = list(gray.getdata())
    threshold = mean(pixels)
    bits = "".join("1" if pixel >= threshold else "0" for pixel in pixels)
    return f"{int(bits, 2):0{size * size // 4}x}"


def fetch_image(url: str, width_hint: int | None = None, height_hint: int | None = None, timeout: float = 10.0) -> FetchedImage:
    try:
        with httpx.Client(timeout=timeout, follow_redirects=True) as client:
            response = client.get(url)
        response.raise_for_status()
        content_type = response.headers.get("content-type", "")
        if "image" not in content_type.lower():
            return FetchedImage(ok=False, width=width_hint, height=height_hint, error="content-type not image")

        content = response.content
        with Image.open(BytesIO(content)) as image:
            width, height = image.size
            phash = _average_hash(image)

        return FetchedImage(
            ok=True,
            width=width,
            height=height,
            content=content,
            content_type=content_type,
            sha256=hash_sha256(content),
            phash=phash,
        )
    except Exception as exc:
        return FetchedImage(
            ok=False,
            width=width_hint,
            height=height_hint,
            sha256=hash_sha256(url),
            phash=hash_sha256(f"phash:{url}")[:16],
            error=str(exc),
        )
