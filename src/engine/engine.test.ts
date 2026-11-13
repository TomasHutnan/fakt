import { describe, expect, it } from "vitest";
import type { Pack } from "../content/types.ts";
import { validatePack } from "../content/validate.ts";
import { makeCard, type NumberCard, type PickCard } from "./cards.ts";
import { DEFAULT_SETTINGS, newGame, reduce, standings, type GameState } from "./game.ts";
import { createRng } from "./rng.ts";
import { numberError, numberRankedPoints, numberSoloPoints, pickPoints, pickTurnPoints } from "./scoring.ts";

const opt = (text: string) => ({ text, why: `${text} why` });

const pack: Pack = {
  id: "test",
  title: "Test",
  lang: "sk",
  license: "CC0-1.0",
  adult: false,
  version: 1,
  questions: [
    {
      id: "p1",
      type: "pick",
      prompt: "Pick",
      difficulty: 1,
      source: "s",
      correct: ["a", "b", "c", "d", "e"].map(opt),
      wrong: ["v", "w", "x", "y", "z", "q"].map(opt),
    },
    {
      id: "p2",
      type: "pick",
      prompt: "Pick 2",
      difficulty: 2,
      source: "s",
      correct: ["a", "b"].map(opt),
      wrong: ["s", "t", "u", "v", "w", "x", "y", "z"].map(opt),
    },
    {
      id: "o1",
      type: "order",
      prompt: "Order",
      difficulty: 2,
      source: "s",
      direction: "desc",
      items: [
        { text: "a", value: 4 },
        { text: "b", value: 3 },
        { text: "c", value: 2 },
        { text: "d", value: 1 },
      ],
    },
    {
      id: "n1",
      type: "number",
      prompt: "Number",
      difficulty: 2,
      source: "s",
      answer: 1000,
      scale: "log",
      tolerance: 0.1,
      why: "w",
    },
    {
      id: "c1",
      type: "choice",
      prompt: "Choice",
      difficulty: 1,
      source: "s",
      correct: opt("yes"),
      wrong: ["no1", "no2", "no3"].map(opt),
    },
  ],
};

describe("pick cards", () => {
  it("always shows 10 options with 2–8 correct, across many seeds", () => {
    for (let seed = 0; seed < 200; seed++) {
      for (const q of pack.questions.filter((q) => q.type === "pick")) {
        const card = makeCard(pack, q, createRng(seed)) as PickCard;
        expect(card.options).toHaveLength(10);
        const correct = card.options.filter((o) => o.correct).length;
        expect(correct).toBe(card.correctCount);
        expect(correct).toBeGreaterThanOrEqual(2);
        expect(correct).toBeLessThanOrEqual(8);
      }
    }
  });

  it("scores escalating points and applies wipe rules", () => {
    expect([1, 2, 3, 4, 5].map(pickPoints)).toEqual([1, 3, 6, 10, 15]);
    const card = makeCard(pack, pack.questions[0], createRng(1)) as PickCard;
    const right = card.options.map((o, i) => (o.correct ? i : -1)).filter((i) => i >= 0);
    const wrong = card.options.findIndex((o) => !o.correct);
    expect(pickTurnPoints(card, right.slice(0, 2), "always")).toBe(3);
    expect(pickTurnPoints(card, [...right.slice(0, 2), wrong], "always")).toBe(0);
    expect(pickTurnPoints(card, [...right.slice(0, 2), wrong], "firstFree")).toBe(3);
  });
});

describe("number scoring", () => {
  const card = makeCard(pack, pack.questions[3], createRng(1)) as NumberCard;
  it("gives full points within tolerance and none far away", () => {
    expect(numberError(card, 1050)).toBeLessThan(1);
    expect(numberSoloPoints(card, 1050)).toBe(6);
    expect(numberSoloPoints(card, 100000)).toBe(0);
    expect(numberSoloPoints(card, -5)).toBe(0);
    const mid = numberSoloPoints(card, 1500);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(6);
  });
  it("ranks multiplayer guesses with shared ranks", () => {
    expect(numberRankedPoints(card, [1000, 1500, 1500, 999999])).toEqual([7, 3, 3, 0]);
  });
});

