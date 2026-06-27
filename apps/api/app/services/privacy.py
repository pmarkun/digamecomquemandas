import hashlib


def hash_sha256(value: str | bytes) -> str:
    if isinstance(value, bytes):
        return hashlib.sha256(value).hexdigest()
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def perceptual_hash(value: str) -> str:
    # Placeholder de pHash (mínimo de exemplo), suficiente para deduplicação de URL.
    return hashlib.md5(value.encode("utf-8")).hexdigest()[:16]


def ensure_domain(url: str) -> str:
    # Fallback simples para evitar erros de host
    from urllib.parse import urlparse

    return urlparse(url).netloc.lower()
