import { describe, expect, it } from "vitest";
import { onByDefault, type Pack } from "../content/types.ts";
import { validatePack } from "../content/validate.ts";
import { makeCard, numberDecimals, makeCompareCard, type NumberCard, type PickCard } from "./cards.ts";
import { currentPlayer, DEFAULT_SETTINGS, multiplier, newGame, reduce, scoreCard, standings, type GameState, type Settings } from "./game.ts";
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

describe("which is more", () => {
  const order = pack.questions[2] as Extract<(typeof pack.questions)[number], { type: "order" }>;
  it("marks the item that comes first in the order as correct", () => {
    for (let seed = 0; seed < 100; seed++) {
      const card = makeCompareCard(pack, order, createRng(seed))!;
      expect(card.type).toBe("choice");
      expect(card.compare).toBe("desc");
      expect(card.options).toHaveLength(2);
      const value = (t: string) => order.items.find((i) => i.text === t)!.value;
      const [a, b] = card.options;
      expect(a.correct).toBe(value(a.text) > value(b.text));
      expect(b.correct).toBe(!a.correct);
    }
  });
  it("is worth fewer points than a four-option choice", () => {
    const card = makeCompareCard(pack, order, createRng(1))!;
    const right = card.options.findIndex((o) => o.correct);
    const r = (option: number) => ({ player: 0, points: 0, answer: { type: "choice" as const, option } });
    expect(scoreCard(card, [r(right), r(1 - right)], "always", 2)).toEqual([2, 0]);
  });
  it("deals some order questions as compare cards in mix mode, the same way on resume", () => {
    const orderOnly: Pack = { ...pack, questions: [order] };
    let compare = 0;
    for (let seed = 0; seed < 60; seed++) {
      const s = newGame({ players: ["A"], settings: { ...DEFAULT_SETTINGS, mode: "mix", packIds: ["test"] }, packs: [orderOnly], seen: new Set(), seed })!;
      const again = newGame({ players: ["A"], settings: { ...DEFAULT_SETTINGS, mode: "mix", packIds: ["test"] }, packs: [orderOnly], seen: new Set(), seed })!;
      expect(again.card).toEqual(s.card);
      if (s.card.type === "choice") compare++;
    }
    expect(compare).toBeGreaterThan(10);
    expect(compare).toBeLessThan(50);
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
  it("always gives the closest guess points, even when far off", () => {
    expect(numberRankedPoints(card, [999999, 9999999])).toEqual([5, 0]);
    expect(numberRankedPoints(card, [999999, 999999, 9999999])).toEqual([5, 5, 0]);
    expect(numberRankedPoints(card, [NaN, NaN])).toEqual([0, 0]);
  });
});

describe("number precision", () => {
  it("asks for decimals only when the tolerance is below one unit", () => {
    expect(numberDecimals({ answer: 1998, scale: "linear", tolerance: 2 })).toBe(0);
    expect(numberDecimals({ answer: 13.1, scale: "linear", tolerance: 1 })).toBe(0);
    expect(numberDecimals({ answer: 42.195, scale: "linear", tolerance: 0.5 })).toBe(1);
    expect(numberDecimals({ answer: 9.58, scale: "linear", tolerance: 0.05 })).toBe(2);
    expect(numberDecimals({ answer: 10, scale: "linear", tolerance: 0.1 })).toBe(1);
    expect(numberDecimals({ answer: 30.126, scale: "log", tolerance: 0.05 })).toBe(0);
    expect(numberDecimals({ answer: 2.5, scale: "log", tolerance: 0.1 })).toBe(1);
  });
});

function play(seed = 42, players = ["Ana", "Bo"], settings = {}) {
  const s = newGame({
    players,
    settings: { ...DEFAULT_SETTINGS, mode: "classic" as const, packIds: ["test"], ...settings },
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
  it("accepts known content warnings and rejects unknown ones", () => {
    expect(validatePack({ ...pack, adult: true, warnings: ["vulgar", "racism"] }).pack?.warnings).toEqual(["vulgar", "racism"]);
    expect(validatePack({ ...pack, defaultOn: false, warnings: ["gross"] }).pack?.warnings).toEqual(["gross"]);
    expect(validatePack({ ...pack, adult: true, warnings: ["gore"] }).pack).toBeNull();
    expect(validatePack(pack).pack?.warnings).toBeUndefined();
  });
  it("keeps packs with warnings off by default: 18+ or defaultOn false", () => {
    const implicit = validatePack({ ...pack, warnings: ["vulgar"] });
    expect(implicit.pack?.defaultOn).toBe(false);
    expect(implicit.warnings.join()).toMatch(/predvolene vypnutý/);
    expect(validatePack({ ...pack, warnings: ["vulgar"], defaultOn: true }).pack).toBeNull();
    const optIn = validatePack({ ...pack, defaultOn: false, warnings: ["vulgar"] }).pack!;
    expect(optIn.defaultOn).toBe(false);
    expect(onByDefault(optIn)).toBe(false);
    expect(onByDefault(validatePack(pack).pack!)).toBe(true);
    expect(onByDefault(validatePack({ ...pack, adult: true }).pack!)).toBe(false);
    expect(validatePack({ ...pack, adult: true, defaultOn: true }).pack).toBeNull();
  });

  it("warns about stale asOf", () => {
    const res = validatePack(
      { ...pack, questions: [{ ...pack.questions[3], asOf: "2019" }] },
      new Date("2026-11-13"),
    );
    expect(res.warnings.length).toBe(1);
  });
});

describe("interleave", () => {
  // The simple quadratic version it replaces.
  const slow = (entries: { pack: { id: string } }[]) => {
    const out: typeof entries = [];
    const rest = entries.slice();
    while (rest.length) {
      const last = out[out.length - 1]?.pack.id;
      const i = rest.findIndex((e) => e.pack.id !== last);
      out.push(...rest.splice(i === -1 ? 0 : i, 1));
    }
    return out;
  };
  it("matches the simple version and stays fast on one pack", async () => {
    const { interleave } = await import("./cards.ts");
    for (let t = 0; t < 300; t++) {
      const n = (t * 7) % 40;
      const entries = Array.from({ length: n }, (_, i) => ({ pack: { id: "abc"[(i * 31 + t * 17 + ((i * t) % 5)) % (1 + (t % 3))] }, i }));
      expect(interleave(entries as never)).toEqual(slow(entries));
    }
    const one = Array.from({ length: 50_000 }, (_, i) => ({ pack: { id: "a" }, i }));
    const t0 = performance.now();
    expect(interleave(one as never)).toHaveLength(50_000);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe("comeback rules on one phone", () => {
  const other: Pack = { ...pack, id: "other", title: "Other" };
  const both = [pack, other];
  const start = (players: string[], settings: Partial<Settings>, packs = both) =>
    newGame({ players, settings: { ...DEFAULT_SETTINGS, mode: "classic", packIds: packs.map((p) => p.id), ...settings }, packs, seen: new Set(), seed: 5 })!;
  /** Plays one round: player `best` finds one right option and banks, the others bust. */
  const round = (s: GameState, best: number, packs = both): GameState => {
    for (let t = 0; t < s.players.length; t++) {
      s = reduce(s, { type: "continue" }, packs);
      const card = s.card as PickCard;
      const p = currentPlayer(s);
      if (p === best) {
        s = reduce(s, { type: "pick", option: card.options.findIndex((o) => o.correct) }, packs);
        s = reduce(s, { type: "bank" }, packs);
      } else s = reduce(s, { type: "pick", option: card.options.findIndex((o) => !o.correct) }, packs);
      s = reduce(s, { type: "endTurn" }, packs);
    }
    return s;
  };

  it("the last round counts double", () => {
    let s = start(["Ana", "Bo"], { rounds: 2, lastPicks: false });
    expect(multiplier(s)).toBe(1);
    s = round(s, 0);
    expect(s.players[0].score).toBe(1);
    s = reduce(s, { type: "nextRound" }, both);
    expect(multiplier(s)).toBe(2);
    s = round(s, 0);
    expect(s.players[0].score).toBe(3);
    expect(multiplier(start(["Ana"], { rounds: 1, target: 20 }))).toBe(1);
    expect(multiplier(start(["Ana"], { rounds: 1, doubleFinal: false }))).toBe(1);
  });

  it("every third round the last player picks the pack", () => {
    let s = start(["Ana", "Bo", "Cyril"], { rounds: 6, doubleFinal: false });
    for (let r = 0; r < 2; r++) {
      s = round(s, 0);
      s = reduce(s, { type: "nextRound" }, both);
    }
    expect(s.round).toBe(3);
    expect(s.phase).toBe("choosePack");
    expect([1, 2]).toContain(s.packChoice!.player);
    expect(s.packChoice!.options.slice().sort()).toEqual(["other", "test"]);
    // Other actions wait for the choice; unknown packs are ignored.
    expect(reduce(s, { type: "continue" }, both)).toBe(s);
    expect(reduce(s, { type: "choosePack", packId: "nope" }, both)).toBe(s);
    const chooser = s.packChoice!.player;
    s = reduce(s, { type: "choosePack", packId: "other" }, both);
    expect(s.phase).toBe("handover");
    expect(s.card.packId).toBe("other");
    expect(s.pickedBy).toBe(chooser);
    expect(s.deck).toHaveLength(new Set(s.deck).size);
    s = round(s, 0);
    s = reduce(s, { type: "nextRound" }, both);
    expect(s.pickedBy).toBeNull();
  });

  it("no pack pick alone, with one pack or when switched off", () => {
    for (const s0 of [start(["Ana"], { rounds: 6 }), start(["Ana", "Bo"], { rounds: 6 }, [pack]), start(["Ana", "Bo"], { rounds: 6, lastPicks: false })]) {
      let s = s0;
      for (let r = 0; r < 3; r++) {
        expect(s.phase === "choosePack").toBe(false);
        s = round(s, 0, s0.settings.packIds.length === 1 ? [pack] : both);
        s = reduce(s, { type: "nextRound" }, s0.settings.packIds.length === 1 ? [pack] : both);
      }
    }
  });

  it("keeps a history for the titles", () => {
    let s = start(["Ana", "Bo"], { rounds: 2, lastPicks: false });
    s = round(s, 0);
    s = reduce(s, { type: "nextRound" }, both);
    s = round(s, 1);
    s = reduce(s, { type: "nextRound" }, both);
    expect(s.phase).toBe("over");
    expect(s.history).toHaveLength(2);
    expect(s.history![0].results.map((r) => r.status)).toEqual(["banked", "busted"]);
  });
});
