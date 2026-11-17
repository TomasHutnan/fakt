import type { Pack } from "../content/types.ts";
import { buildDeck, numberDecimals, type Card } from "./cards.ts";
import { cardFor, scoreCard, typesFor, type Answer, type Mode, type TurnResult } from "./game.ts";
import { bringForward, isPackPickRound, lastPlace, packOptions } from "./comeback.ts";
import { createRng } from "./rng.ts";
import { pickPoints, type WipeRule } from "./scoring.ts";
import { tiebreakKey, tiebreakPoints, tiedLeaders } from "./tiebreak.ts";
import { roundRecord, socialLines, titles, type RoundRecord, type SocialLine, type Title } from "./social.ts";

// A room: everyone plays the same card at once on their own phone.
// Pure reducer like game.ts: (state, action, packs) -> state. The server owns the
// state and sends each device a view (viewFor) that hides what it may not see yet.
// Time comes in through actions (`now`), so the reducer stays pure and testable.

export type Pace = "none" | "calm" | "fast";
export type CardKind = "pick" | "order" | "number" | "choice" | "compare";

/** Seconds to answer, by pace and card kind. Starting guesses, to tune at a playtest. */
export const ANSWER_SECONDS: Record<Exclude<Pace, "none">, Record<CardKind, number>> = {
  calm: { pick: 60, order: 45, number: 30, choice: 20, compare: 15 },
  fast: { pick: 35, order: 25, number: 20, choice: 12, compare: 8 },
};

/** Seconds the last player has to pick the pack, by pace. */
export const PACK_PICK_SECONDS: Record<Exclude<Pace, "none">, number> = { calm: 20, fast: 12 };

/** Seconds the answers stay up before the room moves on by itself, by pace and card kind. */
export const REVEAL_SECONDS: Record<Exclude<Pace, "none">, Record<CardKind, number>> = {
  calm: { pick: 30, order: 25, number: 20, choice: 20, compare: 15 },
  fast: { pick: 20, order: 15, number: 12, choice: 12, compare: 10 },
};

/** Answers arriving this long after the deadline still count (network delay). */
export const GRACE_MS = 1000;
export const MAX_PLAYERS = 12;
export const MAX_NAME = 24;

export interface RoomSettings {
  mode: Mode;
  rounds: number;
  target: number | null;
  wipe: WipeRule;
  showCorrectCount: boolean;
  difficulties: number[];
  packIds: string[];
  pace: Pace;
  lastPicks: boolean;
}

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  mode: "mix",
  rounds: 10,
  target: null,
  wipe: "always",
  showCorrectCount: false,
  difficulties: [1, 2, 3],
  packIds: [],
  pace: "calm",
  lastPicks: true,
};

export interface RoomPlayer {
  id: string;
  name: string;
  score: number;
  /** Colour slot 0..MAX_PLAYERS-1, unique in the room. */
  color: number;
  connected: boolean;
}

export type RoomPhase = "lobby" | "choosePack" | "question" | "reveal" | "over";

/** A finished card for the titles, by player id (players may leave). */
export type RoomRound = Omit<RoundRecord, "results"> & { results: (RoundRecord["results"][number] & { playerId: string })[] };

export interface RoomResult {
  playerId: string;
  answer: Answer;
  points: number;
}

export interface RoomState {
  code: string;
  seed: number;
  /** The creator; controls the room while connected. */
  hostId: string;
  players: RoomPlayer[];
  settings: RoomSettings;
  /** Question keys to avoid when dealing (the creator's seen cards and earlier games in this room). */
  seen: string[];
  deck: string[];
  deckPos: number;
  round: number;
  card: Card | null;
  phase: RoomPhase;
  /** Answers to the current card by player id. */
  answers: Record<string, Answer>;
  /** Server time (ms) when the question closes; null without a time limit. */
  deadline: number | null;
  /** Scored answers of the current card, filled at the reveal. */
  results: RoomResult[];
  /** Players who tapped "next" on the reveal. */
  ready: string[];
  /** Keys of cards played in the current game. */
  played: string[];
  /** Finished cards of the current game, for the titles. */
  history: RoomRound[];
  /** Last place picks the pack of the next card. */
  packChoice: { chooser: string; options: { id: string; title: string }[] } | null;
  /** Who picked the pack of the current card. */
  pickedBy: string | null;
  /** Tie-break: ids of the tied leaders who answer one extra number card; stays set once the game is over. */
  tiebreak: string[] | null;
}

