import type { Option, Pack, Question, QuestionType } from "../content/types.ts";
import { int, shuffle, type Rng } from "./rng.ts";

// A Card is one concrete play of a Question: options drawn and shuffled.

export const PICK_OPTIONS = 10;
export const PICK_MIN_CORRECT = 2;
export const PICK_MAX_CORRECT = 8;
export const ORDER_MIN = 4;
export const ORDER_MAX = 5;

interface CardBase {
  /** packId/questionId */
  key: string;
  packId: string;
  packTitle: string;
  /** Pack version the card was drawn from (missing in games saved before it existed). */
  packVersion?: number;
  prompt: string;
  difficulty: number;
  source: string;
  asOf?: string;
  note?: string;
}

export interface CardOption extends Option {
  correct: boolean;
}

export interface PickCard extends CardBase {
  type: "pick";
  options: CardOption[];
  correctCount: number;
}

export interface OrderCard extends CardBase {
  type: "order";
  direction: "asc" | "desc";
  unit?: string;
  /** Items in display (shuffled) order. */
  items: { text: string; value: number; label: string; why?: string }[];
  /** Indices into items in the correct order. */
  solution: number[];
}

export interface NumberCard extends CardBase {
  type: "number";
  answer: number;
  unit?: string;
  scale: "linear" | "log";
  tolerance: number;
  why: string;
}

export interface ChoiceCard extends CardBase {
  type: "choice";
  options: CardOption[];
  /** "Which is more": two items of an order question; the one that comes first is correct. */
  compare?: "asc" | "desc";
}

export type Card = PickCard | OrderCard | NumberCard | ChoiceCard;

export function formatNumber(n: number): string {
  return n.toLocaleString("sk-SK", { maximumFractionDigits: 2 });
}

export function makeCard(pack: Pack, q: Question, rng: Rng): Card {
  const base: CardBase = {
    key: `${pack.id}/${q.id}`,
    packId: pack.id,
    packTitle: pack.title,
    packVersion: pack.version,
    prompt: q.prompt,
    difficulty: q.difficulty,
    source: q.source,
    ...(q.asOf ? { asOf: q.asOf } : {}),
    ...(q.note ? { note: q.note } : {}),
  };
  switch (q.type) {
    case "pick": {
      const total = Math.min(PICK_OPTIONS, q.correct.length + q.wrong.length);
      // Number of correct options: 2..8, limited by what the question has.
      const lo = Math.max(PICK_MIN_CORRECT, total - q.wrong.length);
      const hi = Math.min(PICK_MAX_CORRECT, q.correct.length, total - PICK_MIN_CORRECT);
      const k = int(rng, lo, Math.max(lo, hi));
      const correct = shuffle(rng, q.correct).slice(0, k).map((o) => ({ ...o, correct: true }));
      const wrong = shuffle(rng, q.wrong).slice(0, total - k).map((o) => ({ ...o, correct: false }));
      return { ...base, type: "pick", options: shuffle(rng, [...correct, ...wrong]), correctCount: k };
    }
    case "order": {
      const n = Math.min(q.items.length, int(rng, ORDER_MIN, ORDER_MAX));
      const chosen = shuffle(rng, q.items).slice(0, n);
      const items = chosen.map((it) => ({
        text: it.text,
        value: it.value,
        label: it.label ?? `${formatNumber(it.value)}${q.unit ? ` ${q.unit}` : ""}`,
        ...(it.why ? { why: it.why } : {}),
      }));
      const dir = q.direction ?? "desc";
      const solution = items
        .map((_, i) => i)
        .sort((a, b) => (dir === "desc" ? items[b].value - items[a].value : items[a].value - items[b].value));
      return { ...base, type: "order", direction: dir, items, solution, ...(q.unit ? { unit: q.unit } : {}) };
    }
    case "number":
      return {
        ...base,
        type: "number",
        answer: q.answer,
        scale: q.scale,
        tolerance: q.tolerance,
        why: q.why,
        ...(q.unit ? { unit: q.unit } : {}),
      };
    case "choice": {
      const wrong = shuffle(rng, q.wrong).slice(0, 3).map((o) => ({ ...o, correct: false }));
      return { ...base, type: "choice", options: shuffle(rng, [{ ...q.correct, correct: true }, ...wrong]) };
    }
  }
}

/**
 * "Which is more" card from an order question: two items with different values,
 * the one that would come first in the order is correct.
 */
export function makeCompareCard(pack: Pack, q: Extract<Question, { type: "order" }>, rng: Rng): ChoiceCard | null {
  const base = makeCard(pack, q, rng) as OrderCard;
  const [a, ...rest] = shuffle(rng, base.items);
  const b = rest.find((x) => x.value !== a.value);
  if (!b) return null;
  const dir = base.direction;
  const first = dir === "desc" ? (a.value > b.value ? a : b) : a.value < b.value ? a : b;
  const options = shuffle(rng, [a, b]).map((it) => ({
    text: it.text,
    why: it.why ? `${it.label}. ${it.why}` : it.label,
    correct: it === first,
  }));
  const { items: _i, solution: _s, direction: _d, unit: _u, ...rest2 } = base;
  return { ...rest2, type: "choice", options, compare: dir };
}

export interface DeckFilter {
  packIds: string[];
  difficulties: number[];
  types: QuestionType[];
  /** Keys of questions already played; avoided until a pack runs out. */
  seen: Set<string>;
}

export interface DeckEntry {
  pack: Pack;
  question: Question;
}

/** All eligible questions, unseen first, each group shuffled. */
export function buildDeck(packs: Pack[], filter: DeckFilter, rng: Rng): DeckEntry[] {
  const all: DeckEntry[] = [];
  for (const pack of packs) {
    if (!filter.packIds.includes(pack.id)) continue;
    for (const question of pack.questions) {
      if (!filter.difficulties.includes(question.difficulty)) continue;
      if (!filter.types.includes(question.type)) continue;
      all.push({ pack, question });
    }
  }
  const fresh = all.filter((e) => !filter.seen.has(`${e.pack.id}/${e.question.id}`));
  const used = all.filter((e) => filter.seen.has(`${e.pack.id}/${e.question.id}`));
  return [...interleave(shuffle(rng, fresh)), ...interleave(shuffle(rng, used))];
}

/** Avoid two questions from the same pack in a row where possible. */
function interleave(entries: DeckEntry[]): DeckEntry[] {
  const out: DeckEntry[] = [];
  const rest = entries.slice();
  while (rest.length) {
    const last = out[out.length - 1]?.pack.id;
    const i = rest.findIndex((e) => e.pack.id !== last);
    out.push(...rest.splice(i === -1 ? 0 : i, 1));
  }
  return out;
}
