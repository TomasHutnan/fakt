import { describe, expect, it } from "vitest";
import type { Pack } from "../content/types.ts";
import type { Card, OrderCard, PickCard } from "./cards.ts";
import { DEFAULT_SETTINGS, newGame } from "./game.ts";
import {
  allAnswered,
  ANSWER_SECONDS,
  controllerId,
  createRoom,
  DEFAULT_ROOM_SETTINGS,
  GRACE_MS,
  joinError,
  MAX_PLAYERS,
  reduceRoom,
  viewFor,
  type ClientAction,
  type RoomSettings,
  type RoomState,
} from "./room.ts";
import { POINTS, pickPoints } from "./scoring.ts";

const opt = (text: string) => ({ text, why: `${text} why` });

function makePack(id = "t"): Pack {
  return {
    id,
    title: `Pack ${id}`,
    lang: "sk",
    license: "CC0-1.0",
    adult: false,
    version: 1,
    questions: [
      ...Array.from({ length: 6 }, (_, i) => ({
        id: `p${i}`,
        type: "pick" as const,
        prompt: `Pick ${i}`,
        difficulty: 1 as const,
        source: "https://example.com/pick",
        correct: ["a", "b", "c", "d", "e"].map(opt),
        wrong: ["v", "w", "x", "y", "z", "q"].map(opt),
      })),
      {
        id: "o1",
        type: "order",
        prompt: "Order",
        difficulty: 2,
        source: "s",
        direction: "desc",
        items: [
          { text: "a", value: 4, why: "a" },
          { text: "b", value: 3, why: "b" },
          { text: "c", value: 2, why: "c" },
          { text: "d", value: 1, why: "d" },
        ],
      },
      { id: "n1", type: "number", prompt: "Number", difficulty: 2, source: "s", answer: 1000, scale: "log", tolerance: 0.1, why: "secret-why" },
      { id: "c1", type: "choice", prompt: "Choice", difficulty: 1, source: "s", correct: opt("yes"), wrong: ["no1", "no2", "no3"].map(opt) },
    ],
  };
}

const PACK = makePack();
const PACKS = [PACK];

function settings(patch: Partial<RoomSettings> = {}): RoomSettings {
  return { ...DEFAULT_ROOM_SETTINGS, packIds: [PACK.id], ...patch };
}

/** Test harness: a room with players and a clock. */
class Sim {
  s: RoomState;
  now = 1_000_000;
  constructor(names: string[], patch: Partial<RoomSettings> = {}, packs: Pack[] = PACKS) {
    const s = createRoom({ code: "KTVR", hostId: "h", hostName: names[0], settings: settings(patch), packs, seen: [], seed: 42 });
    if (!s) throw new Error("no room");
    this.s = s;
    names.slice(1).forEach((n, i) => this.raw({ type: "join", id: `p${i + 1}`, name: n }));
    this.packs = packs;
  }
  packs: Pack[];
  get ids() {
    return this.s.players.map((p) => p.id);
  }
  raw(a: Parameters<typeof reduceRoom>[1]) {
    this.s = reduceRoom(this.s, a, this.packs);
    return this.s;
  }
  act(by: string, a: ClientAction & { seed?: number }) {
    return this.raw({ ...a, by, now: this.now } as Parameters<typeof reduceRoom>[1]);
  }
  advance(ms: number) {
    this.now += ms;
    return this.raw({ type: "tick", now: this.now });
  }
  /** Plays the current card for everyone with a deterministic strategy. */
  answerAll(strategy: "best" | "worst" = "best") {
    const card = this.s.card!;
    for (const id of this.ids) {
      if (this.s.phase !== "question") break;
      if (!this.s.players.find((p) => p.id === id)?.connected) continue;
      answerOne(this, id, card, strategy);
    }
  }
}

