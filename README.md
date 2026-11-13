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
- `packs/` – question packs in YAML; see `packs/README.md` for the format and writing guide

## Licences

Code: MIT. Question packs: CC0 1.0 unless a pack says otherwise.
