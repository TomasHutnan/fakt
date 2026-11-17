# Fakt?

A free Slovak party quiz for one phone passed around a table of friends, or for playing alone. Each card shows ten options; pick the true ones, stop whenever you like, and lose the card's points on a wrong pick.

Live at https://fakt.hutnan.dev (once DNS is set up).

## Develop

```sh
npm install
npm run dev          # builds packs, starts Vite
npm test             # engine and validator tests
npm run packs:check  # validate question packs
npm run build        # production build to dist/
npm start            # Node server: serves dist/ and runs rooms (PORT, default 8080)
```

`npm run dev` forwards room sockets (`/ws`) to `npm start` on port 8080, so run both to try rooms.

- `src/engine/` – game rules as pure functions (seeded decks, scoring, reducer)
- `src/content/` – pack format and validation
- `src/ui/` – Preact screens
- `src/designs/` – switchable visual designs (`?design=<id>`, gallery at `#designs`)
- `src/server/` – Node server for the container: serves `dist/` and runs rooms over WebSocket
- `src/net/` – room protocol and the reconnecting browser client
- `packs/` – question packs in YAML; see `packs/README.md` for the format and writing guide

## Deploy

Every push to `main` publishes `ghcr.io/tomashutnan/fakt` (amd64 and arm64), tagged `latest` and by
commit (`sha-1a2b3c4`). The image holds the built app and the server that serves it and runs the rooms on port 8080,
with `/healthz` for health checks. The server runs from TypeScript through Node's type stripping;
its only dependency is `ws`. Rooms live in memory and are written to `/data/rooms.json` on shutdown,
so a restart or update does not end running games. Limits (rooms, connections, pack memory, room
lifetime) are set in `.env`; see `.env.example`.

`compose.vps.yaml` runs it behind caddy-docker-proxy on the shared `web` network:

```sh
mkdir ~/fakt && cd ~/fakt
curl -fsSLo compose.yaml https://raw.githubusercontent.com/TomasHutnan/fakt/main/compose.vps.yaml
curl -fsSLo .env https://raw.githubusercontent.com/TomasHutnan/fakt/main/.env.example
sudo install -d -o 1000 -g 1000 /home/deploy/data/fakt
nano .env
docker compose up -d
```

Update with `docker compose pull && docker compose up -d`; roll back by setting `FAKT_IMAGE_TAG`.
Try the image locally with `docker build -t fakt . && docker run --rm -p 8080:8080 fakt`.

## Licences

Code: MIT. Question packs: CC0 1.0 unless a pack says otherwise.
