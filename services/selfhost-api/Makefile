GO ?= go

.PHONY: run migrate test test-race

run:
	$(GO) run ./cmd/selfhost-api

migrate:
	$(GO) run ./cmd/selfhost-migrate

test:
	$(GO) test ./...

test-race:
	$(GO) test -race ./...
