from pathlib import Path

from sqlalchemy import text
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

    if engine.dialect.name == "postgresql":
        with engine.begin() as connection:
            connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))

    SQLModel.metadata.create_all(engine)

    if engine.dialect.name == "postgresql":
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE faceembedding ADD COLUMN IF NOT EXISTS embedding_vector vector(512)"))
            connection.execute(text("ALTER TABLE detectedface ADD COLUMN IF NOT EXISTS embedding_vector vector(512)"))
            connection.execute(
                text(
                    "UPDATE faceembedding "
                    "SET embedding_vector = embedding::text::vector "
                    "WHERE embedding_vector IS NULL AND embedding IS NOT NULL"
                )
            )
            connection.execute(
                text(
                    "UPDATE detectedface "
                    "SET embedding_vector = embedding::text::vector "
                    "WHERE embedding_vector IS NULL AND embedding IS NOT NULL"
                )
            )
            connection.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS idx_faceembedding_embedding_vector_cosine "
                    "ON faceembedding USING ivfflat (embedding_vector vector_cosine_ops) WITH (lists = 10)"
                )
            )


def get_session():
    with Session(engine) as session:
        yield session
