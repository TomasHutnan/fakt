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

Decisions made and v1 planned (2026-11-13). No game code yet.

- **v1 plan**: `notes/V1 Plan.md` — scope, rules, pack format, architecture, milestones. Start there.
- Remaining questions: `notes/Open Questions.md` (Classic turn structure, points per pick, options per card, game length, first 8 packs, visual direction; non-blocking: per-pack licence exceptions, repo visibility). The v1 plan uses the recommended defaults until answered.
- Report: `docs/research-report.html` (research from 2026-11-12, written before the decisions; where it disagrees with this file or the notes, they win).

## Rules for agents

- `notes/` is a symlink into the owner's separate Obsidian vault. You may read and edit the Markdown there. **Never commit it, never `git add` it, never remove it from `.gitignore`.** The owner manages that vault separately.
- Commit and push only when asked. The owner is setting up the GitHub remote.
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
- **Classic mode**: many options per card with a **variable** number of true options; pick one or bank; wrong pick wipes the card's points. Wipe rule ("first wrong pick free" vs "always wipes") is a setting.
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

## Proposed repo layout

```
packs/            question packs (source)
src/engine/       game rules, pure functions, tested
src/content/      pack schema, validation, card derivation
src/ui/           components and screens
src/transport/    local, p2p, relay
scripts/          content generators (Wikidata etc.), validation
docs/             reports
notes/            symlink to Obsidian vault (ignored, never commit)
```
