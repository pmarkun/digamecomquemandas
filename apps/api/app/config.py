from functools import lru_cache
from typing import List

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="")

    database_url: str = "postgresql://postgres:postgres@localhost:5432/qtnf"
    redis_url: str = "redis://localhost:6379/0"
    seed_on_startup: bool = False

    api_base_url: str = "http://localhost:8000"
    web_base_url: str = "http://localhost:3000"

    admin_email: str = "admin@example.com"
    admin_password: str = "admin"

    face_model_name: str = "buffalo_l"
    face_match_threshold: float = 0.78
    face_display_threshold: float = 0.78
    face_auto_approve_threshold: float = 0.88
    face_auto_approve_gap: float = 0.06
    max_matches_per_face: int = 3

    store_original_images: bool = False
    allowed_extension_origin: str = "chrome-extension://*"
    article_discovery_browser_enabled: bool = False
    article_discovery_browser_executable: str | None = None
    article_discovery_timeout_seconds: float = 12.0
    article_discovery_max_images: int = 12
    article_discovery_min_image_dimension: int = 300

    allowed_domains_fallback: str = (
        "g1.globo.com,oglobo.globo.com,www1.folha.uol.com.br,www.estadao.com.br,"
        "noticias.uol.com.br,www.cnnbrasil.com.br,www.metropoles.com,www.poder360.com.br,"
        "www.cartacapital.com.br,www.brasildefato.com.br"
    )

    allow_sqlite_fallback: bool = True

    @field_validator("allowed_domains_fallback")
    @classmethod
    def _split_domains(cls, value: str) -> str:
        return value

    @property
    def allowed_domains(self) -> List[str]:
        return [value.strip() for value in self.allowed_domains_fallback.split(",") if value.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
