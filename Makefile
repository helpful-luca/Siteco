.PHONY: up down dev-api dev-web test lint api-types fresh-clone

up:
	docker compose up --build

down:
	docker compose down

dev-api:
	cd backend && DATA_DIR=data EMBEDDING_CACHE_DIR=.models uv run uvicorn docchat.main:create_app --factory --reload --host 127.0.0.1 --port 8000

dev-web:
	cd frontend && BACKEND_URL=http://127.0.0.1:8000 npm run dev

test:
	cd backend && uv run pytest -m "not model"
	cd frontend && npm run test

lint:
	cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run lint-imports
	cd frontend && npm run lint && npm run typecheck

api-types:
	cd backend && uv run python -m docchat.cli.export_openapi > ../contracts/openapi.json
	cd frontend && npx openapi-typescript ../contracts/openapi.json -o src/shared/api/schema.gen.ts

fresh-clone:
	./scripts/fresh-clone-test.sh
