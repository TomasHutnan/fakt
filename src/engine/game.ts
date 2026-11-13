import type { Pack, QuestionType } from "../content/types.ts";
import { buildDeck, makeCard, makeCompareCard, type Card } from "./cards.ts";
import { createRng, type Rng } from "./rng.ts";
import {
  numberRankedPoints,
  numberSoloPoints,
  orderPoints,
  pickTurnPoints,
  POINTS,
  type WipeRule,
} from "./scoring.ts";

// The whole game as a pure reducer: (state, action, packs) -> state.
// State is plain JSON so it can be saved to localStorage and resumed.

export type Mode = "classic" | "mix";

export interface Settings {
  mode: Mode;
  /** Number of rounds; ignored when target is set. */
  rounds: number;
  /** Play until someone reaches this score (round is always finished). */
  target: number | null;
  wipe: WipeRule;
  showCorrectCount: boolean;
  /** Show the answer to each player right after their turn instead of to everyone after the round. */
  revealEach: boolean;
  /** Vibrate on picks (device preference, read from the current settings, not the saved game). */
  haptics: boolean;
  /** Short sounds on picks. */
  sound: boolean;
  difficulties: number[];
  packIds: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  mode: "classic",
  rounds: 10,
  target: null,
  wipe: "always",
  showCorrectCount: false,
  revealEach: true,
  haptics: true,
  sound: false,
  difficulties: [1, 2, 3],
  packIds: [],
};

export interface Player {
  name: string;
  score: number;
}

export type Answer =
  | { type: "pick"; picks: number[]; status: "playing" | "banked" | "busted" | "complete" }
  | { type: "order"; arrangement: number[] }
  | { type: "number"; value: number | null }
  | { type: "choice"; option: number };

export interface TurnResult {
  player: number;
  answer: Answer;
  points: number;
}

export type Phase = "handover" | "play" | "turnEnd" | "reveal" | "over";

export interface GameState {
  seed: number;
  players: Player[];
  settings: Settings;
  /** Question keys in play order, decided at the start. */
  deck: string[];
  deckPos: number;
  round: number;
  card: Card;
  /** Player indices in turn order for this round. */
  order: number[];
  /** Index into order. */
  turn: number;
  phase: Phase;
  answer: Answer | null;
  /** Answers of players who already played this card. Points filled at reveal. */
  results: TurnResult[];
  /** Keys of cards played in this game. */
  played: string[];
}

export type Action =
  | { type: "continue" } // handover -> play
  | { type: "pick"; option: number }
  | { type: "bank" }
  | { type: "submitOrder"; arrangement: number[] }
  | { type: "submitNumber"; value: number }
  | { type: "submitChoice"; option: number }
  | { type: "endTurn" } // turnEnd -> next handover or reveal
  | { type: "nextRound" }; // reveal -> next round or over

export function typesFor(mode: Mode): QuestionType[] {
  return mode === "classic" ? ["pick"] : ["pick", "order", "number", "choice"];
}

export interface NewGameInput {
  players: string[];
  settings: Settings;
  packs: Pack[];
  seen: Set<string>;
  seed: number;
}

/** Returns null when no question matches the selection. */
export function newGame({ players, settings, packs, seen, seed }: NewGameInput): GameState | null {
  const rng = createRng(seed);
  const deck = buildDeck(
    packs,
    { packIds: settings.packIds, difficulties: settings.difficulties, types: typesFor(settings.mode), seen },
    rng,
  ).map((e) => `${e.pack.id}/${e.question.id}`);
  if (deck.length === 0 || players.length === 0) return null;
  const card = cardFor(deck[0], packs, seed, 0);
  if (!card) return null;
  return {
    seed,
    players: players.map((name) => ({ name, score: 0 })),
    settings,
    deck,
    deckPos: 0,
    round: 1,
    card,
    order: roundOrder(players.length, 1),
    turn: 0,
    phase: players.length > 1 ? "handover" : "play",
    answer: initialAnswer(card),
    results: [],
    played: [],
  };
}

function cardFor(key: string, packs: Pack[], seed: number, pos: number): Card | null {
  const [packId, qid] = key.split("/");
  const pack = packs.find((p) => p.id === packId);
  const q = pack?.questions.find((x) => x.id === qid);
  if (!pack || !q) return null;
  // Per-card RNG so a resumed game draws the same options.
  const rng = createRng(seed + pos * 7919);
  // Some order questions are played as "which is more" (only in mix mode, the only mode with order cards).
  if (q.type === "order" && createRng((seed ^ 0x5bd1e995) + pos)() < COMPARE_SHARE) {
    const c = makeCompareCard(pack, q, rng);
    if (c) return c;
  }
  return makeCard(pack, q, rng);
}

/** Share of order questions dealt as "which is more" cards. */
export const COMPARE_SHARE = 0.4;

function roundOrder(n: number, round: number): number[] {
  return Array.from({ length: n }, (_, i) => (i + round - 1) % n);
}

function initialAnswer(card: Card): Answer {
  switch (card.type) {
    case "pick":
      return { type: "pick", picks: [], status: "playing" };
    case "order":
      return { type: "order", arrangement: card.items.map((_, i) => i) };
    case "number":
      return { type: "number", value: null };
    case "choice":
      return { type: "choice", option: -1 };
  }
}

export function currentPlayer(s: GameState): number {
  return s.order[s.turn];
}

export function isLastTurn(s: GameState): boolean {
  return s.turn === s.order.length - 1;
}

