from dataclasses import dataclass

import httpx


@dataclass
class FetchedImage:
    ok: bool
    width: int | None = None
    height: int | None = None
    content_type: str | None = None
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
