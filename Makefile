.PHONY: db web build run dev test e2e check art chart docker

# The PostgreSQL started by "make db" (compose.yaml). Point these elsewhere to
# use another one; the tests work in a schema of their own and drop it.
export GAMES_DATABASE_URL ?= postgres://games:games@127.0.0.1:5432/games
export GAMES_TEST_DATABASE_URL ?= $(GAMES_DATABASE_URL)

db:
	docker compose up -d --wait postgres

web:
	cd web && npm ci --no-audit --no-fund && npm run build

build: web
	CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o bin/games ./cmd/games

# Serve the built interface and the API on http://localhost:3778.
run: build
	./bin/games

# API on :3778 plus the Next.js dev server (hot reload) on http://localhost:3000.
dev:
	@test -d web/out || (mkdir -p web/out && touch web/out/.keep)
	@test -d web/node_modules || (cd web && npm ci --no-audit --no-fund)
	go run ./cmd/games & cd web && npm run dev

test:
	@test -d web/out || (mkdir -p web/out && touch web/out/.keep)
	go test -race ./...

# Play the end-to-end scenarios in a real browser against a running server
# (make run, or GAMES_URL). They create "e2e_…" accounts: for a development base.
e2e:
	cd web && npm run e2e

check: test chart
	go vet ./...
	cd web && npm run typecheck

# Rebuild the logo files from art/brand/src/logo.png.
art:
	python3 art/build.py

# Render the Helm chart offline; nothing is sent to a cluster.
chart:
	bash chart/tests/check.sh

docker:
	docker build -t games .