function play(seed = 42, players = ["Ana", "Bo"], settings = {}) {
  const s = newGame({
    players,
    settings: { ...DEFAULT_SETTINGS, packIds: ["test"], ...settings },
    packs: [pack],
    seen: new Set(),
    seed,
  });
  expect(s).not.toBeNull();
  return s!;
}

describe("game flow", () => {
  it("runs a classic game to the end with rotating starting player", () => {
    let s: GameState = play(7, ["Ana", "Bo"], { rounds: 2 });
    expect(s.phase).toBe("handover");
    expect(s.order).toEqual([0, 1]);
    for (let turn = 0; turn < 2; turn++) {
      s = reduce(s, { type: "continue" }, [pack]);
      expect(s.phase).toBe("play");
      if (s.card.type !== "pick") throw new Error("classic must be pick");
      const right = s.card.options.findIndex((o) => o.correct);
      s = reduce(s, { type: "pick", option: right }, [pack]);
      s = reduce(s, { type: "bank" }, [pack]);
      expect(s.phase).toBe("turnEnd");
      s = reduce(s, { type: "endTurn" }, [pack]);
    }
    expect(s.phase).toBe("reveal");
    expect(s.players.map((p) => p.score)).toEqual([1, 1]);
    s = reduce(s, { type: "nextRound" }, [pack]);
    expect(s.round).toBe(2);
    expect(s.order).toEqual([1, 0]);
    // Second round: both bust immediately.
    for (let turn = 0; turn < 2; turn++) {
      s = reduce(s, { type: "continue" }, [pack]);
      if (s.card.type !== "pick") throw new Error();
      s = reduce(s, { type: "pick", option: s.card.options.findIndex((o) => !o.correct) }, [pack]);
      s = reduce(s, { type: "endTurn" }, [pack]);
    }
    s = reduce(s, { type: "nextRound" }, [pack]);
    expect(s.phase).toBe("over");
    expect(s.played).toHaveLength(2);
  });

  it("ends a turn automatically when all correct options are found", () => {
    let s = play(3, ["Solo"]);
    expect(s.phase).toBe("play");
    if (s.card.type !== "pick") throw new Error();
    const right = s.card.options.map((o, i) => (o.correct ? i : -1)).filter((i) => i >= 0);
    for (const i of right) s = reduce(s, { type: "pick", option: i }, [pack]);
    expect(s.phase).toBe("turnEnd");
    expect(s.answer).toMatchObject({ status: "complete" });
  });

  it("ignores double picks and actions in the wrong phase", () => {
    let s = play();
    expect(reduce(s, { type: "bank" }, [pack])).toBe(s);
    s = reduce(s, { type: "continue" }, [pack]);
    if (s.card.type !== "pick") throw new Error();
    const right = s.card.options.findIndex((o) => o.correct);
    s = reduce(s, { type: "pick", option: right }, [pack]);
    expect(reduce(s, { type: "pick", option: right }, [pack])).toBe(s);
  });

  it("mix mode includes all formats and the same seed gives the same deck", () => {
    const a = play(11, ["A"], { mode: "mix" });
    const b = play(11, ["A"], { mode: "mix" });
    expect(a.deck).toEqual(b.deck);
    expect(a.deck).toHaveLength(5);
  });

  it("stops at the target score after finishing the round", () => {
    let s = play(5, ["A"], { target: 1 });
    if (s.card.type !== "pick") throw new Error();
    s = reduce(s, { type: "pick", option: s.card.options.findIndex((o) => o.correct) }, [pack]);
    s = reduce(s, { type: "bank" }, [pack]);
    s = reduce(s, { type: "endTurn" }, [pack]);
    s = reduce(s, { type: "nextRound" }, [pack]);
    expect(s.phase).toBe("over");
  });

  it("shows each player the answer after their turn when revealEach is on", () => {
    const choiceOnly: Pack = { ...pack, questions: pack.questions.filter((q) => q.type === "choice") };
    let s = newGame({
      players: ["A", "B"],
      settings: { ...DEFAULT_SETTINGS, mode: "mix", packIds: ["test"], revealEach: true },
      packs: [choiceOnly],
      seen: new Set(),
      seed: 1,
    })!;
    s = reduce(s, { type: "continue" }, [choiceOnly]);
    s = reduce(s, { type: "submitChoice", option: 0 }, [choiceOnly]);
    expect(s.phase).toBe("turnEnd");
    s = reduce(s, { type: "endTurn" }, [choiceOnly]);
    expect(s.phase).toBe("handover");
  });

  it("skips the turn-end screen for non-pick cards when revealEach is off", () => {
    const choiceOnly: Pack = { ...pack, questions: pack.questions.filter((q) => q.type === "choice") };
    let s = newGame({
      players: ["A", "B"],
      settings: { ...DEFAULT_SETTINGS, mode: "mix", packIds: ["test"], revealEach: false },
      packs: [choiceOnly],
      seen: new Set(),
      seed: 1,
    })!;
    s = reduce(s, { type: "continue" }, [choiceOnly]);
    s = reduce(s, { type: "submitChoice", option: 0 }, [choiceOnly]);
    expect(s.phase).toBe("handover");
    s = reduce(s, { type: "continue" }, [choiceOnly]);
    s = reduce(s, { type: "submitChoice", option: 1 }, [choiceOnly]);
    expect(s.phase).toBe("reveal");
    expect(s.results).toHaveLength(2);
  });

  it("goes straight to the next round when playing alone with revealEach on", () => {
    let s = play(5, ["A"], { rounds: 3, revealEach: true });
    if (s.card.type !== "pick") throw new Error();
    s = reduce(s, { type: "pick", option: s.card.options.findIndex((o) => o.correct) }, [pack]);
    s = reduce(s, { type: "bank" }, [pack]);
    s = reduce(s, { type: "endTurn" }, [pack]);
    expect(s.phase).toBe("play");
    expect(s.round).toBe(2);
    expect(s.players[0].score).toBe(1);
  });

  it("returns null when nothing matches", () => {
    expect(newGame({ players: ["A"], settings: { ...DEFAULT_SETTINGS, packIds: [] }, packs: [pack], seen: new Set(), seed: 1 })).toBeNull();
  });

  it("shares ranks on ties", () => {
    const r = standings([
      { name: "a", score: 5 },
      { name: "b", score: 9 },
      { name: "c", score: 5 },
    ]);
    expect(r.map((x) => [x.player.name, x.rank])).toEqual([
      ["b", 1],
      ["a", 2],
      ["c", 2],
    ]);
  });
});

describe("validator", () => {
  it("accepts the test pack", () => {
    const res = validatePack(pack);
    expect(res.errors).toEqual([]);
  });
  it("rejects options without explanation and too few options", () => {
    const res = validatePack({
      id: "x",
      title: "X",
      lang: "sk",
      questions: [{ id: "q", type: "pick", prompt: "p", source: "s", correct: ["a", "b"], wrong: [opt("c")] }],
    });
    expect(res.pack).toBeNull();
    expect(res.errors.join("\n")).toMatch(/why/);
    expect(res.errors.join("\n")).toMatch(/10 možností/);
  });
  it("warns about stale asOf", () => {
    const res = validatePack(
      { ...pack, questions: [{ ...pack.questions[3], asOf: "2019" }] },
      new Date("2026-11-13"),
    );
    expect(res.warnings.length).toBe(1);
  });
});
