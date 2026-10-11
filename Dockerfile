# syntax=docker/dockerfile:1

# 1. The interface, exported as static files.
FROM node:22-slim AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# 2. The server, with the interface embedded.
FROM golang:1.26 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd cmd
COPY internal internal
COPY web/embed.go web/embed.go
COPY --from=web /src/web/out web/out
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/games ./cmd/games

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/games /games
ENV GAMES_ADDR=:3778
EXPOSE 3778
ENTRYPOINT ["/games"]
