import type { Pack } from "../content/types.ts";
import type { NumberCard } from "./cards.ts";
import { createRng } from "./rng.ts";
import { numberError } from "./scoring.ts";

// Tie-break when a game ends with two or more players sharing the top score:
// only they answer one extra number card; the closest guess gets 1 point.
// Guesses equally close keep the tie, and the win is shared.

/** Indices of the players sharing the top score, when there are two or more of them. */
export function tiedLeaders(scores: number[]): number[] {
  if (scores.length < 2) return [];
  const top = Math.max(...scores);
  const tied = scores.map((s, i) => (s === top ? i : -1)).filter((i) => i >= 0);
  return tied.length >= 2 ? tied : [];
}

/**
 * Key of the tie-break question: the next number question still in the deck, or else
 * (Classic decks hold no number questions) one from the enabled packs, chosen by the
 * seed, avoiding `avoid` (cards played or seen) while any other is left. Null when the
 * packs have none.
 */
export function tiebreakKey(deck: string[], from: number, packs: Pack[], packIds: string[], avoid: string[], seed: number): string | null {
  const isNumber = (key: string) => {
    const [packId, qid] = key.split("/");
    return packs.find((p) => p.id === packId)?.questions.find((q) => q.id === qid)?.type === "number";
  };
  const inDeck = deck.slice(from).find(isNumber);
  if (inDeck) return inDeck;
  const done = new Set(avoid);
  const all = packs
    .filter((p) => packIds.includes(p.id))
    .flatMap((p) => p.questions.filter((q) => q.type === "number").map((q) => `${p.id}/${q.id}`));
  const fresh = all.filter((k) => !done.has(k));
  const pool = fresh.length ? fresh : all;
  if (!pool.length) return null;
  return pool[Math.floor(createRng(seed ^ 0x71e5)() * pool.length)];
}

/** 1 point for the closest guess (all equally closest ones), 0 for the rest. */
export function tiebreakPoints(card: Pick<NumberCard, "answer" | "scale" | "tolerance">, guesses: number[]): number[] {
  const errors = guesses.map((g) => numberError(card, g));
  const best = Math.min(...errors.filter(Number.isFinite));
  return errors.map((e) => (Number.isFinite(e) && e === best ? 1 : 0));
}
