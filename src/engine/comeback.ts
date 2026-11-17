import { createRng, shuffle } from "./rng.ts";

// Catch-up rules shared by one-phone games and rooms: the last round counts
// double, and every third round the player in last place picks the pack.

export const PACK_PICK_EVERY = 3;
export const PACK_PICK_OPTIONS = 3;

export interface ComebackSettings {
  /** Last round counts double (games with a set number of rounds). */
  doubleFinal: boolean;
  /** Every third round the last player picks the pack of the next card. */
  lastPicks: boolean;
}

export const DEFAULT_COMEBACK: ComebackSettings = { doubleFinal: true, lastPicks: true };

export function isPackPickRound(round: number): boolean {
  return round > 1 && round % PACK_PICK_EVERY === 0;
}

/** Up to three different packs that still have cards in the deck from `pos` on, in a seeded order. */
export function packOptions(deck: string[], pos: number, seed: number, round: number): string[] {
  const ids = Array.from(new Set(deck.slice(pos).map((k) => k.split("/")[0])));
  return shuffle(createRng((seed ^ 0x2f6b) + round * 101), ids).slice(0, PACK_PICK_OPTIONS);
}

/** Index of the lowest score; ties are broken by the seed. */
export function lastPlace(scores: number[], seed: number, round: number): number {
  const low = Math.min(...scores);
  const tied = scores.map((s, i) => (s === low ? i : -1)).filter((i) => i >= 0);
  return tied[Math.floor(createRng((seed ^ 0x51ed) + round * 31)() * tied.length)];
}

/** The deck with the first card of `packId` at or after `pos` moved to `pos`. */
export function bringForward(deck: string[], pos: number, packId: string): string[] {
  const i = deck.findIndex((k, j) => j >= pos && k.split("/")[0] === packId);
  if (i < 0 || i === pos) return deck;
  const out = deck.slice();
  const [key] = out.splice(i, 1);
  out.splice(pos, 0, key);
  return out;
}