function answerOne(sim: Sim, id: string, card: Card, strategy: "best" | "worst") {
  switch (card.type) {
    case "pick": {
      const order = card.options.map((o, i) => ({ o, i })).sort((a, b) => Number(strategy === "best" ? b.o.correct : a.o.correct) - Number(strategy === "best" ? a.o.correct : b.o.correct));
      for (const { i } of order) {
        sim.act(id, { type: "pick", option: i });
        const a = sim.s.answers[id];
        if (sim.s.phase !== "question" || (a?.type === "pick" && a.status !== "playing")) return;
      }
      return;
    }
    case "order":
      sim.act(id, { type: "submitOrder", arrangement: strategy === "best" ? card.solution : card.solution.slice().reverse() });
      return;
    case "number":
      sim.act(id, { type: "submitNumber", value: strategy === "best" ? card.answer : card.answer * 100 });
      return;
    case "choice": {
      const right = card.options.findIndex((o) => o.correct);
      sim.act(id, { type: "submitChoice", option: strategy === "best" ? right : (right + 1) % card.options.length });
    }
  }
}

/** Every key anywhere in a JSON value. */
function keysOf(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (out.add(k), keysOf(x, out));
  return out;
}

describe("room lobby", () => {
  it("creates a room with the host as the only player", () => {
    const sim = new Sim(["Jano"]);
    expect(sim.s.phase).toBe("lobby");
    expect(sim.s.players).toEqual([{ id: "h", name: "Jano", score: 0, color: 0, connected: true }]);
    expect(controllerId(sim.s)).toBe("h");
  });

  it("refuses rooms without questions or without a name", () => {
    const base = { code: "X", hostId: "h", hostName: "Jano", packs: PACKS, seen: [], seed: 1 };
    expect(createRoom({ ...base, settings: settings({ packIds: [] }) })).toBeNull();
    expect(createRoom({ ...base, settings: settings({ difficulties: [3] }) })).toBeNull();
    expect(createRoom({ ...base, hostName: "   ", settings: settings() })).toBeNull();
  });

  it("joins players with unique names and colours", () => {
    const sim = new Sim(["Jano", "Zuzka", "Miro"]);
    expect(sim.s.players.map((p) => p.name)).toEqual(["Jano", "Zuzka", "Miro"]);
    expect(new Set(sim.s.players.map((p) => p.color)).size).toBe(3);
    expect(joinError(sim.s, "zuzka")).toBe("nameTaken");
    expect(joinError(sim.s, "  ")).toBe("badName");
    expect(joinError(sim.s, "Peťa")).toBeNull();
    // A duplicate join is ignored.
    sim.raw({ type: "join", id: "x", name: "ZUZKA" });
    expect(sim.s.players).toHaveLength(3);
  });

  it("trims and shortens names", () => {
    const sim = new Sim(["Jano"]);
    sim.raw({ type: "join", id: "x", name: "  Anna   Mária  " + "x".repeat(40) });
    expect(sim.s.players[1].name).toBe(("Anna Mária " + "x".repeat(40)).slice(0, 24));
  });

  it("caps the room at MAX_PLAYERS and reuses freed colours", () => {
    const sim = new Sim(["Jano"]);
    for (let i = 1; i < MAX_PLAYERS + 3; i++) sim.raw({ type: "join", id: `p${i}`, name: `P${i}` });
    expect(sim.s.players).toHaveLength(MAX_PLAYERS);
    expect(joinError(sim.s, "Nový")).toBe("full");
    const freed = sim.s.players[3].color;
    sim.act("h", { type: "kick", id: sim.s.players[3].id });
    sim.raw({ type: "join", id: "late", name: "Late" });
    expect(sim.s.players.find((p) => p.id === "late")!.color).toBe(freed);
  });

  it("only the controller starts the game", () => {
    const sim = new Sim(["Jano", "Zuzka"]);
    sim.act("p1", { type: "start" });
    expect(sim.s.phase).toBe("lobby");
    sim.act("h", { type: "start" });
    expect(sim.s.phase).toBe("question");
    expect(sim.s.round).toBe(1);
    expect(sim.s.card).not.toBeNull();
  });

  it("hands control to the next connected player while the host is away", () => {
    const sim = new Sim(["Jano", "Zuzka", "Miro"]);
    sim.raw({ type: "connect", id: "h", connected: false });
    expect(controllerId(sim.s)).toBe("p1");
    sim.act("p1", { type: "start" });
    expect(sim.s.phase).toBe("question");
    sim.raw({ type: "connect", id: "p1", connected: false });
    expect(controllerId(sim.s)).toBe("p2");
    sim.raw({ type: "connect", id: "h", connected: true });
    expect(controllerId(sim.s)).toBe("h");
  });

  it("kicks players but never yourself, and only as controller", () => {
    const sim = new Sim(["Jano", "Zuzka", "Miro"]);
    sim.act("p1", { type: "kick", id: "p2" });
    expect(sim.s.players).toHaveLength(3);
    sim.act("h", { type: "kick", id: "h" });
    expect(sim.s.players).toHaveLength(3);
    sim.act("h", { type: "kick", id: "p2" });
    expect(sim.ids).toEqual(["h", "p1"]);
  });
});

