import { expect, it } from "vitest";
import { tie } from "./typo.ts";

it("glues one-letter prepositions to the next word", () => {
  expect(tie("Ryby v slovenských riekach a v potokoch")).toBe("Ryby v slovenských riekach a v potokoch");
  expect(tie("Vodka a pivo")).toBe("Vodka a pivo");
  expect(tie("Kto?")).toBe("Kto?");
});
