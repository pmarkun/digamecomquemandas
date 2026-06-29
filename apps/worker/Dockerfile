FROM python:3.12-slim

WORKDIR /app

RUN pip install --no-cache-dir uv

COPY pyproject.toml ./
RUN uv sync --no-cache && uv run playwright install --with-deps chromium

COPY app ./app

CMD ["uv", "run", "python", "-m", "app.worker"]