describe("room questions", () => {
  it("everyone answers the same card at once, then the card is revealed", () => {
    const sim = new Sim(["Jano", "Zuzka", "Miro"], { mode: "classic" });
    sim.act("h", { type: "start" });
    const card = sim.s.card as PickCard;
    expect(card.type).toBe("pick");
    sim.answerAll("best");
    expect(sim.s.phase).toBe("reveal");
    const full = pickPoints(card.correctCount);
    expect(sim.s.results.map((r) => r.points)).toEqual([full, full, full]);
    expect(sim.s.players.map((p) => p.score)).toEqual([full, full, full]);
  });

  it("press your luck in parallel: bust, bank and complete are independent", () => {
    const sim = new Sim(["Jano", "Zuzka", "Miro"], { mode: "classic" });
    sim.act("h", { type: "start" });
    const card = sim.s.card as PickCard;
    const right = card.options.map((o, i) => (o.correct ? i : -1)).filter((i) => i >= 0);
    const wrong = card.options.map((o, i) => (o.correct ? -1 : i)).filter((i) => i >= 0);
    // Jano: two right, then banks.
    sim.act("h", { type: "pick", option: right[0] });
    sim.act("h", { type: "pick", option: right[1] });
    sim.act("h", { type: "bank" });
    // Zuzka: one right, then wrong.
    sim.act("p1", { type: "pick", option: right[0] });
    sim.act("p1", { type: "pick", option: wrong[0] });
    expect(sim.s.phase).toBe("question");
    const v = viewFor(sim.s, "p2");
    expect(v.players.find((p) => p.id === "h")!.pick).toEqual({ status: "banked", found: 2 });
    expect(v.players.find((p) => p.id === "p1")!.pick).toEqual({ status: "busted", found: 1 });
    expect(v.players.find((p) => p.id === "h")!.done).toBe(true);
    expect(v.players.find((p) => p.id === "p2")!.done).toBe(false);
    // Miro: all right -> complete, closes the question.
    for (const i of right) sim.act("p2", { type: "pick", option: i });
    expect(sim.s.phase).toBe("reveal");
    expect(sim.s.results.map((r) => [r.playerId, r.points])).toEqual([
      ["h", pickPoints(2)],
      ["p1", 0],
      ["p2", pickPoints(card.correctCount)],
    ]);
  });

  it("ignores repeated picks, picks after finishing, banking with nothing and out-of-range options", () => {
    const sim = new Sim(["Jano", "Zuzka"], { mode: "classic" });
    sim.act("h", { type: "start" });
    const card = sim.s.card as PickCard;
    const right = card.options.findIndex((o) => o.correct);
    const before = sim.s;
    sim.act("h", { type: "bank" });
    sim.act("h", { type: "pick", option: 99 });
    sim.act("h", { type: "pick", option: -1 });
    expect(sim.s).toBe(before);
    sim.act("h", { type: "pick", option: right });
    const after = sim.s;
    sim.act("h", { type: "pick", option: right });
    expect(sim.s).toBe(after);
    sim.act("h", { type: "bank" });
    const banked = sim.s;
    sim.act("h", { type: "pick", option: card.options.findIndex((o, i) => o.correct && i !== right) });
    expect(sim.s).toBe(banked);
  });

  it("wipe rule firstFree keeps points after a wrong pick", () => {
    const sim = new Sim(["Jano", "Zuzka"], { mode: "classic", wipe: "firstFree" });
    sim.act("h", { type: "start" });
    const card = sim.s.card as PickCard;
    const right = card.options.findIndex((o) => o.correct);
    const wrong = card.options.findIndex((o) => !o.correct);
    sim.act("h", { type: "pick", option: right });
    sim.act("h", { type: "pick", option: wrong });
    sim.act("p1", { type: "pick", option: wrong });
    expect(sim.s.phase).toBe("reveal");
    expect(sim.s.results.map((r) => r.points)).toEqual([1, 0]);
  });

  it("closes on the deadline, banking unfinished pick turns; late answers are refused", () => {
    const sim = new Sim(["Jano", "Zuzka", "Miro"], { mode: "classic", pace: "fast" });
    sim.act("h", { type: "start" });
    expect(sim.s.deadline).toBe(sim.now + ANSWER_SECONDS.fast.pick * 1000);
    const card = sim.s.card as PickCard;
    const right = card.options.map((o, i) => (o.correct ? i : -1)).filter((i) => i >= 0);
    sim.act("h", { type: "pick", option: right[0] });
    sim.act("h", { type: "pick", option: right[1] });
    // Just before the deadline plus grace nothing happens.
    sim.advance(ANSWER_SECONDS.fast.pick * 1000 + GRACE_MS);
    expect(sim.s.phase).toBe("question");
    // Within the grace period an answer still counts.
    sim.act("p1", { type: "pick", option: right[0] });
    sim.advance(1);
    expect(sim.s.phase).toBe("reveal");
    expect(sim.s.results.map((r) => [r.playerId, r.answer.type === "pick" && r.answer.status, r.points])).toEqual([
      ["h", "banked", pickPoints(2)],
      ["p1", "banked", 1],
    ]);
    // Miro never answered: no result, no points.
    expect(sim.s.players[2].score).toBe(0);
  });

  it("refuses answers after the deadline even before the tick arrives", () => {
    const sim = new Sim(["Jano", "Zuzka"], { mode: "classic", pace: "fast" });
    sim.act("h", { type: "start" });
    sim.now += ANSWER_SECONDS.fast.pick * 1000 + GRACE_MS + 1;
    const before = sim.s;
    sim.act("p1", { type: "pick", option: 0 });
    expect(sim.s).toBe(before);
  });

  it("without a time limit the question waits; the controller can close it", () => {
    const sim = new Sim(["Jano", "Zuzka"], { mode: "classic", pace: "none" });
    sim.act("h", { type: "start" });
    expect(sim.s.deadline).toBeNull();
    sim.advance(10 * 60 * 1000);
    expect(sim.s.phase).toBe("question");
    sim.act("p1", { type: "close" });
    expect(sim.s.phase).toBe("question");
    sim.act("h", { type: "close" });
    expect(sim.s.phase).toBe("reveal");
  });

  it("does not wait for players who dropped out, and keeps their seat", () => {
    const sim = new Sim(["Jano", "Zuzka", "Miro"], { mode: "classic" });
    sim.act("h", { type: "start" });
    sim.raw({ type: "connect", id: "p2", connected: false });
    sim.answerAll("best");
    expect(sim.s.phase).toBe("reveal");
    expect(sim.s.results.map((r) => r.playerId)).toEqual(["h", "p1"]);
    expect(sim.ids).toContain("p2");
    // They come back with their (zero) points and play the next card.
    sim.raw({ type: "connect", id: "p2", connected: true });
    sim.act("h", { type: "next" });
    sim.answerAll("best");
    expect(sim.s.results.map((r) => r.playerId)).toEqual(["h", "p1", "p2"]);
  });

  it("a player who joins mid-question can still answer it", () => {
    const sim = new Sim(["Jano", "Zuzka"], { mode: "classic" });
    sim.act("h", { type: "start" });
    sim.raw({ type: "join", id: "late", name: "Peťa" });
    expect(viewFor(sim.s, "late").card).not.toBeNull();
    sim.answerAll("best");
    expect(sim.s.results.map((r) => r.playerId)).toEqual(["h", "p1", "late"]);
  });

  it("kicking the last player who has not answered closes the question", () => {
    const sim = new Sim(["Jano", "Zuzka", "Miro"], { mode: "classic" });
    sim.act("h", { type: "start" });
    const card = sim.s.card!;
    answerOne(sim, "h", card, "best");
    answerOne(sim, "p1", card, "best");
    expect(sim.s.phase).toBe("question");
    sim.act("h", { type: "kick", id: "p2" });
    expect(sim.s.phase).toBe("reveal");
  });

  it("strangers cannot answer", () => {
    const sim = new Sim(["Jano", "Zuzka"], { mode: "classic" });
    sim.act("h", { type: "start" });
    const before = sim.s;
    sim.act("nobody", { type: "pick", option: 0 });
    sim.act("nobody", { type: "ready" });
    expect(sim.s).toBe(before);
  });
});

