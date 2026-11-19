import { describe, expect, it } from "vitest";
import type { ChoiceCard, NumberCard, OrderCard, PickCard } from "./cards.ts";
import { roundRecord, socialLines, titles, type RoundRecord, type Scored } from "./social.ts";

const base = { key: "t/q", packId: "t", packTitle: "T", prompt: "?", difficulty: 1, source: "s" };
const choice: ChoiceCard = {
  ...base,
  type: "choice",
  options: [
    { text: "Spišský hrad", why: "", correct: true },
    { text: "Oravský hrad", why: "", correct: false },
    { text: "Bojnice", why: "", correct: false },
    { text: "Trenčín", why: "", correct: false },
  ],
};
const pick: PickCard = {
  ...base,
  type: "pick",
  correctCount: 5,
  options: "abcdefghij".split("").map((t, i) => ({ text: t, why: "", correct: i < 5 })),
};
const number: NumberCard = { ...base, type: "number", answer: 100, scale: "log", tolerance: 0.1, why: "" };
const order: OrderCard = {
  ...base,
  type: "order",
  direction: "desc",
  items: [4, 3, 2, 1].map((v) => ({ text: String(v), value: v, label: String(v) })),
  solution: [0, 1, 2, 3],
};

const ch = (player: number, option: number): Scored => ({ player, answer: { type: "choice", option }, points: 0 });
const pk = (player: number, picks: number[], status: "banked" | "busted" | "complete"): Scored => ({ player, answer: { type: "pick", picks, status }, points: 0 });
const nm = (player: number, value: number): Scored => ({ player, answer: { type: "number", value }, points: 0 });
const kinds = (lines: { kind: string }[]) => lines.map((l) => l.kind);

describe("social lines", () => {
  it("needs two answers", () => {
    expect(socialLines(choice, [ch(0, 0)])).toEqual([]);
  });

  it("only Dano picked Trenčín", () => {
    const lines = socialLines(choice, [ch(0, 0), ch(1, 0), ch(2, 0), ch(3, 3)]);
    expect(lines[0]).toEqual({ kind: "lonelyWrong", player: 3, option: "Trenčín" });
  });

  it("everyone right, nobody right, only one right", () => {
    expect(kinds(socialLines(choice, [ch(0, 0), ch(1, 0)]))).toContain("allRight");
    expect(kinds(socialLines(choice, [ch(0, 1), ch(1, 2)]))).toContain("nobodyRight");
    const only = socialLines(choice, [ch(0, 0), ch(1, 1), ch(2, 2), ch(3, 3)]);
    expect(only).toContainEqual({ kind: "onlyRight", players: [0] });
  });

  it("a trap: several fell for the same wrong option", () => {
    const lines = socialLines(choice, [ch(0, 1), ch(1, 1), ch(2, 1), ch(3, 0)]);
    expect(lines[0]).toEqual({ kind: "trap", players: [0, 1, 2], option: "Oravský hrad" });
  });

  it("pick cards: complete, big bust, untouched", () => {
    const lines = socialLines(pick, [pk(0, [0, 1, 2, 3, 4], "complete"), pk(1, [0, 1, 2, 5], "busted"), pk(2, [0], "banked")], 3);
    expect(lines).toContainEqual({ kind: "complete", players: [0] });
    expect(lines).toContainEqual({ kind: "bigBust", player: 1, lost: 6 });
  });

  it("pick cards: a wrong option two players fell for", () => {
    const lines = socialLines(pick, [pk(0, [9], "busted"), pk(1, [9], "busted"), pk(2, [0], "banked")]);
    expect(lines).toContainEqual({ kind: "trap", players: [0, 1], option: "j" });
  });

  it("number cards: exact hits beat the closest", () => {
    expect(socialLines(number, [nm(0, 100), nm(1, 300)])[0]).toEqual({ kind: "exact", players: [0] });
    // Within tolerance but not the answer: never called exact.
    expect(socialLines(number, [nm(0, 101), nm(1, 300)])[0]).toEqual({ kind: "near", players: [0] });
    expect(socialLines(number, [nm(0, 150), nm(1, 300)])[0]).toEqual({ kind: "closest", player: 0 });
    // A tie for closest is not news.
    expect(socialLines(number, [nm(0, 200), nm(1, 50)])).toEqual([]);
  });

  it("tie-break: only the closest guess is named, and nobody is called exact unless they were", () => {
    // Both within tolerance, one closer: only the closer one.
    expect(socialLines(number, [nm(0, 101), nm(1, 104)], 2, true)).toEqual([{ kind: "near", players: [0] }]);
    // Neither within tolerance, one closer.
    expect(socialLines(number, [nm(0, 150), nm(1, 300)], 2, true)).toEqual([{ kind: "closest", player: 0 }]);
    // One exact hit.
    expect(socialLines(number, [nm(0, 100), nm(1, 101)], 2, true)).toEqual([{ kind: "exact", players: [0] }]);
    // Both exact: shared.
    expect(socialLines(number, [nm(0, 100), nm(1, 100)], 2, true)).toEqual([{ kind: "exact", players: [0, 1] }]);
    // Equal distance, not exact: a shared win, nobody singled out.
    expect(socialLines(number, [nm(0, 200), nm(1, 50)], 2, true)).toEqual([]);
  });

  it("order cards: perfect order", () => {
    const r: Scored[] = [
      { player: 0, answer: { type: "order", arrangement: [0, 1, 2, 3] }, points: 0 },
      { player: 1, answer: { type: "order", arrangement: [1, 0, 2, 3] }, points: 0 },
    ];
    expect(socialLines(order, r)[0]).toEqual({ kind: "perfectOrder", players: [0] });
  });

  it("returns at most max lines, one per kind", () => {
    const lines = socialLines(choice, [ch(0, 1), ch(1, 1), ch(2, 2), ch(3, 2), ch(4, 0)], 5);
    expect(new Set(kinds(lines)).size).toBe(lines.length);
    expect(socialLines(choice, [ch(0, 1), ch(1, 1), ch(2, 2), ch(3, 2)], 1)).toHaveLength(1);
  });
});

