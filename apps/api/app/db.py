from pathlib import Path

from sqlalchemy.exc import OperationalError
from sqlmodel import Session, SQLModel, create_engine

from .config import get_settings


def _normalize_url(url: str) -> str:
    if "sqlite://" in url or url.startswith("sqlite:"):
        return url
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


def make_engine() -> object:
    settings = get_settings()
    url = _normalize_url(settings.database_url)

    if url.startswith("sqlite:"):
        connect_args = {"check_same_thread": False}
        return create_engine(url, connect_args=connect_args)

    try:
        candidate = create_engine(url)
        # valida conexão uma vez para decidir fallback em ambientes sem Postgres local
        with candidate.connect():
            pass
        return candidate
    except OperationalError:
        if not settings.allow_sqlite_fallback:
            raise

    repo_root = Path(__file__).resolve().parents[3]
    fallback = f"sqlite:///{repo_root / 'qtnf.sqlite3'}"
    connect_args = {"check_same_thread": False}
    return create_engine(fallback, connect_args=connect_args)


engine = make_engine()


def init_db() -> None:
    from . import models  # noqa: F401

    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session
