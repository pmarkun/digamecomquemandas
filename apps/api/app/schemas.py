from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class DetectedFaceIn(BaseModel):
    x: float
    y: float
    w: float
    h: float
    score: float | None = None
    embedding: list[float] | None = None
    embedding_model: str | None = None


class AdminDetectedFaceIn(DetectedFaceIn):
    person_id: UUID | None = None


class AdminAddFacesIn(BaseModel):
    faces: list[AdminDetectedFaceIn]


class AnalyzeImage(BaseModel):
    image_url: str
    width: int | None = None
    height: int | None = None
    faces: list[DetectedFaceIn] | None = None


class AnalyzePageRequest(BaseModel):
    page_url: str
    title: str | None = None
    images: List[AnalyzeImage]


class BBox(BaseModel):
    x: float
    y: float
    w: float
    h: float


class MatchOut(BaseModel):
    person_id: str
    name: str
    slug: str
    score: float
    profile_url: str
    status: str | None = None


class FaceOut(BaseModel):
    face_id: str
    bbox: BBox
    matches: List[MatchOut]


class AnalyzeImageOut(BaseModel):
    image_url: str
    image_id: str
    faces: List[FaceOut]
    suggestions_enabled: bool = True


class AnalyzePageResponse(BaseModel):
    article_id: str
    results: List[AnalyzeImageOut]
    warnings: list[str] = Field(default_factory=list)


class DiscoverArticleImagesRequest(BaseModel):
    page_url: str
    render_browser: bool | None = None
    max_images: int | None = Field(default=None, ge=1, le=40)
    debug: bool = False


class ArticleImageCandidate(BaseModel):
    image_url: str
    width: int | None = None
    height: int | None = None
    alt: str | None = None
    source: str = "html"
    score: float


class IgnoredArticleImageCandidate(ArticleImageCandidate):
    reason: str


class DiscoverArticleImagesResponse(BaseModel):
    page_url: str
    title: str | None = None
    images: list[ArticleImageCandidate]
    ignored_images: list[IgnoredArticleImageCandidate] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class DebugPersonScoreOut(BaseModel):
    person_id: str
    name: str
    slug: str
    score: float | None = None
    distance: float | None = None
    status: str | None = None
    warning: str | None = None


class PersonCreate(BaseModel):
    name: str
    display_name: str
    slug: str
    category: str
    description: str | None = None
    public_office: str | None = None
    source_urls: list[str] = Field(default_factory=list)


class PersonUpdate(BaseModel):
    name: str
    display_name: str
    slug: str
    category: str
    description: str | None = None
    public_office: str | None = None
    status: str
    source_urls: list[str] = Field(default_factory=list)


class PersonOut(BaseModel):
    id: str
    slug: str
    name: str
    display_name: str
    category: str
    description: str | None = None
    public_office: str | None = None
    status: str
    created_at: datetime


class InfluenceGraphPerson(BaseModel):
    id: str
    slug: str
    name: str
    display_name: str


class InfluenceGraphNode(InfluenceGraphPerson):
    image_count: int = 0
    article_count: int = 0
    total_count: int = 0
    weight: int = 0
    last_article_id: str | None = None
    last_article_title: str | None = None


class InfluenceGraphEdge(BaseModel):
    source: str
    target: str
    image_count: int = 0
    article_count: int = 0
    total_count: int = 0
    weight: int = 0
    last_article_id: str | None = None
    last_article_title: str | None = None


class InfluenceGraphOut(BaseModel):
    center: InfluenceGraphPerson
    nodes: list[InfluenceGraphNode]
    edges: list[InfluenceGraphEdge]
    image_scope_count: int = 0
    article_scope_count: int = 0


class ReferenceImageIn(BaseModel):
    source_url: str
    model_name: str = "buffalo_l"
    model_version: str = "0.1"


class ReferenceImageOut(BaseModel):
    id: str
    source_url: str
    status: str


class MatchReviewIn(BaseModel):
    status: str


class MatchReassignIn(BaseModel):
    person_id: UUID
    status: str = "APPROVED"


class ContestRequest(BaseModel):
    requester_name: str
    requester_email: str
    relationship: str | None = None
    message: str | None = None


class SuggestionCreate(BaseModel):
    suggested_name: str
    suggested_person_id: UUID | None = None
    source_url: str | None = None
    comment: str | None = None
    submitter_email: str | None = None


class BootstrapRunCreate(BaseModel):
    limit_per_source: int = Field(default=10, ge=1, le=50)
    render_browser: bool = True


class BootstrapRunArticleAttach(BaseModel):
    article_id: UUID | None = None
    status: str
    image_count: int = 0
    face_count: int = 0
    warnings: list[str] = Field(default_factory=list)


class BootstrapLabelGroupIn(BaseModel):
    face_ids: list[UUID]
    person_id: UUID | None = None
    name: str | None = None


class LoginIn(BaseModel):
    email: str
    password: str


class LoginOut(BaseModel):
    token: str
    role: str = "admin"