/** What a device may ask for. The server adds `by` (the sender) and `now`. */
export type ClientAction =
  | { type: "start" }
  | { type: "pick"; option: number }
  | { type: "bank" }
  | { type: "submitOrder"; arrangement: number[] }
  | { type: "submitNumber"; value: number }
  | { type: "submitChoice"; option: number }
  | { type: "close" }
  | { type: "ready" }
  | { type: "next" }
  | { type: "kick"; id: string }
  | { type: "again" }
  | { type: "choosePack"; packId: string };

export type RoomAction =
  | (ClientAction & { by: string; now: number; seed?: number })
  | { type: "join"; id: string; name: string }
  | { type: "connect"; id: string; connected: boolean }
  | { type: "tick"; now: number };

export interface CreateRoomInput {
  code: string;
  hostId: string;
  hostName: string;
  settings: RoomSettings;
  packs: Pack[];
  seen: string[];
  seed: number;
}

/** Returns null when the settings select no questions or the name is not usable. */
export function createRoom(input: CreateRoomInput): RoomState | null {
  const name = cleanName(input.hostName);
  if (!name) return null;
  if (dealDeck(input.packs, input.settings, input.seen, input.seed).length === 0) return null;
  return {
    code: input.code,
    seed: input.seed,
    hostId: input.hostId,
    players: [{ id: input.hostId, name, score: 0, color: 0, connected: true }],
    settings: input.settings,
    seen: input.seen,
    deck: [],
    deckPos: 0,
    round: 0,
    card: null,
    phase: "lobby",
    answers: {},
    deadline: null,
    results: [],
    ready: [],
    played: [],
    history: [],
    packChoice: null,
    pickedBy: null,
    tiebreak: null,
  };
}

function dealDeck(packs: Pack[], settings: RoomSettings, seen: string[], seed: number): string[] {
  return buildDeck(
    packs,
    { packIds: settings.packIds, difficulties: settings.difficulties, types: typesFor(settings.mode), seen: new Set(seen) },
    createRng(seed),
  ).map((e) => `${e.pack.id}/${e.question.id}`);
}

export function cleanName(raw: string): string | null {
  const name = raw.replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
  return name ? name : null;
}

export type JoinError = "full" | "nameTaken" | "badName";

/** Why a new player with this name cannot join, or null if they can. */
export function joinError(s: RoomState, rawName: string): JoinError | null {
  const name = cleanName(rawName);
  if (!name) return "badName";
  if (s.players.length >= MAX_PLAYERS) return "full";
  if (s.players.some((p) => p.name.toLocaleLowerCase("sk") === name.toLocaleLowerCase("sk"))) return "nameTaken";
  return null;
}

/** Who may start, skip and end questions: the creator while connected, else the first connected player. */
export function controllerId(s: RoomState): string {
  const host = s.players.find((p) => p.id === s.hostId);
  if (host?.connected) return host.id;
  return s.players.find((p) => p.connected)?.id ?? host?.id ?? s.players[0]?.id ?? s.hostId;
}

export function kindOf(card: Card): CardKind {
  return card.type === "choice" && card.compare ? "compare" : card.type;
}

export function answerSeconds(card: Card, pace: Pace): number | null {
  return pace === "none" ? null : ANSWER_SECONDS[pace][kindOf(card)];
}

/** Whether a player's answer to the current card is final. */
function isFinal(a: Answer | undefined): boolean {
  if (!a) return false;
  return a.type === "pick" ? a.status !== "playing" : true;
}

