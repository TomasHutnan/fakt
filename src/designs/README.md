# Designs

The app ships several complete visual designs; players pick one in Settings, and `?design=<id>` previews one. `#designs` opens a gallery of all designs on all demo screens.

## Contract

A design is a folder `src/designs/<id>/` with two files and nothing else:

- `meta.ts` — `export default { id, name, description, themeColor } satisfies DesignMeta;` (`name` and a one-sentence `description` in Slovak; `themeColor` = page background).
- `design.css` — every selector starts with `:root[data-design="<id>"]` or `[data-design="<id>"]` so designs never leak into each other. Fonts may be loaded with `@import url("https://fonts.googleapis.com/css2?...&display=swap");` as the first line (it is cached for offline use); always give a system fallback stack.

`src/ui/base.css` provides structure only (layout, spacing, grid of options) wrapped in `:where()`, so a single class selector in a design overrides it. Designs may change layout too (e.g. options as a one-column list), as long as it works at 360–430 px width without horizontal scrolling and at desktop width (content column max ~560 px).

Required: light and dark (`@media (prefers-color-scheme: dark)`) unless the design is deliberately single-theme (then set every colour explicitly); visible `:focus-visible`; tap targets ≥ 44 px; respect `prefers-reduced-motion`; correct/wrong states must not rely on colour alone where it matters (reveal uses ✓ or similar).

`src/designs/zaklad/` is the reference implementation: copy its selector list and restyle every rule.

## Class vocabulary

| Area | Classes |
|---|---|
| Page | `body`, `.screen` + `.screen--home/setup/game/packs/settings/over/loading`, `.stack`, `.row`, `.actions` |
| Brand (home) | `.brand`, `.brand__mark` (contains "?"), `.brand__name`, `.brand__tagline`, `.menu`, `.home__stats` |
| Buttons | `.btn`, `.btn--primary`, `.btn--ghost`, `.btn--danger`, `.btn--small`, `.btn--block`, `.btn--icon`, `:disabled` |
| Top bar | `.topbar`, `.topbar__back`, `.topbar__title`, `.topbar__meta`, `.topbar__quit`, `.scorestrip`, `.scorestrip__item`, `.scorestrip__item--active`, `.scorestrip__name`, `.scorestrip__score` |
| Hand-over (full screen button) | `.handover`, `.handover__round`, `.handover__label`, `.handover__name`, `.handover__hint` |
| Question | `.q` + `.q--pick/order/number/choice/reveal`, `.q__meta`, `.q__pack`, `.q__difficulty` + `--1/2/3`, `.q__asof`, `.q__player`, `.q__prompt`, `.q__hint`, `.q__note`, `.q__source` |
| Pick turn | `.turnbar`, `.turnbar__points`, `.turnbar__next`, `.turnbar__count` |
| Options | `.options`, `.options--choice`, `.options--reveal`, `.opt` (button or li), `.opt--correct`, `.opt--wrong`, `.opt--static`, `.opt__text`, `.opt__why`, `.opt__who` |
| Turn end | `.turnend`, `.verdict` + `--busted/banked/complete/saved`, `.verdict__title`, `.verdict__detail` |
| Order | `.order-list`, `.order-list--reveal`, `.order-item`, `.order-item__rank`, `.order-item__text`, `.order-item__value`, `.order-item__why`, `.order-item__controls` |
| Number | `.number-input`, `.number-input__row`, `.number-input__field`, `.number-input__unit`, `.number-reveal`, `.number-reveal__label`, `.number-reveal__value`, `.number-reveal__why` |
| Results | `.results`, `.result`, `.result--scored`, `.result__name`, `.result__detail`, `.result__points` |
| Game over | `.over__head`, `.over__label`, `.over__title`, `.scoreboard`, `.score-row`, `.score-row--leader`, `.score-row__rank`, `.score-row__name`, `.score-row__score` |
| Forms | `.field`, `.field__label` (legend), `.field__hint`, `.input`, `.segmented`, `.segmented__opt[aria-pressed]`, `.player-list`, `.player-row` |
| Packs | `.pack-list`, `.pack`, `.pack--on`, `.pack__main`, `.pack__title`, `.pack__desc`, `.pack__meta`, `.pack__remove`, `.toggle` (checkbox), `.badge`, `.badge--adult`, `.file-btn` |
| Settings | `.design-list`, `.design-choice[aria-pressed]`, `.design-choice__swatch`, `.design-choice__name`, `.design-choice__desc` |
| Misc | `.confirm`, `.error`, `.notice`, `.loading` |

## Previewing

```sh
npx vite --port 5201                      # dev server (demo screens need no packs)
BASE_URL=http://localhost:5201/ node scripts/screenshots.ts /tmp/shots <id>
```

Demo screens: `?design=<id>&demo=home|setup|handover|play|busted|order|number|choice|reveal|over`.