describe("room card formats", () => {
  /** Starts a mix game and moves on until a card of the given kind comes up. */
  function until(sim: Sim, pred: (c: Card) => boolean): Card {
    sim.act("h", { type: "start" });
    for (let i = 0; i < 50; i++) {
      if (pred(sim.s.card!)) return sim.s.card!;
      sim.act("h", { type: "close" });
      sim.act("h", { type: "next" });
      if (sim.s.phase === "over") {
        sim.act("h", { type: "again", seed: i + 100 });
        sim.act("h", { type: "start", seed: i + 100 });
      }
    }
    throw new Error("card kind never came up");
  }
  const mix = () => new Sim(["Jano", "Zuzka", "Miro"], { mode: "mix", rounds: 20 });

  it("order: points per right position, invalid arrangements refused", () => {
    const sim = mix();
    const card = until(sim, (c) => c.type === "order") as OrderCard;
    const n = card.items.length;
    const before = sim.s;
    sim.act("h", { type: "submitOrder", arrangement: [0, 0, 1, 2, 3].slice(0, n) });
    sim.act("h", { type: "submitOrder", arrangement: [0, 1] });
    sim.act("h", { type: "submitOrder", arrangement: Array.from({ length: n }, (_, i) => i + 10) });
    expect(sim.s).toBe(before);
    sim.act("h", { type: "submitOrder", arrangement: card.solution });
    // Second submission is ignored.
    const once = sim.s;
    sim.act("h", { type: "submitOrder", arrangement: card.solution.slice().reverse() });
    expect(sim.s).toBe(once);
    sim.answerAll("worst");
    const perfect = n * POINTS.orderPerPosition + POINTS.orderPerfectBonus;
    expect(sim.s.results[0].points).toBe(perfect);
  });

  it("number: guesses are ranked among the players", () => {
    const sim = mix();
    const card = until(sim, (c) => c.type === "number");
    if (card.type !== "number") throw new Error();
    sim.act("h", { type: "submitNumber", value: card.answer });
    sim.act("p1", { type: "submitNumber", value: card.answer * 2 });
    sim.act("p2", { type: "submitNumber", value: Number.NaN });
    expect(sim.s.phase).toBe("question"); // NaN refused
    sim.act("p2", { type: "submitNumber", value: card.answer * 1000 });
    expect(sim.s.phase).toBe("reveal");
    expect(sim.s.results.map((r) => r.points)).toEqual([POINTS.numberRanked[0] + POINTS.numberWithinToleranceBonus, POINTS.numberRanked[1], 0]);
  });

  it("choice and which-is-more: right answers score, out of range refused", () => {
    const sim = mix();
    const card = until(sim, (c) => c.type === "choice");
    if (card.type !== "choice") throw new Error();
    const before = sim.s;
    sim.act("h", { type: "submitChoice", option: card.options.length });
    expect(sim.s).toBe(before);
    sim.answerAll("best");
    const worth = card.compare ? POINTS.compare : POINTS.choice;
    expect(sim.s.results.map((r) => r.points)).toEqual([worth, worth, worth]);
  });

  it("timers depend on the card kind", () => {
    const sim = new Sim(["Jano"], { mode: "mix", pace: "calm", rounds: 20 });
    sim.act("h", { type: "start" });
    for (let i = 0; i < 9 && sim.s.phase === "question"; i++) {
      const c = sim.s.card!;
      const kind = c.type === "choice" && c.compare ? "compare" : c.type;
      expect(sim.s.deadline! - sim.now).toBe(ANSWER_SECONDS.calm[kind] * 1000);
      sim.act("h", { type: "close" });
      sim.act("h", { type: "next" });
    }
  });
});

