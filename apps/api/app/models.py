from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID, uuid4

from sqlmodel import Field, Relationship, SQLModel
from sqlalchemy import JSON, Column
from sqlalchemy.types import TypeDecorator
from pgvector.sqlalchemy import Vector


def utc_now() -> datetime:
    return datetime.now(tz=timezone.utc)


class EmbeddingVector(TypeDecorator):
    impl = JSON
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(Vector(128))
        return dialect.type_descriptor(JSON())

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, list):
            return value
        return list(value)


class Article(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True)
    url: str = Field(index=True, unique=True)
    canonical_url: Optional[str] = None
    domain: str
    title: Optional[str] = None
    published_at: Optional[datetime] = None
    captured_at: datetime = Field(default_factory=utc_now)
    created_at: datetime = Field(default_factory=utc_now)

    images: List["ArticleImage"] = Relationship(back_populates="article")


class ArticleImage(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True)
    article_id: UUID = Field(foreign_key="article.id")
    image_url: str
    sha256: Optional[str] = None
    phash: Optional[str] = None
    width: Optional[int] = None
    height: Optional[int] = None
    status: str = Field(default="PENDING")
    created_at: datetime = Field(default_factory=utc_now)

    article: Optional[Article] = Relationship(back_populates="images")
    faces: List["DetectedFace"] = Relationship(back_populates="article_image")


class Person(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True)
    slug: str = Field(index=True, unique=True)
    name: str
    display_name: str
    category: str
    description: Optional[str] = None
    public_office: Optional[str] = None
    status: str = Field(default="ACTIVE")
    is_public_figure: bool = True
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)

    source_urls: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    reference_images: List["PersonReferenceImage"] = Relationship(back_populates="person")
    embeddings: List["FaceEmbedding"] = Relationship(back_populates="person")


class PersonReferenceImage(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True)
    person_id: UUID = Field(foreign_key="person.id")
    source_url: str
    storage_path: Optional[str] = None
    sha256: Optional[str] = None
    phash: Optional[str] = None
    status: str = Field(default="ACTIVE")
    created_at: datetime = Field(default_factory=utc_now)

    person: Optional[Person] = Relationship(back_populates="reference_images")
    embeddings: List["FaceEmbedding"] = Relationship(back_populates="reference_image")


class FaceEmbedding(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True)
    person_id: UUID = Field(foreign_key="person.id")
    reference_image_id: UUID = Field(foreign_key="personreferenceimage.id")
    embedding: List[float] = Field(default_factory=list, sa_column=Column(JSON))
    embedding_vector: Optional[List[float]] = Field(default=None, sa_column=Column(EmbeddingVector()))
    model_name: str
    model_version: str
    quality_score: Optional[float] = None
    created_at: datetime = Field(default_factory=utc_now)

    person: Optional[Person] = Relationship(back_populates="embeddings")
    reference_image: Optional[PersonReferenceImage] = Relationship(back_populates="embeddings")


class DetectedFace(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True)
    article_image_id: UUID = Field(foreign_key="articleimage.id")
    bbox: Dict[str, float] = Field(sa_column=Column(JSON))
    embedding: Optional[List[float]] = Field(default=None, sa_column=Column(JSON))
    embedding_vector: Optional[List[float]] = Field(default=None, sa_column=Column(EmbeddingVector()))
    quality_score: Optional[float] = None
    model_name: str = "buffalo_l"
    model_version: str = "0.1"
    created_at: datetime = Field(default_factory=utc_now)

    article_image: Optional[ArticleImage] = Relationship(back_populates="faces")
    matches: List["FaceMatch"] = Relationship(back_populates="detected_face")
    suggestions: List["FaceSuggestion"] = Relationship(back_populates="detected_face")


class FaceMatch(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True)
    detected_face_id: UUID = Field(foreign_key="detectedface.id")
    person_id: UUID = Field(foreign_key="person.id")
    score: float
    distance: Optional[float] = None
    status: str = Field(default="AUTO")
    reviewed_by: Optional[UUID] = None
    reviewed_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)

    detected_face: Optional[DetectedFace] = Relationship(back_populates="matches")
    person: Optional[Person] = Relationship()


class ProfileEdit(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True)
    person_id: UUID = Field(foreign_key="person.id")
    editor_name: Optional[str] = None
    editor_email: Optional[str] = None
    body: Dict[str, Any] = Field(sa_column=Column(JSON))
    status: str = Field(default="PENDING")
    created_at: datetime = Field(default_factory=utc_now)


class OptoutRequest(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True)
    person_id: UUID = Field(foreign_key="person.id")
    requester_name: str
    requester_email: str
    relationship: Optional[str] = None
    message: Optional[str] = None
    verification_status: str = Field(default="PENDING")
    decision: Optional[str] = None
    decided_by: Optional[UUID] = None
    decided_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)


class AuditLog(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True)
    actor_type: str
    actor_id: Optional[str] = None
    action: str
    entity_type: str
    entity_id: Optional[UUID] = None
    metadata_json: Dict[str, Any] = Field(default_factory=dict, sa_column=Column("metadata", JSON))
    created_at: datetime = Field(default_factory=utc_now)


class AllowedDomain(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True)
    domain: str = Field(unique=True, index=True)
    enabled: bool = True
    created_at: datetime = Field(default_factory=utc_now)


class FaceSuggestion(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True)
    detected_face_id: UUID = Field(foreign_key="detectedface.id")
    suggested_name: str
    suggested_person_id: Optional[UUID] = Field(default=None, foreign_key="person.id")
    source_url: Optional[str] = None
    comment: Optional[str] = None
    submitter_email: Optional[str] = None
    status: str = Field(default="PENDING_REVIEW")
    reviewed_by: Optional[UUID] = None
    reviewed_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utc_now)

    detected_face: Optional[DetectedFace] = Relationship(back_populates="suggestions")
