import { describe, expect, it } from "vitest";
import { timerShare } from "./timer.ts";

describe("timerShare", () => {
  it("is relative to the full length, not to the first value seen", () => {
    // Reload with 10 s left of 40 s.
    expect(timerShare(110_000, 40_000, 100_000, 10)).toBe(0.25);
  });
  it("falls back to the first value seen when the full length is unknown", () => {
    expect(timerShare(110_000, null, 100_000, 20)).toBe(0.5);
    expect(timerShare(110_000, null, 100_000, null)).toBe(0);
  });
  it("stays within 0..1", () => {
    expect(timerShare(100_000, 10_000, 120_000, 5)).toBe(0);
    expect(timerShare(200_000, 10_000, 100_000, 5)).toBe(1);
  });
});
