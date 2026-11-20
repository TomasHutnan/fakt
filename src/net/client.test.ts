import { describe, expect, it } from "vitest";
import { seatIsDead } from "./client.ts";

describe("seatIsDead", () => {
  it("is true when the room is gone or the seat cannot be rejoined", () => {
    for (const e of ["noRoom", "kicked", "expired", "needName"] as const) expect(seatIsDead(e)).toBe(true);
  });
  it("is false for errors that leave the seat usable", () => {
    for (const e of [null, "busy", "invalid", "proto"] as const) expect(seatIsDead(e)).toBe(false);
  });
});
