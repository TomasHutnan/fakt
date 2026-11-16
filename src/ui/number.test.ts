import { describe, expect, it } from "vitest";
import { parseNumber } from "./number.ts";

describe("parseNumber", () => {
  it("accepts a decimal comma or point", () => {
    expect(parseNumber("9,58")).toBe(9.58);
    expect(parseNumber("9.58")).toBe(9.58);
    expect(parseNumber(",5")).toBe(0.5);
    expect(parseNumber("-3,5")).toBe(-3.5);
    expect(parseNumber("42")).toBe(42);
  });
  it("accepts spaces and grouping as thousands separators", () => {
    expect(parseNumber("7 400 000", 0)).toBe(7400000);
    expect(parseNumber("7 400 000", 0)).toBe(7400000);
    expect(parseNumber("1.234.567", 0)).toBe(1234567);
    expect(parseNumber("1,234,567", 0)).toBe(1234567);
    expect(parseNumber("1.234,5")).toBe(1234.5);
    expect(parseNumber("1,234.5")).toBe(1234.5);
    expect(parseNumber("0.400.000", 0)).toBeNaN();
  });
  it("reads one separator plus three digits as thousands on whole-number questions", () => {
    expect(parseNumber("1.400", 0)).toBe(1400);
    expect(parseNumber("1,400", 0)).toBe(1400);
    expect(parseNumber("0.400", 0)).toBe(0.4);
    expect(parseNumber("1,5", 0)).toBe(1.5);
    expect(parseNumber("1.400", 2)).toBe(1.4);
  });
  it("rejects anything that is not a plain number", () => {
    for (const bad of ["", "-", ".", "abc", "12 km", "1e5", "1.2.3", "1,23,456", "1.234,5,6", "--1", "1-2", "€5"]) {
      expect(parseNumber(bad, 0), bad).toBeNaN();
    }
  });
});
