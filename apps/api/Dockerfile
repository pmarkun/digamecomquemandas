FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir uv

COPY apps/api/pyproject.toml apps/api/
RUN cd apps/api && uv sync --no-cache

COPY . .

WORKDIR /app/apps/api

EXPOSE 8000
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
