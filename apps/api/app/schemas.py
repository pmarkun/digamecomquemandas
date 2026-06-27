from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class AnalyzeImage(BaseModel):
    image_url: str
    width: int | None = None
    height: int | None = None


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


class PersonCreate(BaseModel):
    name: str
    display_name: str
    slug: str
    category: str
    description: str | None = None
    public_office: str | None = None
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


class LoginIn(BaseModel):
    email: str
    password: str


class LoginOut(BaseModel):
    token: str
    role: str = "admin"