export function reduce(s: GameState, a: Action, packs: Pack[]): GameState {
  switch (a.type) {
    case "continue":
      return s.phase === "handover" ? { ...s, phase: "play" } : s;

    case "pick": {
      if (s.phase !== "play" || s.card.type !== "pick" || s.answer?.type !== "pick") return s;
      const ans = s.answer;
      if (ans.status !== "playing" || ans.picks.includes(a.option)) return s;
      const opt = s.card.options[a.option];
      if (!opt) return s;
      const picks = [...ans.picks, a.option];
      const found = picks.filter((i) => s.card.type === "pick" && s.card.options[i].correct).length;
      const status = !opt.correct ? "busted" : found === s.card.correctCount ? "complete" : "playing";
      const answer: Answer = { type: "pick", picks, status };
      return status === "playing" ? { ...s, answer } : finishTurn({ ...s, answer }, packs);
    }

    case "bank":
      if (s.phase !== "play" || s.answer?.type !== "pick" || s.answer.status !== "playing") return s;
      return finishTurn({ ...s, answer: { ...s.answer, status: "banked" } }, packs);

    case "submitOrder":
      if (s.phase !== "play" || s.card.type !== "order") return s;
      return finishTurn({ ...s, answer: { type: "order", arrangement: a.arrangement } }, packs);

    case "submitNumber":
      if (s.phase !== "play" || s.card.type !== "number" || !Number.isFinite(a.value)) return s;
      return finishTurn({ ...s, answer: { type: "number", value: a.value } }, packs);

    case "submitChoice":
      if (s.phase !== "play" || s.card.type !== "choice") return s;
      if (a.option < 0 || a.option >= s.card.options.length) return s;
      return finishTurn({ ...s, answer: { type: "choice", option: a.option } }, packs);

    case "endTurn":
      return s.phase === "turnEnd" ? advance(s, packs) : s;

    case "nextRound":
      return s.phase === "reveal" ? nextRound(s, packs) : s;
  }
}

/** After a turn: hand over to the next player, or close the round. */
function advance(s: GameState, packs: Pack[]): GameState {
  if (!isLastTurn(s)) return { ...s, turn: s.turn + 1, phase: "handover", answer: initialAnswer(s.card) };
  const r = reveal(s);
  // Alone and already shown the answer: the round summary adds nothing, go straight on.
  return s.settings.revealEach && s.players.length === 1 ? nextRound(r, packs) : r;
}

function nextRound(s: GameState, packs: Pack[]): GameState {
  const played = [...s.played, s.card.key];
  if (isGameOver(s)) return { ...s, played, phase: "over" };
  // Skip keys whose question disappeared (e.g. an imported pack was removed).
  let pos = s.deckPos + 1;
  let card: Card | null = null;
  while (pos < s.deck.length && !(card = cardFor(s.deck[pos], packs, s.seed, pos))) pos++;
  if (!card) return { ...s, played, phase: "over" };
  const round = s.round + 1;
  return {
    ...s,
    played,
    deckPos: pos,
    round,
    card,
    order: roundOrder(s.players.length, round),
    turn: 0,
    phase: s.players.length > 1 ? "handover" : "play",
    answer: initialAnswer(card),
    results: [],
  };
}

function finishTurn(s: GameState, packs: Pack[]): GameState {
  const result: TurnResult = { player: currentPlayer(s), answer: s.answer!, points: 0 };
  const next: GameState = { ...s, phase: "turnEnd", results: [...s.results, result] };
  // Pick turns always end on their own screen (the picks were already shown).
  // Other formats skip it unless the answer is shown to each player.
  return s.card.type === "pick" || s.settings.revealEach ? next : advance(next, packs);
}

function reveal(s: GameState): GameState {
  const points = scoreCard(s.card, s.results, s.settings.wipe, s.players.length);
  const results = s.results.map((r, i) => ({ ...r, points: points[i] }));
  const players = s.players.map((p, i) => ({
    ...p,
    score: p.score + results.filter((r) => r.player === i).reduce((n, r) => n + r.points, 0),
  }));
  return { ...s, results, players, phase: "reveal" };
}

export function scoreCard(card: Card, results: TurnResult[], wipe: WipeRule, playerCount: number): number[] {
  switch (card.type) {
    case "pick":
      return results.map((r) => (r.answer.type === "pick" ? pickTurnPoints(card, r.answer.picks, wipe) : 0));
    case "order":
      return results.map((r) => (r.answer.type === "order" ? orderPoints(card, r.answer.arrangement).points : 0));
    case "choice":
      return results.map((r) =>
        r.answer.type === "choice" && card.options[r.answer.option]?.correct
          ? card.compare
            ? POINTS.compare
            : POINTS.choice
          : 0,
      );
    case "number": {
      const guesses = results.map((r) => (r.answer.type === "number" ? (r.answer.value ?? NaN) : NaN));
      return playerCount > 1 ? numberRankedPoints(card, guesses) : guesses.map((g) => numberSoloPoints(card, g));
    }
  }
}

export function isGameOver(s: GameState): boolean {
  if (s.settings.target != null) return s.players.some((p) => p.score >= s.settings.target!);
  return s.round >= s.settings.rounds;
}

/** Standings with shared ranks for ties. */
export function standings(players: Player[]): { player: Player; index: number; rank: number }[] {
  const sorted = players.map((player, index) => ({ player, index })).sort((a, b) => b.player.score - a.player.score);
  return sorted.map((e) => ({ ...e, rank: sorted.filter((o) => o.player.score > e.player.score).length + 1 }));
}

export type { Rng };
