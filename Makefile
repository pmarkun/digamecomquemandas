SHELL := /usr/bin/env bash
UV_CACHE_DIR ?= /tmp/.uv_cache
PNPM_DATA_DIR ?= /tmp/.pnpm-data
PNPM_STORE_DIR ?= /tmp/.pnpm-store

.PHONY: setup dev migrate seed test lint

export UV_CACHE_DIR
export PNPM_HOME := $(PNPM_DATA_DIR)

setup:
	@mkdir -p apps/extension/src apps/web/app apps/api/app apps/worker/app packages/shared infra/docker infra/migrations infra/seed
	@cp -n .env.example .env
	@mkdir -p $(UV_CACHE_DIR) $(PNPM_DATA_DIR) $(PNPM_STORE_DIR)
	@cd apps/api && UV_CACHE_DIR=$(UV_CACHE_DIR) uv sync
	@cd apps/worker && UV_CACHE_DIR=$(UV_CACHE_DIR) uv sync
	@XDG_DATA_HOME=/tmp pnpm install --filter ./apps/extension
	@XDG_DATA_HOME=/tmp pnpm install --filter ./apps/web
	@echo "Dependências do projeto instaladas."

dev:
	@docker compose -f infra/docker/docker-compose.yml up --build

migrate:
	@cd apps/api && UV_CACHE_DIR=$(UV_CACHE_DIR) uv run python -c "from app.db import init_db; init_db(); print('migrado')"

seed:
	@cd apps/api && UV_CACHE_DIR=$(UV_CACHE_DIR) uv run python -m app.seed

test:
	@python3 scripts/smoke_spec_checks.py

lint:
	@cd apps/web && XDG_DATA_HOME=/tmp pnpm lint
	@cd apps/api && UV_CACHE_DIR=$(UV_CACHE_DIR) uv run python -m compileall app
	@cd apps/worker && UV_CACHE_DIR=$(UV_CACHE_DIR) uv run python -m compileall app
