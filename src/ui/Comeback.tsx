import type { SocialLine, Title } from "../engine/social.ts";
import { sk } from "./sk.ts";

// Pieces shared by one-phone games and rooms: the pack pick, the double round,
// remarks after a card and titles at the end.

export function DoubleNote() {
  return <p class="double-note">{sk.doubleNow}</p>;
}

export function PackPicker({
  options,
  lead,
  canChoose,
  onChoose,
  hint,
}: {
  options: { id: string; title: string }[];
  lead: string;
  canChoose: boolean;
  onChoose: (id: string) => void;
  hint?: string;
}) {
  return (
    <section class="q q--packpick">
      <div class="q__meta">
        <span class="q__pack">{sk.packPickLabel}</span>
      </div>
      <h1 class="q__prompt">{lead}</h1>
      <ul class="options options--choice">
        {options.map((o) => (
          <li key={o.id}>
            <button type="button" class="opt" disabled={!canChoose} onClick={() => onChoose(o.id)}>
              <span class="opt__text">{o.title}</span>
            </button>
          </li>
        ))}
      </ul>
      {hint && <p class="field__hint">{hint}</p>}
    </section>
  );
}

export function socialText(line: SocialLine, name: (player: number) => string): string {
  const who = (ps: number[]) => sk.names(ps.map(name));
  switch (line.kind) {
    case "allRight":
      return sk.social.allRight();
    case "nobodyRight":
      return sk.social.nobodyRight();
    case "onlyRight":
      return sk.social.onlyRight(who(line.players), line.players.length);
    case "lonelyWrong":
      return sk.social.lonelyWrong(name(line.player), line.option);
    case "trap":
      return sk.social.trap(who(line.players), line.option);
    case "complete":
      return sk.social.complete(who(line.players));
    case "bigBust":
      return sk.social.bigBust(name(line.player), line.lost);
    case "untouched":
      return sk.social.untouched(line.option);
    case "exact":
      return sk.social.exact(who(line.players));
    case "closest":
      return sk.social.closest(name(line.player));
    case "perfectOrder":
      return sk.social.perfectOrder(who(line.players));
  }
}

export function SocialList({ lines, name }: { lines: SocialLine[]; name: (player: number) => string }) {
  if (!lines.length) return null;
  return (
    <ul class="social">
      {lines.map((l) => (
        <li class="social__line">{socialText(l, name)}</li>
      ))}
    </ul>
  );
}

export function TitleList({ titles, name }: { titles: Title[]; name: (player: number) => string }) {
  if (!titles.length) return null;
  return (
    <section class="titles" aria-label={sk.titlesHeading}>
      <h2 class="field__label">{sk.titlesHeading}</h2>
      <ul class="titles__list">
        {titles.map((t) => {
          const def = sk.titles[t.id];
          return (
            <li class="title-row">
              <span class="title-row__name">{def.name}</span>
              <span class="title-row__player">{name(t.player)}</span>
              <span class="title-row__desc">{def.desc(t.value)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
