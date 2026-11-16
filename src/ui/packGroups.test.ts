import { describe, expect, it } from "vitest";
import type { Pack } from "../content/types.ts";
import { groupPacks, searchPacks } from "./packGroups.ts";

const pack = (id: string, title: string, extra: Partial<Pack> = {}): Pack => ({
  id, title, lang: "sk", license: "CC0-1.0", adult: false, version: 1, questions: [], ...extra,
});
const packs = [
  pack("sport", "Šport", { category: "sport" }),
  pack("skola", "Školské minimum", { category: "veda", description: "Učivo zo základnej školy." }),
  pack("atl", "Atletika", { category: "sport" }),
  pack("sex", "Sex a vzťahy", { category: "tradicie", adult: true }),
  pack("mine", "Môj balíček", { category: "sport" }),
  pack("loose", "Bez kategórie"),
];

describe("pack groups", () => {
  it("puts imported first, 18+ last, topics in between, sorted by title", () => {
    const g = groupPacks(packs, ["mine"]);
    expect(g.map((x) => x.id)).toEqual(["imported", "veda", "sport", "other", "adult"]);
    expect(g.find((x) => x.id === "sport")!.packs.map((p) => p.id)).toEqual(["atl", "sport"]);
  });
  it("searches without diacritics, by every word, including the section name", () => {
    const g = groupPacks(packs, []);
    expect(searchPacks(g, "skola").map((p) => p.id)).toEqual(["skola"]);
    expect(searchPacks(g, "ZAKLADNEJ uciv").map((p) => p.id)).toEqual(["skola"]);
    expect(searchPacks(g, "šport").map((p) => p.id)).toEqual(["atl", "mine", "sport"]);
    expect(searchPacks(g, "18+").map((p) => p.id)).toEqual(["sex"]);
    expect(searchPacks(g, "škole").map((p) => p.id)).toEqual(["skola"]);
    expect(searchPacks(g, "  ")).toEqual([]);
  });
});