/** Every connected player has a final answer (players who dropped out are not waited for). */
export function allAnswered(s: RoomState): boolean {
  const live = s.players.filter((p) => p.connected && answers(s, p.id));
  return live.length > 0 && live.every((p) => isFinal(s.answers[p.id]));
}

export function totalRounds(s: RoomState): number | null {
  return s.settings.target == null ? Math.min(s.settings.rounds, Math.max(s.deck.length, s.round)) : null;
}

/** Whether this player answers the current card (in a tie-break only the tied leaders do). */
export function answers(s: Pick<RoomState, "tiebreak">, id: string): boolean {
  return !s.tiebreak || s.tiebreak.includes(id);
}

export function isLastRound(s: RoomState): boolean {
  if (s.tiebreak) return true;
  if (s.deckPos >= s.deck.length - 1) return true;
  if (s.settings.target != null) return s.phase === "reveal" && s.players.some((p) => p.score >= s.settings.target!);
  return s.round >= s.settings.rounds;
}

export function reduceRoom(s: RoomState, a: RoomAction, packs: Pack[]): RoomState {
  switch (a.type) {
    case "join": {
      if (typeof a.id !== "string" || typeof a.name !== "string" || s.players.some((p) => p.id === a.id) || joinError(s, a.name)) return s;
      const used = new Set(s.players.map((p) => p.color));
      const color = Array.from({ length: MAX_PLAYERS }, (_, i) => i).find((i) => !used.has(i)) ?? 0;
      const player: RoomPlayer = { id: a.id, name: cleanName(a.name)!, score: 0, color, connected: true };
      return { ...s, players: [...s.players, player] };
    }

    case "connect": {
      if (!s.players.some((p) => p.id === a.id)) return s;
      return { ...s, players: s.players.map((p) => (p.id === a.id ? { ...p, connected: a.connected } : p)) };
    }

    case "tick":
      if (s.deadline == null || a.now <= s.deadline + GRACE_MS) return s;
      if (s.phase === "question") return closeQuestion(s, a.now);
      // The answers were up long enough: everyone moves on.
      if (s.phase === "reveal") return nextCard(s, a.now, packs);
      // Nobody picked in time: the first offered pack.
      if (s.phase === "choosePack" && s.packChoice) return choosePack(s, s.packChoice.options[0].id, a.now, packs);
      return s;

    case "kick": {
      if (typeof a.id !== "string" || a.by !== controllerId(s) || a.id === a.by || !s.players.some((p) => p.id === a.id)) return s;
      const { [a.id]: _gone, ...answers } = s.answers;
      const next: RoomState = {
        ...s,
        players: s.players.filter((p) => p.id !== a.id),
        answers,
        results: s.results.filter((r) => r.playerId !== a.id),
        ready: s.ready.filter((id) => id !== a.id),
      };
      return afterChange(next, a.now, packs);
    }

    case "start": {
      if (s.phase !== "lobby" || a.by !== controllerId(s)) return s;
      const seed = a.seed ?? s.seed;
      const deck = dealDeck(packs, s.settings, s.seen, seed);
      const card = firstCard(deck, packs, seed, 0);
      if (!card) return s;
      return beginQuestion({ ...s, seed, deck, deckPos: card.pos, round: 1, played: [] }, card.card, a.now);
    }

    case "pick": {
      if (!accepting(s, a)) return s;
      const card = s.card;
      if (card?.type !== "pick") return s;
      const prev = s.answers[a.by];
      const ans = prev?.type === "pick" ? prev : { type: "pick" as const, picks: [], status: "playing" as const };
      if (!Number.isInteger(a.option) || a.option < 0 || a.option >= card.options.length) return s;
      if (ans.status !== "playing" || ans.picks.includes(a.option)) return s;
      const picks = [...ans.picks, a.option];
      const found = picks.filter((i) => card.options[i].correct).length;
      const status = !card.options[a.option].correct ? "busted" : found === card.correctCount ? "complete" : "playing";
      return answer(s, a.by, { type: "pick", picks, status }, a.now, packs);
    }

    case "bank": {
      if (!accepting(s, a)) return s;
      const prev = s.answers[a.by];
      if (prev?.type !== "pick" || prev.status !== "playing" || prev.picks.length === 0) return s;
      return answer(s, a.by, { ...prev, status: "banked" }, a.now, packs);
    }

    case "submitOrder": {
      if (!accepting(s, a) || s.card?.type !== "order" || s.answers[a.by]) return s;
      const n = s.card.items.length;
      const arr = a.arrangement;
      const valid = Array.isArray(arr) && arr.length === n && new Set(arr).size === n && arr.every((i) => Number.isInteger(i) && i >= 0 && i < n);
      if (!valid) return s;
      return answer(s, a.by, { type: "order", arrangement: arr.slice() }, a.now, packs);
    }

    case "submitNumber":
      if (!accepting(s, a) || s.card?.type !== "number" || s.answers[a.by] || typeof a.value !== "number" || !Number.isFinite(a.value)) return s;
      return answer(s, a.by, { type: "number", value: a.value }, a.now, packs);

    case "submitChoice":
      if (!accepting(s, a) || s.card?.type !== "choice" || s.answers[a.by]) return s;
      if (!Number.isInteger(a.option) || a.option < 0 || a.option >= s.card.options.length) return s;
      return answer(s, a.by, { type: "choice", option: a.option }, a.now, packs);

    case "close":
      if (s.phase !== "question" || a.by !== controllerId(s)) return s;
      return closeQuestion(s, a.now);

    case "ready": {
      if (s.phase !== "reveal" || !isPlayer(s, a.by) || s.ready.includes(a.by)) return s;
      return afterChange({ ...s, ready: [...s.ready, a.by] }, a.now, packs);
    }

    case "next":
      if (s.phase !== "reveal" || a.by !== controllerId(s)) return s;
      return nextCard(s, a.now, packs);

    case "choosePack": {
      if (s.phase !== "choosePack" || !s.packChoice || typeof a.packId !== "string") return s;
      const chooser = s.players.find((p) => p.id === s.packChoice!.chooser);
      // The last player picks; while they are away (or gone), the controller may.
      const allowed = a.by === s.packChoice.chooser || (a.by === controllerId(s) && !chooser?.connected);
      if (!allowed || !s.packChoice.options.some((o) => o.id === a.packId)) return s;
      return choosePack(s, a.packId, a.now, packs);
    }

    case "again": {
      if (s.phase !== "over" || a.by !== controllerId(s)) return s;
      return {
        ...s,
        seed: a.seed ?? s.seed + 1,
        seen: Array.from(new Set([...s.seen, ...s.played])),
        players: s.players.map((p) => ({ ...p, score: 0 })),
        deck: [],
        deckPos: 0,
        round: 0,
        card: null,
        phase: "lobby",
        answers: {},
        deadline: null,
        results: [],
        ready: [],
        played: [],
        history: [],
        packChoice: null,
        pickedBy: null,
        tiebreak: null,
      };
    }

    default:
      // Unknown actions (e.g. from a newer or broken client) change nothing.
      return s;
  }
}