describe("room rounds and game end", () => {
  it("waits for everyone to be ready, then deals the next card", () => {
    const sim = new Sim(["Jano", "Zuzka", "Miro"], { mode: "classic", rounds: 3 });
    sim.act("h", { type: "start" });
    sim.answerAll();
    const first = sim.s.card!.key;
    sim.act("h", { type: "ready" });
    sim.act("p1", { type: "ready" });
    sim.act("p1", { type: "ready" });
    expect(sim.s.phase).toBe("reveal");
    expect(viewFor(sim.s, "h").players.map((p) => p.done)).toEqual([true, true, false]);
    sim.act("p2", { type: "ready" });
    expect(sim.s.phase).toBe("question");
    expect(sim.s.round).toBe(2);
    expect(sim.s.card!.key).not.toBe(first);
  });

  it("disconnected players are not waited for on the reveal", () => {
    const sim = new Sim(["Jano", "Zuzka"], { mode: "classic" });
    sim.act("h", { type: "start" });
    sim.answerAll();
    sim.raw({ type: "connect", id: "p1", connected: false });
    sim.act("h", { type: "ready" });
    expect(sim.s.phase).toBe("question");
  });

  it("plays the set number of rounds, never repeating a card, and ends", () => {
    const sim = new Sim(["Jano", "Zuzka"], { mode: "mix", rounds: 5 });
    sim.act("h", { type: "start" });
    const keys: string[] = [];
    while (sim.s.phase !== "over") {
      keys.push(sim.s.card!.key);
      expect(viewFor(sim.s, "h").lastRound).toBe(sim.s.round === 5);
      sim.answerAll(sim.s.round % 2 ? "best" : "worst");
      for (const id of sim.ids) sim.act(id, { type: "ready" });
    }
    expect(keys).toHaveLength(5);
    expect(new Set(keys).size).toBe(5);
    expect(sim.s.played).toEqual(keys);
    expect(sim.s.players[0].score).toBeGreaterThan(0);
  });

  it("ends when the deck runs out before the set rounds", () => {
    const sim = new Sim(["Jano"], { mode: "classic", rounds: 20 });
    sim.act("h", { type: "start" });
    expect(viewFor(sim.s, "h").totalRounds).toBe(6);
    let n = 0;
    while (sim.s.phase !== "over") {
      sim.act("h", { type: "close" });
      sim.act("h", { type: "next" });
      n++;
    }
    expect(n).toBe(6);
  });

  it("target score: plays until someone reaches it", () => {
    const sim = new Sim(["Jano", "Zuzka"], { mode: "classic", target: 20, rounds: 10 });
    sim.act("h", { type: "start" });
    expect(viewFor(sim.s, "h").totalRounds).toBeNull();
    while (sim.s.phase !== "over") {
      sim.answerAll("best");
      sim.act("h", { type: "next" });
    }
    expect(sim.s.players.some((p) => p.score >= 20)).toBe(true);
  });

  it("again: back to the lobby with scores reset and fresh cards", () => {
    const sim = new Sim(["Jano", "Zuzka"], { mode: "classic", rounds: 3 });
    sim.act("h", { type: "start" });
    while (sim.s.phase !== "over") {
      sim.answerAll("best");
      sim.act("h", { type: "next" });
    }
    const first = sim.s.played.slice();
    sim.act("p1", { type: "again", seed: 7 });
    expect(sim.s.phase).toBe("over");
    sim.act("h", { type: "again", seed: 7 });
    expect(sim.s.phase).toBe("lobby");
    expect(sim.s.players.every((p) => p.score === 0)).toBe(true);
    sim.act("h", { type: "start", seed: 7 });
    const second: string[] = [];
    while (sim.s.phase !== "over") {
      second.push(sim.s.card!.key);
      sim.act("h", { type: "close" });
      sim.act("h", { type: "next" });
    }
    // 6 pick questions: the second game of 3 uses the other 3.
    expect(second.filter((k) => first.includes(k))).toEqual([]);
  });

  it("is deterministic for a seed", () => {
    const play = () => {
      const sim = new Sim(["Jano", "Zuzka"], { mode: "mix", rounds: 5 });
      sim.act("h", { type: "start", seed: 99 });
      const out: string[] = [];
      while (sim.s.phase !== "over") {
        out.push(JSON.stringify(sim.s.card));
        sim.act("h", { type: "close" });
        sim.act("h", { type: "next" });
      }
      return out;
    };
    expect(play()).toEqual(play());
  });

  it("deals the same cards as the one-phone game for the same seed", () => {
    const sim = new Sim(["Jano"], { mode: "mix", rounds: 5 });
    sim.act("h", { type: "start", seed: 5 });
    const g = newGame({ players: ["Jano"], settings: { ...DEFAULT_SETTINGS, packIds: [PACK.id] }, packs: PACKS, seen: new Set(), seed: 5 })!;
    expect(sim.s.card).toEqual(g.card);
  });
});

