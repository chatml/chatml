# Multi-stage build for the ChatML Cloud Relay server.
#
# Build context must be the repository root (not backend/) because
# go.mod has a replace directive for ../core.
#
# Usage:
#   docker build -f backend/cmd/relay/Dockerfile -t chatml-relay .
#   docker run -p 8787:8787 -e RELAY_ENV=dev chatml-relay

FROM golang:1.25-alpine AS builder
WORKDIR /src

# Copy module files first for layer caching
COPY backend/go.mod backend/go.sum backend/
COPY core/go.mod core/

WORKDIR /src/backend
RUN go mod download

# Copy source
WORKDIR /src
COPY core/ core/
COPY backend/ backend/

# Build the relay binary — no CGO needed (no SQLite in relay)
WORKDIR /src/backend
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /relay ./cmd/relay/

# --- Runtime ---
FROM alpine:3.21
RUN apk add --no-cache ca-certificates
COPY --from=builder /relay /usr/local/bin/relay

EXPOSE 8787
ENTRYPOINT ["relay"]