describe("titles", () => {
  const rec = (type: RoundRecord["type"], results: RoundRecord["results"]): RoundRecord => ({ type, results });

  it("gives feats to the players who did them, one title each", () => {
    const history = [
      rec("pick", [
        { player: 0, points: 15, status: "complete", found: 5 },
        { player: 1, points: 0, status: "busted", found: 4 },
        { player: 2, points: 1, status: "banked", found: 1 },
      ]),
      rec("number", [
        { player: 0, points: 7, hit: false },
        { player: 1, points: 0, hit: false },
        { player: 2, points: 7, hit: true },
      ]),
    ];
    const t = titles(history, [22, 0, 8]);
    expect(t).toContainEqual({ player: 1, id: "smoliar", value: 9 });
    expect(t).toContainEqual({ player: 0, id: "vseved", value: 1 });
    expect(t).toContainEqual({ player: 2, id: "ostrostrelec", value: 1 });
    expect(new Set(t.map((x) => x.player)).size).toBe(t.length);
    expect(new Set(t.map((x) => x.id)).size).toBe(t.length);
  });

  it("the last player gets a consolation title when nothing else fits", () => {
    const history = [rec("choice", [
      { player: 0, points: 4, hit: true },
      { player: 1, points: 0, hit: false },
    ])];
    expect(titles(history, [4, 0])).toContainEqual({ player: 1, id: "moralny", value: 0 });
  });

  it("no titles alone, without history, or for a draw at the bottom only", () => {
    expect(titles([], [1, 2])).toEqual([]);
    expect(titles([rec("choice", [{ player: 0, points: 0, hit: false }])], [0])).toEqual([]);
    expect(titles([rec("choice", [{ player: 0, points: 0, hit: false }, { player: 1, points: 0, hit: false }])], [0, 0])).toEqual([]);
  });

  it("roundRecord summarises a card for the titles", () => {
    expect(roundRecord(pick, [pk(0, [0, 1, 7], "busted")]).results[0]).toEqual({ player: 0, points: 0, status: "busted", found: 2 });
    expect(roundRecord(number, [nm(0, 100)]).results[0].hit).toBe(true);
    expect(roundRecord(choice, [ch(0, 2)]).results[0].hit).toBe(false);
  });

  it("titles: a player who misses every number card is not flawless; ties for last still get the consolation title", () => {
    const rec = (hits: boolean[]): RoundRecord => ({ type: "number", results: hits.map((hit, player) => ({ player, points: hit ? 1 : 0, hit })) });
    const t = titles([rec([false, true]), rec([false, true]), rec([false, true])], [0, 3]);
    expect(t.find((x) => x.id === "neomylny")?.player).not.toBe(0);
    const three = titles([rec([true, false, false])], [3, 0, 0]);
    expect(three.map((x) => x.id)).toContain("moralny");
  });

  it("a tie-break loser within tolerance does not get a number hit", () => {
    const r = roundRecord(number, [{ player: 0, answer: { type: "number", value: 101 }, points: 1 }, { player: 1, answer: { type: "number", value: 104 }, points: 0 }], true);
    expect(r.results.map((x) => x.hit)).toEqual([true, false]);
  });

  it("Opatrník counts auto-banked turns and turns with nothing picked", () => {
    const pickRound = (found: number[]): RoundRecord => ({ type: "pick", results: found.map((f, player) => ({ player, points: f, status: "banked" as const, found: f, late: true })) });
    const t = titles([pickRound([0, 5]), pickRound([1, 5])], [1, 10]);
    expect(t).toContainEqual({ player: 0, id: "opatrnik", value: 2 });
  });

  it("Do poslednej sekundy: mostly taken at the deadline, never on one phone", () => {
    const r = (late0: boolean, late1: boolean): RoundRecord => ({ type: "choice", results: [{ player: 0, points: 0, hit: false, late: late0 }, { player: 1, points: 1, hit: true, late: late1 }] });
    const t = titles([r(true, false), r(true, false), r(true, true), r(false, false)], [0, 4]);
    expect(t).toContainEqual({ player: 0, id: "poslednaSekunda", value: 3 });
    // Two late of four is not "mostly"; too few is not enough either.
    expect(titles([r(true, false), r(true, false), r(false, false), r(false, false)], [0, 4]).some((x) => x.id === "poslednaSekunda")).toBe(false);
    expect(titles([r(true, false), r(true, false)], [0, 2]).some((x) => x.id === "poslednaSekunda")).toBe(false);
    expect(titles([r(false, false), r(false, false), r(false, false)], [0, 3]).some((x) => x.id === "poslednaSekunda")).toBe(false);
  });

  it("Blesk: first to hand in, at least 3 times; one title per player, ties go to the earlier player", () => {
    const r = (first: number): RoundRecord => ({ type: "number", results: [0, 1, 2].map((player) => ({ player, points: 0, hit: false, ...(player === first ? { first: true } : {}) })) });
    const t = titles([r(1), r(1), r(1), r(2)], [0, 1, 1]);
    expect(t).toContainEqual({ player: 1, id: "blesk", value: 3 });
    expect(titles([r(1), r(1), r(2), r(2)], [0, 1, 1]).some((x) => x.id === "blesk")).toBe(false);
    // Already holds a rarer title: the next best does not get a second one.
    expect(new Set(t.map((x) => x.player)).size).toBe(t.length);
  });
});