function isPlayer(s: RoomState, id: string): boolean {
  return s.players.some((p) => p.id === id);
}

/** An answer from this player is accepted now. */
function accepting(s: RoomState, a: { by: string; now: number }): boolean {
  if (s.phase !== "question" || !isPlayer(s, a.by) || !answers(s, a.by)) return false;
  return s.deadline == null || a.now <= s.deadline + GRACE_MS;
}

function answer(s: RoomState, id: string, ans: Answer, now: number, packs: Pack[]): RoomState {
  return afterChange({ ...s, answers: { ...s.answers, [id]: ans } }, now, packs);
}

/** Closes the question once everyone answered, or moves on once everyone is ready. */
function afterChange(s: RoomState, now: number, packs: Pack[]): RoomState {
  if (s.phase === "question" && allAnswered(s)) return closeQuestion(s, now);
  if (s.phase === "reveal") {
    const live = s.players.filter((p) => p.connected);
    if (live.length > 0 && live.every((p) => s.ready.includes(p.id))) return nextCard(s, now, packs);
  }
  return s;
}

function firstCard(deck: string[], packs: Pack[], seed: number, from: number): { card: Card; pos: number } | null {
  // Skip keys whose question disappeared (cannot happen with uploaded packs, but keeps it safe).
  for (let pos = from; pos < deck.length; pos++) {
    const card = cardFor(deck[pos], packs, seed, pos);
    if (card) return { card, pos };
  }
  return null;
}

