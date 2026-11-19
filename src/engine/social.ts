import type { Card } from "./cards.ts";
import type { Answer } from "./game.ts";
import { numberError, pickPoints } from "./scoring.ts";

// The jokes the table makes anyway: "only Dano picked Trenčín", end-of-game titles.
// Pure and structured; the UI turns them into Slovak sentences (sk.ts).

export interface Scored {
  /** Player index (one phone) or position in the room's player list. */
  player: number;
  answer: Answer;
  points: number;
}

export type SocialLine =
  | { kind: "allRight" }
  | { kind: "nobodyRight" }
  | { kind: "onlyRight"; players: number[] }
  | { kind: "lonelyWrong"; player: number; option: string }
  | { kind: "trap"; players: number[]; option: string }
  | { kind: "complete"; players: number[] }
  | { kind: "bigBust"; player: number; lost: number }
  | { kind: "untouched"; option: string }
  | { kind: "exact"; players: number[] }
  | { kind: "closest"; player: number }
  | { kind: "perfectOrder"; players: number[] };

/** Up to `max` lines about one card, most remarkable first. Needs at least two answers. */
export function socialLines(card: Card, results: Scored[], max = 2): SocialLine[] {
  if (results.length < 2) return [];
  const lines: { line: SocialLine; weight: number }[] = [];
  const add = (line: SocialLine, weight: number) => lines.push({ line, weight });
  const n = results.length;

  switch (card.type) {
    case "choice": {
      const chose = (r: Scored) => (r.answer.type === "choice" ? r.answer.option : -1);
      const right = results.filter((r) => card.options[chose(r)]?.correct);
      if (right.length === n) add({ kind: "allRight" }, 3);
      else if (right.length === 0) add({ kind: "nobodyRight" }, 4);
      else if (right.length <= Math.floor(n / 2) && n >= 3) add({ kind: "onlyRight", players: right.map((r) => r.player) }, 6);
      // A wrong option chosen by exactly one player while most got it right.
      if (right.length >= n - 1 && n >= 3) {
        const odd = results.find((r) => !card.options[chose(r)]?.correct && chose(r) >= 0);
        if (odd) add({ kind: "lonelyWrong", player: odd.player, option: card.options[chose(odd)].text }, 8);
      }
      // Two or more fell for the same wrong option.
      for (const [i, o] of card.options.entries()) {
        if (o.correct) continue;
        const who = results.filter((r) => chose(r) === i);
        if (who.length >= 2) add({ kind: "trap", players: who.map((r) => r.player), option: o.text }, 5 + who.length);
      }
      break;
    }
    case "pick": {
      const picks = (r: Scored) => (r.answer.type === "pick" ? r.answer : null);
      const complete = results.filter((r) => picks(r)?.status === "complete");
      if (complete.length) add({ kind: "complete", players: complete.map((r) => r.player) }, 7);
      for (const r of results) {
        const a = picks(r);
        // Only when the card was wiped (not when a wrong pick just ends the turn).
        if (a?.status !== "busted" || r.points > 0) continue;
        const found = a.picks.filter((i) => card.options[i].correct).length;
        if (found >= 3) add({ kind: "bigBust", player: r.player, lost: pickPoints(found) }, 6 + found);
      }
      for (const [i, o] of card.options.entries()) {
        const who = results.filter((r) => picks(r)?.picks.includes(i));
        if (!o.correct && who.length >= 2) add({ kind: "trap", players: who.map((r) => r.player), option: o.text }, 4 + who.length);
        if (o.correct && who.length === 0 && n >= 3) add({ kind: "untouched", option: o.text }, 3);
      }
      break;
    }
    case "number": {
      const errs = results
        .map((r) => ({ r, e: r.answer.type === "number" && r.answer.value != null ? numberError(card, r.answer.value) : Infinity }))
        .filter((x) => Number.isFinite(x.e));
      const exact = errs.filter((x) => x.e <= 1);
      if (exact.length) add({ kind: "exact", players: exact.map((x) => x.r.player) }, 8);
      else if (errs.length >= 2) {
        const best = Math.min(...errs.map((x) => x.e));
        const top = errs.filter((x) => x.e === best);
        if (top.length === 1) add({ kind: "closest", player: top[0].r.player }, 4);
      }
      break;
    }
    case "order": {
      const perfect = results.filter((r) => r.answer.type === "order" && r.answer.arrangement.every((item, pos) => card.solution[pos] === item));
      if (perfect.length) add({ kind: "perfectOrder", players: perfect.map((r) => r.player) }, 7);
      else add({ kind: "nobodyRight" }, 2);
      break;
    }
  }
  // Heaviest first; one line per kind.
  const seen = new Set<string>();
  return lines
    .sort((a, b) => b.weight - a.weight)
    .filter((x) => !seen.has(x.line.kind) && (seen.add(x.line.kind), true))
    .slice(0, max)
    .map((x) => x.line);
}

