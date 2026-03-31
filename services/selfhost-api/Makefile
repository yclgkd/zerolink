GO ?= go
SQLC ?= sqlc

.PHONY: run migrate sqlc-generate test test-race

run:
	$(GO) run ./cmd/selfhost-api

migrate:
	$(GO) run ./cmd/selfhost-migrate

sqlc-generate:
	$(SQLC) generate

test:
	$(GO) test ./...

test-race:
	$(GO) test -race ./...