describe("room views", () => {
  const SECRET_KEYS = ["correct", "why", "answer", "solution", "value", "label", "source", "note", "tolerance", "scale"];

  it("never reveals answers while the question is open, on any card kind", () => {
    const sim = new Sim(["Jano", "Zuzka"], { mode: "mix", rounds: 20 });
    sim.act("h", { type: "start" });
    const kinds = new Set<string>();
    while (sim.s.phase !== "over") {
      kinds.add(sim.s.card!.type);
      for (const you of ["h", "p1", null]) {
        const v = viewFor(sim.s, you);
        const keys = keysOf({ ...v, mine: null });
        for (const k of SECRET_KEYS) expect(keys.has(k), `${sim.s.card!.type} view has ${k}`).toBe(false);
        expect(JSON.stringify(v)).not.toContain("secret-why");
        expect(v.full).toBeNull();
      }
      sim.act("h", { type: "close" });
      sim.act("h", { type: "next" });
    }
    expect([...kinds].sort()).toEqual(["choice", "number", "order", "pick"]);
  });

  it("shows your own picks with their verdict, but not other players' picks", () => {
    const sim = new Sim(["Jano", "Zuzka"], { mode: "classic" });
    sim.act("h", { type: "start" });
    const card = sim.s.card as PickCard;
    const right = card.options.findIndex((o) => o.correct);
    sim.act("h", { type: "pick", option: right });
    const mine = viewFor(sim.s, "h").mine;
    expect(mine).toEqual({ type: "pick", picks: [{ option: right, correct: true, why: card.options[right].why }], status: "playing", points: 1 });
    expect(viewFor(sim.s, "p1").mine).toBeNull();
    expect(JSON.stringify(viewFor(sim.s, "p1"))).not.toContain(card.options[right].why);
    expect(viewFor(sim.s, null).mine).toBeNull();
  });

  it("shows the correct count only with the setting", () => {
    const off = new Sim(["Jano"], { mode: "classic" });
    off.act("h", { type: "start" });
    expect(viewFor(off.s, "h").card).not.toHaveProperty("correctCount");
    const on = new Sim(["Jano"], { mode: "classic", showCorrectCount: true });
    on.act("h", { type: "start" });
    expect(viewFor(on.s, "h").card).toHaveProperty("correctCount", (on.s.card as PickCard).correctCount);
  });

  it("the reveal shows the full card and everyone's answers", () => {
    const sim = new Sim(["Jano", "Zuzka"], { mode: "classic" });
    sim.act("h", { type: "start" });
    sim.answerAll();
    const v = viewFor(sim.s, null);
    expect(v.full).toEqual(sim.s.card);
    expect(v.card).toBeNull();
    expect(v.results).toHaveLength(2);
    expect(v.you).toBeNull();
  });

  it("a stranger's view has no seat", () => {
    const sim = new Sim(["Jano"]);
    expect(viewFor(sim.s, "nobody").you).toBeNull();
    expect(viewFor(sim.s, "h").you).toBe("h");
  });

  it("allAnswered ignores disconnected players but needs someone", () => {
    const sim = new Sim(["Jano", "Zuzka"], { mode: "classic" });
    sim.act("h", { type: "start" });
    sim.raw({ type: "connect", id: "h", connected: false });
    sim.raw({ type: "connect", id: "p1", connected: false });
    expect(allAnswered(sim.s)).toBe(false);
  });
});

