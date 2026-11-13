import type { NumberCard, OrderCard, PickCard } from "./cards.ts";

// All point values live here so they can be tuned after playtests.

export const POINTS = {
  orderPerPosition: 2,
  orderPerfectBonus: 2,
  choice: 4,
  numberSoloMax: 6,
  /** Ranked points for number guesses with 2+ players: 1st, 2nd, 3rd. */
  numberRanked: [5, 3, 1],
  numberWithinToleranceBonus: 2,
} as const;

export type WipeRule = "always" | "firstFree";

/** k-th correct pick is worth k points: 1, 3, 6, 10, 15 … */
export function pickPoints(correctPicks: number): number {
  return (correctPicks * (correctPicks + 1)) / 2;
}

export function pickTurnPoints(card: PickCard, picks: number[], wipe: WipeRule): number {
  const correct = picks.filter((i) => card.options[i].correct).length;
  const wrong = picks.length - correct;
  if (wrong > 0 && wipe === "always") return 0;
  return pickPoints(correct);
}

export function orderPoints(card: OrderCard, arrangement: number[]): { points: number; correctPositions: number } {
  const correctPositions = arrangement.filter((item, pos) => card.solution[pos] === item).length;
  const perfect = correctPositions === card.solution.length;
  return {
    correctPositions,
    points: correctPositions * POINTS.orderPerPosition + (perfect ? POINTS.orderPerfectBonus : 0),
  };
}

/**
 * Error in "tolerance units": 0..1 is within tolerance, 10 is ten times off.
 * linear: |guess - answer| / tolerance; log: |ln(guess/answer)| / ln(1 + tolerance).
 */
export function numberError(card: Pick<NumberCard, "answer" | "scale" | "tolerance">, guess: number): number {
  if (!Number.isFinite(guess)) return Infinity;
  if (card.scale === "log") {
    if (guess <= 0) return Infinity;
    return Math.abs(Math.log(guess / card.answer)) / Math.log(1 + card.tolerance);
  }
  return Math.abs(guess - card.answer) / card.tolerance;
}

/** Solo: full points within tolerance, falling to 0 at ten times the tolerance. */
export function numberSoloPoints(card: NumberCard, guess: number): number {
  const e = numberError(card, guess);
  if (e <= 1) return POINTS.numberSoloMax;
  if (e >= 10) return 0;
  return Math.round(POINTS.numberSoloMax * (1 - Math.log10(e)));
}

/**
 * Multiplayer: rank by closeness. Ties share a rank (1, 1, 3). Guesses ten or more
 * times the tolerance away score nothing. Within tolerance earns a bonus.
 */
export function numberRankedPoints(card: NumberCard, guesses: number[]): number[] {
  const errors = guesses.map((g) => numberError(card, g));
  return errors.map((e) => {
    if (e >= 10) return 0;
    const rank = errors.filter((other) => other < e).length;
    const base = POINTS.numberRanked[rank] ?? 0;
    return base + (e <= 1 ? POINTS.numberWithinToleranceBonus : 0);
  });
}
