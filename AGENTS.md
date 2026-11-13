# AGENTS.md

Project name: **Fakt?** (Slovak/Czech "really?", reads as "fact"), hosted at `fakt.hutnan.dev`.

Context for AI agents and new sessions. Keep this file short and current; update it when a decision is made.

## What this is

A free, non-monetized knowledge quiz game for playing alone or with a group of friends. Website first (ideally fully static), maybe an app later. Inspired by playing https://chytrak.eu/ with friends, which has too few questions, no custom question sets, and sells extra questions.

Goals, in the owner's words:

- Question sets ("packs") live in this repo, and users can also import a pack locally.
- Slovak-specific and fun content from all parts of life: top 5 songs of Slovak rap/pop stars, which fish live in Slovakia, etc.
- Not too obscure. A wrong answer should still be something to laugh about.
- Packs can be switched off if a topic does not interest the group.

## Status

v1 prototype built on branch `feat/v1-prototype` (2026-11-13): engine, pack format and importer, Preact UI with rules screen, 6 switchable designs (gallery at `#designs`; Kartotéka is the default, owner's choice 2026-11-13), 18 packs / 454 questions (adult packs carry content-warning tags), every pack cross-model fact-checked. Plan: `notes/V1 Plan.md`. Decisions: `notes/Open Questions.md` and the section below. Next: more packs toward 1,000 questions.

- Report: `docs/research-report.html` (pre-decision research; where it disagrees with this file or the notes, they win).

## Workflow

- Work on branches. **Merging into `main` and pushing require a passing review by Gemini Hydrogen** (owner's rule, 2026-11-13). Run it with `python scripts/agy-readonly.py gemini-4-hydrogen-high <prompt> <out>`; the prompt asks for findings and a final `VERDICT: PASS|FAIL`. Fix blocker/major findings and re-run until PASS.
- `agy` must run through `scripts/agy-readonly.py` (read-only allow-list). Do not run agy with `--dangerously-skip-permissions`; Gemini returns text (e.g. YAML) and Claude writes the files. Tell Gemini not to open `notes/` (symlink outside the repo): a denied read makes the whole run return nothing.
- Content: packs are drafted by one model and fact-checked by the other (Gemini checks Claude packs, Claude checks Gemini packs) before merge. Writers must not use facts they did not see in a source this session. Tip for sk.wikipedia: percent-encode diacritics or use `https://sk.wikipedia.org/w/index.php?search=<term>`.
- Checks: `npm test`, `npm run packs:check`, `npm run build`; UI smoke test: `npx vite preview --port 4174` then `node scripts/e2e.ts http://localhost:4174/`; screenshots of designs: `node scripts/screenshots.ts <dir> [designId…]`.
- Commits are made with `-c commit.gpgsign=false` when the owner is away (GPG pinentry cannot be answered unattended); the owner may re-sign.
- `reference/` (owner's material, e.g. subtitles) is not ours: never commit or edit it. Reading it as a source is fine (the Dano Drevo pack cites the films' subtitles with timestamps).

## Rules for agents

- `notes/` is a symlink into the owner's separate Obsidian vault. You may read and edit the Markdown there. **Never commit it, never `git add` it, never remove it from `.gitignore`.** The owner manages that vault separately.
- Commits on feature branches are allowed; merge to `main` and push only after a passing Hydrogen review (see Workflow). Remote: `origin` = github.com/TomasHutnan/fakt (public).
- Offload simple, mechanical tasks (page fetches, searches, bulk conversions) to cheaper models/subagents.
- Do not copy question text, names, artwork or visual identity from Chytrák, Smart10/Desítka or any other quiz product. Mechanics may be reused; content and identity must be original.
- Do not scrape or bulk-copy question pools or chart sites. Individual facts with a cited source are fine.
- Every question needs a `source`. Time-sensitive facts need an `asOf` date. Facts drafted by a language model must be checked against the source before merge.
- Question content is primarily Slovak (Czech acceptable). Code, comments and docs are in English.

## Key research findings

- **Chytrák**: native app, one device passed around, 1-5 players. 10 options per question, 5 true and 5 false; correct picks add increasing points, a wrong pick wipes the points from that question; play to a target score. Mechanic matches the board game Smart10 (unconfirmed link).
- **No openly licensed Slovak or Czech trivia pool exists.** Content must be generated, translated or hand-written.
- **Usable data**: Wikidata (CC0; good for peaks, towns, films, people; cannot answer "species living in Slovakia"), OpenTriviaQA (~49k EN, CC BY-SA 4.0), Open Trivia DB (~5.3k verified EN, CC BY-SA 4.0), Slovak Statistical Office / Eurostat / OWID / GeoNames (CC BY).
- **Avoid**: The Trivia API (CC BY-NC), Jeopardy/J! Archive dumps, TriviaQA, TMDB, scraped chart or quiz sites.
- Anything derived from the CC BY-SA sets must stay CC BY-SA 4.0 with attribution.
- **Static is enough**: ~10k short questions is an estimated 1 MB compressed; ship per-pack JSON, lazy-load, cache with a service worker.
- **Multiplayer**: pass-and-play needs nothing. Phones can join peer to peer (Trystero over WebRTC) with the host browser as authority. Fallback is a Cloudflare Durable Object relay (free plan) or a relay on the owner's own server. Skip Supabase (free projects pause), CRDT libraries (overkill).

## Decisions (2026-11-13)

- **Play**: v1 is one phone passed around, with a hand-over screen between players showing only "pass to <name>, tap to continue" (integral to v1). Network play is v3 and only together with a big-screen host view (Jackbox style), same room. No remote play.
- **Classic mode**: 10 options per card, 2–8 true (count hidden by default, a setting can show it). Each player plays the whole card alone, then hands over. k-th correct pick is worth k points; bank any time; wrong pick wipes the card's points (setting: only ends the turn). 10 rounds by default, target score as a setting. Answers are shown to each player right after their turn by default (setting: everyone after the round). Order cards are dragged.
- **Other modes**: Solo run, Mix, Teams (v1); Daily card (v2); Everyone at once, Guess and bet (v3, big screen). Bluff and typed list recall are dropped.
- **Input**: tap options or type a **number** (year, amount). Never free-text typing. Number guesses: closeness-based scoring solo, ranked points in multiplayer.
- **Formats v1**: pick the true ones, put in order, number guess, one of four. "Which is more" in v2. No pictures/audio in the first year.
- **Languages**: Slovak UI. Slovak packs first; English packs later for international questions, written directly, **no translation**. Czech packs allowed, low priority.
- **Content**: packs written by the owner in the repo. Language-model drafts OK; every fact checked against its source; **every option needs an explanation** of why it is right or wrong. Time-sensitive facts kept with `asOf`. Adult packs welcome: labelled, off by default, switched on like any pack. Explanations are one line per option, longer only where really necessary. Kids packs v4+.
- **Targets**: 200 cards in 8 packs for the first evening, 1,000 before sharing widely.
- **Data model**: "one fact list, several formats" — a list question stores items (optionally with values) plus decoys; the game derives pick/order/compare cards from it.
- **Packs**: YAML source in `packs/`, built to per-pack JSON plus an index with content hashes; importer accepts YAML and JSON, stores imports in the browser.
- **Stack**: TypeScript + Vite + **Preact**, static SPA + PWA. Pure TS engine (state + action -> state), content layer, UI, transport behind `join/send/onMessage`. Decks derived from a shared seed.
- **Hosting**: GitHub Pages at `fakt.hutnan.dev`. Relay (if P2P fails) on Cloudflare Workers free plan with Durable Objects.
- **Licence**: code MIT, packs CC0 by default. CC BY-SA sources (Open Trivia DB, OpenTriviaQA) cannot go into CC0 packs.
- **App store**: keep possible as long as it does not limit the web version (PWA -> TWA/Capacitor).

## Repo layout

```
packs/            question packs (YAML source, CC0) + README with format and writing guide
src/content/      pack types and validation (shared by build script and importer)
src/engine/       game rules: seeded RNG, card drawing, scoring, reducer (pure, tested)
src/ui/           Preact screens, storage, Slovak texts (sk.ts), demo states for the gallery
src/designs/      switchable designs: <id>/meta.ts + <id>/design.css (see README there)
scripts/          build-packs, screenshots, e2e play test, agy-readonly (Gemini wrapper), dano-drevo-counts (word counts from subtitles)
docs/             research report
notes/            symlink to the owner's Obsidian vault (ignored, never commit)
reference/        owner's reference material (never commit)
```
