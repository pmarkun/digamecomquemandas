FROM mcr.microsoft.com/playwright/python:v1.60.0-noble

WORKDIR /app

RUN pip install --no-cache-dir uv

COPY apps/api/pyproject.toml apps/api/uv.lock apps/api/
RUN cd apps/api && uv sync --frozen --no-cache

COPY . .

WORKDIR /app/apps/api

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
EXPOSE 8000
CMD ["sh", "-c", "uv run uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