// ---------------------------------------------------------------------------
// Titles at the end of a game.

/** What the titles need to know about one finished card. */
export interface RoundRecord {
  type: Card["type"];
  results: {
    player: number;
    points: number;
    /** Pick cards. */
    status?: "banked" | "busted" | "complete" | "playing";
    found?: number;
    /** Number cards: within tolerance. Choice: right. Order: perfect. */
    hit?: boolean;
  }[];
}

export function roundRecord(card: Card, results: Scored[]): RoundRecord {
  return {
    type: card.type,
    results: results.map((r) => {
      const a = r.answer;
      const base = { player: r.player, points: r.points };
      if (card.type === "pick" && a.type === "pick")
        return { ...base, status: a.status, found: a.picks.filter((i) => card.options[i].correct).length };
      if (card.type === "number" && a.type === "number") return { ...base, hit: a.value != null && numberError(card, a.value) <= 1 };
      if (card.type === "choice" && a.type === "choice") return { ...base, hit: !!card.options[a.option]?.correct };
      if (card.type === "order" && a.type === "order") return { ...base, hit: a.arrangement.every((item, pos) => card.solution[pos] === item) };
      return base;
    }),
  };
}

export type TitleId = "ikarus" | "vseved" | "ostrostrelec" | "hazarder" | "opatrnik" | "strateg" | "neomylny" | "moralny";

export interface Title {
  player: number;
  id: TitleId;
  /** The number behind the title (points lost, cards completed, …). */
  value: number;
}

/**
 * One title per player at most, each title to one player. Rare feats first; the
 * player in last place gets "Morálny víťaz" if nothing else fits. Needs 2+ players.
 */
export function titles(history: RoundRecord[], scores: number[]): Title[] {
  const n = scores.length;
  if (n < 2 || history.length === 0) return [];
  const per = Array.from({ length: n }, () => ({ busts: 0, maxLost: 0, completes: 0, hits: 0, numberHits: 0, orderHits: 0, banksLow: 0, wrong: 0, answered: 0 }));
  for (const round of history) {
    for (const r of round.results) {
      const p = per[r.player];
      if (!p) continue;
      p.answered++;
      if (round.type === "pick") {
        if (r.status === "busted") {
          p.busts++;
          p.wrong++;
          if (r.points === 0) p.maxLost = Math.max(p.maxLost, pickPoints(r.found ?? 0));
        }
        if (r.status === "complete") p.completes++;
        if (r.status === "banked" && (r.found ?? 0) <= 2) p.banksLow++;
      } else if (r.hit) {
        p.hits++;
        if (round.type === "number") p.numberHits++;
        if (round.type === "order") p.orderHits++;
      } else if (round.type === "choice") p.wrong++;
    }
  }
  const best = (f: (p: (typeof per)[number]) => number, min: number): { player: number; value: number } | null => {
    let top: { player: number; value: number } | null = null;
    for (let i = 0; i < per.length; i++) {
      const v = f(per[i]);
      if (v >= min && (top == null || v > top.value)) top = { player: i, value: v };
    }
    return top;
  };
  const candidates: [TitleId, { player: number; value: number } | null][] = [
    ["ikarus", best((p) => p.maxLost, 6)],
    ["vseved", best((p) => p.completes, 1)],
    ["ostrostrelec", best((p) => p.numberHits, 1)],
    ["strateg", best((p) => p.orderHits, 1)],
    ["hazarder", best((p) => p.busts, 2)],
    ["opatrnik", best((p) => p.banksLow, 2)],
    ["neomylny", best((p) => (p.wrong === 0 && p.answered >= 3 ? p.answered : 0), 3)],
  ];
  const out: Title[] = [];
  const taken = new Set<number>();
  for (const [id, c] of candidates) {
    if (c && !taken.has(c.player)) {
      out.push({ player: c.player, id, value: c.value });
      taken.add(c.player);
    }
  }
  const low = Math.min(...scores);
  const last = scores.findIndex((s) => s === low);
  if (!taken.has(last) && scores.some((s) => s > low)) out.push({ player: last, id: "moralny", value: low });
  return out;
}
