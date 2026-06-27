FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir uv

COPY apps/worker/pyproject.toml apps/worker/
RUN cd apps/worker && uv sync --no-cache

COPY . .

WORKDIR /app/apps/worker

CMD ["uv", "run", "python", "-m", "app.worker"]