function beginQuestion(s: RoomState, card: Card, now: number): RoomState {
  const secs = answerSeconds(card, s.settings.pace);
  return {
    ...s,
    card,
    phase: "question",
    answers: {},
    results: [],
    ready: [],
    deadline: secs == null ? null : now + secs * 1000,
  };
}

/** Scores the card: unfinished pick turns are banked; players without an answer score nothing. */
function closeQuestion(s: RoomState, now: number): RoomState {
  const card = s.card!;
  const results: RoomResult[] = [];
  for (const p of s.players) {
    let a = s.answers[p.id];
    if (!a) continue;
    if (a.type === "pick" && a.status === "playing") a = { ...a, status: "banked" };
    results.push({ playerId: p.id, answer: a, points: 0 });
  }
  const turns: TurnResult[] = results.map((r, i) => ({ player: i, answer: r.answer, points: 0 }));
  const points =
    s.tiebreak && card.type === "number"
      ? tiebreakPoints(card, results.map((r) => (r.answer.type === "number" ? (r.answer.value ?? NaN) : NaN)))
      : scoreCard(card, turns, s.settings.wipe, s.players.length);
  const scored = results.map((r, i) => ({ ...r, points: points[i] ?? 0 }));
  const rec = roundRecord(card, scored.map((r, i) => ({ player: i, answer: r.answer, points: r.points })));
  const round: RoomRound = { ...rec, results: rec.results.map((x) => ({ ...x, playerId: scored[x.player].playerId })) };
  const players = s.players.map((p) => ({
    ...p,
    score: p.score + (scored.find((r) => r.playerId === p.id)?.points ?? 0),
  }));
  const secs = s.settings.pace === "none" ? null : REVEAL_SECONDS[s.settings.pace][kindOf(card)];
  return { ...s, players, results: scored, history: [...(s.history ?? []), round], phase: "reveal", deadline: secs == null ? null : now + secs * 1000, ready: [] };
}

function nextCard(s: RoomState, now: number, packs: Pack[]): RoomState {
  const played = [...s.played, s.card!.key];
  const over = (): RoomState => ({ ...s, played, phase: "over", answers: {}, ready: [], deadline: null });
  if (s.tiebreak) return over();
  // The game is over: a tie for first goes to a tie-break.
  const end = (): RoomState => startTiebreak({ ...s, played }, now, packs) ?? over();
  if (isLastRound(s)) return end();
  if (s.settings.target != null && s.players.some((p) => p.score >= s.settings.target!)) return end();
  const next = firstCard(s.deck, packs, s.seed, s.deckPos + 1);
  if (!next) return end();
  const round = s.round + 1;
  const base: RoomState = { ...s, played, deckPos: next.pos, round, pickedBy: null, packChoice: null };
  if (s.settings.lastPicks && s.players.length > 1 && isPackPickRound(round)) {
    const ids = packOptions(s.deck, next.pos, s.seed, round);
    const options = ids.map((id) => ({ id, title: packs.find((p) => p.id === id)?.title ?? id }));
    if (options.length >= 2) {
      const chooser = s.players[lastPlace(s.players.map((p) => p.score), s.seed, round)].id;
      const secs = s.settings.pace === "none" ? null : PACK_PICK_SECONDS[s.settings.pace];
      return {
        ...base,
        card: next.card,
        phase: "choosePack",
        packChoice: { chooser, options },
        answers: {},
        results: [],
        ready: [],
        deadline: secs == null ? null : now + secs * 1000,
      };
    }
  }
  return beginQuestion(base, next.card, now);
}

