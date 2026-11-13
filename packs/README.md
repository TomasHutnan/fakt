# Question packs

One YAML file per pack. `npm run packs:check` validates all packs; `npm run packs` also builds them to `public/packs/`.

Packs are **CC0-1.0** unless a pack sets its own `license`. Never copy question text from other quizzes, apps or chart sites. Facts are free to use; the wording and the choice of wrong options must be our own.

## Pack

```yaml
id: sk-priroda            # lower-case-with-dashes, same as the file name
title: Slovenská príroda
description: Ryby, huby, štíty, jaskyne a zvieratá.
lang: sk                  # sk | cs | en
license: CC0-1.0          # optional, default CC0-1.0
adult: false              # true = labelled 18+ and off by default
version: 1
questions: [...]
```

## Question types

Every question has `id` (unique in the pack), `type`, `prompt`, `difficulty` (1 easy, 2 medium, 3 hard), `source` (URL preferred) and optionally `tags`, `asOf`, `note`.

`asOf: "2026-11"` is **required** for anything that changes: charts, play counts, populations, records, prices, office holders. Always quote it as a string.

### pick — the main format

Players see 10 options and pick the true ones. The game draws 10 from the lists with 2–8 correct, so a question needs **at least 10 options in total** and at least 2 in each list. More is better (12–16): the card varies between games.

```yaml
- id: ryby-sladkovodne
  type: pick
  prompt: Ktoré z týchto rýb žijú vo voľnej prírode v slovenských riekach a jazerách?
  difficulty: 1
  source: https://sk.wikipedia.org/wiki/Zoznam_rýb_Slovenska
  correct:
    - text: hlavátka podunajská
      why: Žije v Dunaji a jeho prítokoch; je to najväčšia lososovitá ryba Európy.
  wrong:
    - text: treska škvrnitá
      why: Morská ryba severného Atlantiku.
```

### order — arrange by value

At least 4 items with distinct values; the game uses 4–5 of them. `direction: desc` (default) means highest first.

```yaml
- id: najvyssie-stity
  type: order
  prompt: Zoraď štíty od najvyššieho.
  direction: desc
  unit: m n. m.
  difficulty: 2
  source: https://...
  items:
    - { text: Gerlachovský štít, value: 2655 }
    - { text: Lomnický štít, value: 2634 }
    - { text: Kriváň, value: 2494 }
    - { text: Rysy, value: 2503 }
```

### number — type a number

```yaml
- id: obyvatelia-kosice
  type: number
  prompt: Koľko obyvateľov majú Košice?
  answer: 228000
  unit: obyvateľov
  scale: log          # log = relative error (populations, amounts); linear = absolute (years)
  tolerance: 0.05     # log: fraction (0.05 = within 5 % is full points); linear: units (e.g. 2 years)
  asOf: "2025"
  why: Druhé najväčšie mesto Slovenska.
  difficulty: 2
  source: https://...
```

### choice — one of four

```yaml
- id: rieka-kosice
  type: choice
  prompt: Ktorá rieka preteká Košicami?
  correct: { text: Hornád, why: ... }
  wrong:
    - { text: Hron, why: ... }
    - { text: Torysa, why: ... }
    - { text: Ondava, why: ... }
```

## Writing guide

- **Slovak, natural and correct.** Diacritics always. Sentence case. No full stop after options.
- **Not too obscure.** Most people at the table should recognise at least a few options. If nobody could get anything, the card is not fun. Aim for difficulty mix ~40 % 1, ~40 % 2, ~20 % 3.
- **Every option has a one-line `why`**, true or false. It is shown after the card and is half the fun: a surprising fact, a reason, a joke. Longer only when really needed.
- **Wrong options must be plausible.** A wrong option that is obviously wrong is wasted. The best wrong options are the ones people argue about.
- **Each option must be unambiguously true or false.** If it depends on interpretation, drop it.
- **Verify every fact against the source.** Prefer Wikipedia (sk/cs/en), official statistics (ŠÚ SR), official sites. If two sources disagree, use neither or explain in `why`.
- **Mix of types per pack:** roughly 60 % pick, 15 % order, 15 % number, 10 % choice.
- Use `asOf` for anything that changes. Prefer stable facts where the choice is free.
- Adult packs: frank and funny, but factual. No instructions for anything dangerous or illegal.
