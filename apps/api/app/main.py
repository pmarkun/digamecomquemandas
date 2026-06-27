from collections import defaultdict, deque
from time import monotonic
from typing import Deque

from fastapi import APIRouter, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse

from .config import get_settings
from .db import init_db
from .routes.health import router as health_router
from .routes.extension import router as extension_router
from .routes.people import router as people_router
from .routes.admin import router as admin_router


def build_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="diga-me API", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            settings.allowed_extension_origin,
            settings.web_base_url,
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    request_timestamps: dict[str, deque[float]] = defaultdict(deque)

    @app.middleware("http")
    async def simple_rate_limit(request: Request, call_next):
        if request.method == "OPTIONS" or request.url.path.endswith("/health"):
            return await call_next(request)

        ip = request.client.host if request.client else "unknown"
        now = monotonic()
        bucket: Deque[float] = request_timestamps[ip]
        while bucket and (now - bucket[0]) > 60:
            bucket.popleft()
        if len(bucket) > 240:
            return JSONResponse(status_code=429, content={"detail": "Taxa de requisições excedida."})
        bucket.append(now)
        return await call_next(request)

    api = APIRouter(prefix="/api/v1")
    api.include_router(health_router)
    api.include_router(extension_router)
    api.include_router(people_router)
    api.include_router(admin_router)
    app.include_router(api)

    @app.on_event("startup")
    def startup() -> None:
        init_db()

    @app.get("/")
    def root() -> dict[str, str]:
        return {"name": "diga-me API", "status": "ok"}

    return app


app = build_app()
