# AGENTS.md

Project name: **Fakt?** (Slovak/Czech "really?", reads as "fact"), hosted at `fakt.hutnan.dev`.

Context for AI agents and new sessions. Keep this file short and current; update it when a decision is made.

## What this is

A free, non-monetized knowledge quiz game for playing alone or with a group of friends on one phone passed around. Static website (PWA), maybe an app later. Inspired by playing https://chytrak.eu/ with friends, which has too few questions, no custom question sets, and sells extra questions.

Goals, in the owner's words:

- Question sets ("packs") live in this repo, and users can also import a pack locally.
- Slovak-specific and fun content from all parts of life: top 5 songs of Slovak rap/pop stars, which fish live in Slovakia, etc.
- Not too obscure. A wrong answer should still be something to laugh about.
- Packs can be switched off if a topic does not interest the group.

## Status (2026-11-17)

Live at `fakt.hutnan.dev` on the owner's VPS; `main` builds the image, the owner pulls it. Playtest feedback round merged 2026-11-17; favourite topics decided but not built (see `notes/Decisions.md`).

- Built: Mix (default) and Classic modes, rooms (everyone on own phone + big screen), last place picks the pack every 3rd round (the double final round was dropped), tie-break for a shared lead (one number card for the tied leaders), social lines and end titles, all formats, per-turn answers drawn in place, 4 designs (Kartotéka default, gallery at `#designs`), post-game ratings (👍/😐/👎) and per-card reports sent in the background to the owner's Google Form, quick settings (design, sound, vibration) during a game, rooms: answers count down and move on with a pace, standings on phones without a big screen, quick starts, "+N nové" badges, opt-in packs (`defaultOn: false`), pack categories (collapsible sections, 18+ last) and search, sticky back bar, vibration/sound settings, import, offline PWA.
- Content: **31 packs / 836 questions** (4 adult, 5 opt-in: Dano Drevo, Politické hlášky, athletics legends and season, Zvláštne jedlá sveta). Target 1,000.
- Next: playtest, then fandom and culture packs (cult films, Slovak TV, YouTube, 80s/90s music, games, ads), a Wikidata generator with a fame filter. Full list: `notes/Roadmap.md`.
- Owner's notes (not in the repo): `notes/Description.md` is the hub; `notes/Decisions.md` holds the decision log and open questions; `notes/Content.md` the pack list and pipeline. `docs/research-report.html` is pre-decision research (the notes win where they disagree).

## Workflow