/** One extra number card for the players sharing the top score; null when there is no tie or no number card. */
function startTiebreak(s: RoomState, now: number, packs: Pack[]): RoomState | null {
  const tied = tiedLeaders(s.players.map((p) => p.score)).map((i) => s.players[i].id);
  if (!tied.length) return null;
  const key = tiebreakKey(s.deck, s.deckPos + 1, packs, s.settings.packIds, [...s.seen, ...s.played], s.seed);
  const card = key ? cardFor(key, packs, s.seed, s.deck.length) : null;
  if (!card) return null;
  return beginQuestion({ ...s, round: s.round + 1, pickedBy: null, packChoice: null, tiebreak: tied }, card, now);
}

function choosePack(s: RoomState, packId: string, now: number, packs: Pack[]): RoomState {
  let deck = bringForward(s.deck, s.deckPos, packId);
  let card = cardFor(deck[s.deckPos], packs, s.seed, s.deckPos);
  if (!card) [deck, card] = [s.deck, s.card!];
  return beginQuestion({ ...s, deck, pickedBy: s.packChoice?.chooser ?? null, packChoice: null }, card, now);
}

// ---------------------------------------------------------------------------
// Views: what one device may see.

/** A card without its answers, for the question phase. */
export type HiddenCard = {
  key: string;
  packId: string;
  packTitle: string;
  prompt: string;
  difficulty: number;
  asOf?: string;
} & (
  | { type: "pick"; options: { text: string }[]; correctCount?: number }
  | { type: "order"; direction: "asc" | "desc"; unit?: string; items: { text: string }[] }
  | { type: "number"; unit?: string; decimals: number }
  | { type: "choice"; options: { text: string }[]; compare?: "asc" | "desc" }
);

export function hideCard(card: Card, showCount: boolean): HiddenCard {
  const base = {
    key: card.key,
    packId: card.packId,
    packTitle: card.packTitle,
    prompt: card.prompt,
    difficulty: card.difficulty,
    ...(card.asOf ? { asOf: card.asOf } : {}),
  };
  switch (card.type) {
    case "pick":
      return {
        ...base,
        type: "pick",
        options: card.options.map((o) => ({ text: o.text })),
        ...(showCount ? { correctCount: card.correctCount } : {}),
      };
    case "order":
      return {
        ...base,
        type: "order",
        direction: card.direction,
        ...(card.unit ? { unit: card.unit } : {}),
        items: card.items.map((it) => ({ text: it.text })),
      };
    case "number":
      return { ...base, type: "number", ...(card.unit ? { unit: card.unit } : {}), decimals: numberDecimals(card) };
    case "choice":
      return {
        ...base,
        type: "choice",
        options: card.options.map((o) => ({ text: o.text })),
        ...(card.compare ? { compare: card.compare } : {}),
      };
  }
}

/** The viewer's own answer during the question; pick turns show what their picks turned out to be. */
export type MyAnswer =
  | {
      type: "pick";
      picks: { option: number; correct: boolean; why: string }[];
      status: "playing" | "banked" | "busted" | "complete";
      points: number;
    }
  | Exclude<Answer, { type: "pick" }>;

export interface PlayerView {
  id: string;
  name: string;
  score: number;
  color: number;
  connected: boolean;
  /** Has a final answer (question) or tapped next (reveal). */
  done: boolean;
  /** Pick card progress, visible to all: busting and banking are part of the fun. */
  pick?: { status: "playing" | "banked" | "busted" | "complete"; found: number };
}

