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
```

- `src/engine/` – game rules as pure functions (seeded decks, scoring, reducer)
- `src/content/` – pack format and validation
- `src/ui/` – Preact screens
- `src/designs/` – switchable visual designs (`?design=<id>`, gallery at `#designs`)
- `src/server/` – Node server for the container: serves `dist/` (room server to come)
- `packs/` – question packs in YAML; see `packs/README.md` for the format and writing guide

## Deploy

Every push to `main` publishes `ghcr.io/tomashutnan/fakt` (amd64 and arm64), tagged `latest` and by
commit (`sha-1a2b3c4`). The image holds the built app and the server that serves it on port 8080,
with `/healthz` for health checks. It needs no `node_modules`: the server uses only Node's standard
library and runs from TypeScript through Node's type stripping.

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