- Work on branches. **Merging into `main` and pushing require a passing review by Gemini Hydrogen** (owner's rule). Write the prompt to a file (`docs/.review-<name>.prompt`, deleted afterwards) and run `python scripts/agy-readonly.py gemini-4-hydrogen-high <prompt-file> <out-file>`; the prompt asks for `severity file:line — issue` lines and a final `VERDICT: PASS|FAIL`. Fix blocker/major findings and re-run until PASS. Check findings before acting: Gemini is often wrong.
- `agy` runs only through `scripts/agy-readonly.py` (read-only allow-list), never with `--dangerously-skip-permissions`. Tell Gemini not to open `notes/` (symlink outside the repo): a denied read makes the whole run return nothing.
- **Content pipeline**: a Claude subagent drafts a pack from sources it opens itself → Gemini Hydrogen fact-checks → the writer verifies each finding against a source and applies only confirmed ones (drops what can't be settled) → Hydrogen re-review to PASS → merge. WebFetch returns a model summary, so check numbers against the raw page. Long runs hit the usage limit: resume the same agent afterwards rather than starting over.
- Checks: `npm test`, `npm run packs:check`, `npm run build`; UI play test: `npx vite preview --port 4174` then `node scripts/e2e.ts http://localhost:4174/`; room play test (3 phones + big screen): `PORT=4180 FAKT_ROOMS_PER_IP=50 FAKT_CREATES_PER_10MIN=100 npm start` then `node scripts/e2e-rooms.ts http://localhost:4180/`; container: `docker build -t fakt . && docker run --rm -p 4180:8080 fakt`, then the e2e script against it; screenshots: `BASE_URL=http://localhost:4174/ node scripts/screenshots.ts <dir> [designId…]` (check all four designs, light and dark, after UI changes).
- Commits are not signed in this repo (owner's rule): use `git -c commit.gpgsign=false commit`, never re-sign or wait for GPG pinentry. Repo-local git config sets `commit.gpgsign=false`.

## Rules for agents

- `notes/` is a symlink into the owner's separate Obsidian vault. You may read and edit the Markdown there. **Never commit it, never `git add` it, never remove it from `.gitignore`.**
- `reference/` (owner's material, e.g. subtitles) is not ours: never commit or edit it. Reading it as a source is fine.
- Commits on feature branches are allowed; merge to `main` and push only after a passing Hydrogen review. Remote: `origin` = github.com/TomasHutnan/fakt (public).
- Offload simple, mechanical tasks (page fetches, searches, bulk conversions) to cheaper models/subagents.
- Do not copy question text, names, artwork or visual identity from Chytrák, Smart10/Desítka or any other quiz product. Mechanics may be reused; content and identity must be original.
- Do not scrape or bulk-copy question pools or chart sites. Individual facts with a cited source are fine.
- Every question needs a `source`; time-sensitive facts need `asOf`; every pick/choice option (and every number question) needs a one-line `why`; order items should have one. Language-model facts are checked against the source before merge.
- **Nothing hateful or untrue**, also in spicy packs. Quotes of real people verbatim as printed by a reliable source; no claims of wrongdoing beyond the source.
- Crude content never switches on by itself: strong material (sexual, drugs, racism, heavy vulgarity) goes into an 18+ pack; mildly crude packs may be normal with `defaultOn: false`. Either way they need `warnings` (validation enforces it).
- Question content is primarily Slovak (Czech acceptable). Code, comments and docs are in English.

## Decisions (owner, 2026-11-13)

- **Play**: one phone passed around, hand-over screen "pass to <name>, tap to continue". Multiplayer on own phones: see below. A team is simply entered as one player.
- **Classic**: 10 options, 2–8 true (count hidden; setting shows it). Each player plays the whole card alone. k-th correct pick = k points; bank any time; wrong pick wipes the card (setting: only ends the turn). 10 rounds by default, target score as a setting.
- **Answers**: shown to each player right after their turn, drawn in place on the grid they answered in (setting: everyone after the round).
- **Formats**: pick, order (dragged), number guess (closeness solo, ranked in multiplayer), one of four, which is more (derived from order questions in Mix). Never free-text answers; no pictures/audio in the first year.
- **Later modes**: Guess and bet, challenge link (after rooms work). Daily card, Teams, card-level content tags: not now. Bluff, typed list recall: dropped.
- **Languages**: Slovak UI. Slovak packs first; English packs later, written directly, no translation. Czech allowed.
- **Content**: adult packs welcome (labelled, off by default, content-warning tags); niche or mildly crude packs can be normal but off by default (`defaultOn: false`, 2026-11-16); spicy packs live in the public repo. Targets: 1,000 questions before sharing widely.
- **Packs**: YAML in `packs/`, built to per-pack JSON + index with hashes; importer accepts YAML and JSON, stores imports in the browser. Packs CC0 (per-pack `license` allowed); code MIT. CC BY-SA sources (Open Trivia DB, OpenTriviaQA) cannot go into CC0 packs.
- **Stack**: TypeScript + Vite + Preact, static SPA + PWA. Pure TS engine (state + action → state), decks from a seed.
- **Hosting** (2026-11-17): one Docker image (`ghcr.io/tomashutnan/fakt`, built by CI on `main`) serves the app and the room server on the owner's VPS behind caddy-docker-proxy (`compose.vps.yaml`); the owner pulls updates by hand in Dockge. GitHub Pages is retired.
- **Multiplayer** (2026-11-17): rooms on the same server, everyone on their own phone, optional big screen, remote play allowed; creator uploads enabled packs, the room runs the engine. See `notes/Decisions.md`.
- **Reports/ratings**: owner's Google Form (`src/ui/links.ts`), posted in the background from the app (prefilled link only as an offline fallback), not GitHub issues.
- **App store**: keep possible as long as it does not limit the web version.

## Key research findings

- **Chytrák**: native app, one device, 1–5 players, 10 options with 5 true, escalating points, wrong pick wipes the question; same mechanic as the board game Smart10.
- **No openly licensed Slovak or Czech trivia pool exists.** Usable: Wikidata (CC0), Wikipedia/Wikiquote facts, ŠÚ SR / Eurostat / OWID (CC BY). Avoid: The Trivia API (CC BY-NC), Jeopardy dumps, TriviaQA, TMDB, scraped chart or quiz sites.

## Repo layout

```
packs/            question packs (YAML source, CC0) + README with format and writing guide
src/content/      pack types and validation (shared by build script and importer)
src/engine/       game rules: seeded RNG, card drawing, scoring, reducer, room reducer + views (pure, tested)
src/ui/           Preact screens, storage, Slovak texts (sk.ts), links (report form), feedback (vibration/sound), demo states
src/designs/      switchable designs: <id>/meta.ts + <id>/design.css (see README there)
src/server/       Node server in the container: static app, WebSocket room hub with limits and snapshots; runs via type stripping
src/net/          room protocol (shared) and the browser's reconnecting client
scripts/          build-packs, screenshots, e2e play test, agy-readonly (Gemini wrapper), dano-drevo-counts (word counts from subtitles)
docs/             research report
notes/            symlink to the owner's Obsidian vault (ignored, never commit)
reference/        owner's reference material (never commit)
```