describe("room fuzz", () => {
  it("random play by many players never breaks invariants", () => {
    for (let seed = 1; seed <= 30; seed++) {
      let r = seed;
      const rand = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      const names = Array.from({ length: 2 + (seed % 7) }, (_, i) => `Hráč ${i}`);
      const sim = new Sim(names, { mode: seed % 2 ? "mix" : "classic", rounds: 5 + (seed % 4), pace: seed % 3 ? "fast" : "none", wipe: seed % 5 ? "always" : "firstFree" });
      sim.act("h", { type: "start", seed });
      for (let step = 0; step < 3000 && sim.s.phase !== "over"; step++) {
        const id = sim.ids[Math.floor(rand() * sim.ids.length)];
        const x = rand();
        const card = sim.s.card!;
        if (x < 0.05) sim.raw({ type: "connect", id, connected: rand() < 0.7 });
        else if (x < 0.1) sim.advance(Math.floor(rand() * 20000));
        else if (x < 0.12) sim.act(sim.ids[0], { type: sim.s.phase === "question" ? "close" : "next" });
        else if (sim.s.phase === "reveal") sim.act(id, { type: "ready" });
        else if (card.type === "pick") sim.act(id, rand() < 0.2 ? { type: "bank" } : { type: "pick", option: Math.floor(rand() * 11) - 1 });
        else if (card.type === "order") sim.act(id, { type: "submitOrder", arrangement: [...card.items.keys()].sort(() => rand() - 0.5) });
        else if (card.type === "number") sim.act(id, { type: "submitNumber", value: Math.floor(rand() * 5000) });
        else sim.act(id, { type: "submitChoice", option: Math.floor(rand() * 5) - 1 });

        const s = sim.s;
        expect(s.players.every((p) => p.score >= 0 && Number.isInteger(p.score))).toBe(true);
        expect(new Set(s.players.map((p) => p.color)).size).toBe(s.players.length);
        if (s.phase === "question") expect(s.card).not.toBeNull();
        if (s.phase === "reveal") {
          const total = s.results.reduce((n, x) => n + x.points, 0);
          expect(total).toBeGreaterThanOrEqual(0);
          expect(s.results.every((x) => s.answers[x.playerId] != null)).toBe(true);
        }
        JSON.parse(JSON.stringify(s)); // stays plain JSON
      }
      // Force the game to the end if random play stalled.
      for (let i = 0; i < 100 && sim.s.phase !== "over"; i++) {
        sim.raw({ type: "connect", id: sim.ids[0], connected: true });
        sim.act(sim.ids[0], { type: sim.s.phase === "question" ? "close" : "next" });
      }
      expect(sim.s.phase).toBe("over");
      expect(new Set(sim.s.played).size).toBe(sim.s.played.length);
    }
  });
});

describe("room with several packs", () => {
  it("deals from every enabled pack only", () => {
    const packs = [makePack("a"), makePack("b"), makePack("c")];
    const sim = new Sim(["Jano"], { packIds: ["a", "b"], mode: "classic", rounds: 12 }, packs);
    sim.act("h", { type: "start" });
    const used = new Set<string>();
    while (sim.s.phase !== "over") {
      used.add(sim.s.card!.packId);
      sim.act("h", { type: "close" });
      sim.act("h", { type: "next" });
    }
    expect([...used].sort()).toEqual(["a", "b"]);
  });
});
