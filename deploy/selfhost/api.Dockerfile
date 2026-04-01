FROM golang:1.24.0 AS build

WORKDIR /app
COPY services/selfhost-api ./services/selfhost-api
WORKDIR /app/services/selfhost-api

RUN /usr/local/go/bin/go mod download
RUN CGO_ENABLED=0 /usr/local/go/bin/go build -o /out/selfhost-api ./cmd/selfhost-api
RUN CGO_ENABLED=0 /usr/local/go/bin/go build -o /out/selfhost-migrate ./cmd/selfhost-migrate

FROM alpine:3.20

RUN apk add --no-cache ca-certificates && \
    addgroup -S zerolink && \
    adduser -S zerolink -G zerolink

COPY --from=build /out/selfhost-api /usr/local/bin/selfhost-api
COPY --from=build /out/selfhost-migrate /usr/local/bin/selfhost-migrate

USER zerolink
ENTRYPOINT ["selfhost-api"]