export interface RoomView {
  code: string;
  phase: RoomPhase;
  round: number;
  totalRounds: number | null;
  lastRound: boolean;
  settings: Omit<RoomSettings, "packIds"> & { packCount: number };
  /** The viewer's player id; null for a big screen. */
  you: string | null;
  hostId: string;
  controller: string;
  players: PlayerView[];
  /** Hidden card while answering, the full card at the reveal. */
  card: HiddenCard | null;
  full: Card | null;
  deadline: number | null;
  mine: MyAnswer | null;
  results: RoomResult[];
  packChoice: RoomState["packChoice"];
  pickedBy: string | null;
  /** Reveal: remarks about this card; player numbers are indices into `players`. */
  social: SocialLine[];
  /** Game over: titles; player numbers are indices into `players`. */
  titles: Title[];
  /** Tie-break: ids of the players who answer. */
  tiebreak: string[] | null;
  /** Big screens watching the room (filled in by the server). */
  screens?: number;
}

export function viewFor(s: RoomState, you: string | null): RoomView {
  const question = s.phase === "question" && s.card != null;
  const reveal = s.phase === "reveal" && s.card != null;
  const { packIds, ...settings } = s.settings;
  return {
    code: s.code,
    phase: s.phase,
    round: s.round,
    totalRounds: totalRounds(s),
    lastRound: s.phase === "question" || s.phase === "reveal" ? isLastRound(s) : false,
    settings: { ...settings, packCount: packIds.length },
    you: you && isPlayer(s, you) ? you : null,
    hostId: s.hostId,
    controller: controllerId(s),
    players: s.players.map((p) => playerView(s, p)),
    card: question ? hideCard(s.card!, s.settings.showCorrectCount) : null,
    full: reveal ? s.card : null,
    deadline: question || reveal || s.phase === "choosePack" ? s.deadline : null,
    mine: question && you ? myAnswer(s, you) : null,
    results: reveal ? s.results : [],
    packChoice: s.phase === "choosePack" ? s.packChoice : null,
    pickedBy: question || reveal ? s.pickedBy : null,
    social: reveal ? roomSocial(s) : [],
    titles: s.phase === "over" ? roomTitles(s) : [],
    tiebreak: s.tiebreak,
  };
}

function roomSocial(s: RoomState): SocialLine[] {
  const index = new Map(s.players.map((p, i) => [p.id, i]));
  const scored = s.results.filter((r) => index.has(r.playerId)).map((r) => ({ player: index.get(r.playerId)!, answer: r.answer, points: r.points }));
  return socialLines(s.card!, scored);
}

function roomTitles(s: RoomState): Title[] {
  const index = new Map(s.players.map((p, i) => [p.id, i]));
  const history: RoundRecord[] = (s.history ?? []).map((h) => ({
    type: h.type,
    results: h.results.filter((r) => index.has(r.playerId)).map(({ playerId, ...r }) => ({ ...r, player: index.get(playerId)! })),
  }));
  return titles(history, s.players.map((p) => p.score));
}

function playerView(s: RoomState, p: RoomPlayer): PlayerView {
  const a = s.answers[p.id];
  const done = s.phase === "question" ? isFinal(a) : s.phase === "reveal" ? s.ready.includes(p.id) : false;
  const view: PlayerView = { id: p.id, name: p.name, score: p.score, color: p.color, connected: p.connected, done };
  if (s.phase === "question" && a?.type === "pick" && s.card?.type === "pick") {
    const card = s.card;
    view.pick = { status: a.status, found: a.picks.filter((i) => card.options[i].correct).length };
  }
  return view;
}

function myAnswer(s: RoomState, id: string): MyAnswer | null {
  const a = s.answers[id];
  if (!a) return null;
  if (a.type !== "pick") return a;
  const card = s.card;
  if (card?.type !== "pick") return null;
  const picks = a.picks.map((i) => ({ option: i, correct: card.options[i].correct, why: card.options[i].why }));
  const found = picks.filter((p) => p.correct).length;
  const points = (found < picks.length && s.settings.wipe === "always" ? 0 : pickPoints(found));
  return { type: "pick", picks, status: a.status, points };
}
