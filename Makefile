.PHONY: test lint migrate-up dev-api dev-worker

test:
	cd apps/api && go test ./...

lint:
	cd apps/api && go vet ./...

migrate-up:
	docker compose run --rm migrate

dev-api:
	cd apps/api && go run ./cmd/api

dev-worker:
	cd apps/api && go run ./cmd/worker
