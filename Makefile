.PHONY: up down dev-clamav dev-model dev-api dev-web install test lint api-types e2e

up:
	docker compose up --build

down:
	docker compose down

# The malware scan is always on: clamd from compose.dev.yaml, published on 127.0.0.1:3310.
dev-clamav:
	docker compose -f compose.yaml -f compose.dev.yaml up -d clamav

# The embedding model (about 400 MB) is downloaded once into backend/.models.
dev-model:
	test -d backend/.models/models--ibm-granite--granite-embedding-97m-multilingual-r2 || \
		(cd backend && EMBEDDING_CACHE_DIR=.models uv run python -m docchat.cli.download_model)

# Reads the same .env as Docker Compose, if there is one.
dev-api: dev-clamav dev-model
	cd backend && DATA_DIR=data EMBEDDING_CACHE_DIR=.models CLAMD_HOST=127.0.0.1 CLAMD_PORT=3310 uv run uvicorn docchat.main:create_app --factory --reload --host 127.0.0.1 --port 8000 $(if $(wildcard .env),--env-file ../.env)

dev-web:
	cd frontend && BACKEND_URL=http://127.0.0.1:8000 npm run dev

# Installs the frontend and desktop dependencies once, as `make test` and `make lint` need them.
install:
	test -d frontend/node_modules || npm --prefix frontend ci
	test -d desktop/node_modules || npm --prefix desktop ci

test: install
	cd backend && uv run pytest -m "not model"
	cd frontend && npm test
	cd desktop && npm test

lint: install
	cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run lint-imports
	cd frontend && npm run lint && npm run typecheck
	cd desktop && npm run typecheck

api-types:
	cd backend && uv run python -m docchat.cli.export_openapi > ../contracts/openapi.json
	cd frontend && npx openapi-typescript ../contracts/openapi.json -o src/shared/api/schema.gen.ts

# Browser E2E against the Docker stack, with the fake model and without a key (needs Docker and Chrome or Chromium).
e2e:
	./scripts/e2e.sh
