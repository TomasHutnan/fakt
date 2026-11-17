import type { Pack } from "../content/types.ts";
import type { ClientAction, RoomSettings, RoomView } from "../engine/room.ts";

// Wire protocol between a device and the room server: JSON text frames.
// Bump PROTOCOL on any incompatible change; the server refuses other versions,
// and an offline PWA may still run old code for a while.

export const PROTOCOL = 1;
export const WS_PATH = "/ws";

/** Room codes: 4 consonants, no vowels (no accidental words), no look-alikes. */
export const CODE_ALPHABET = "BCDFGHJKLMNPRSTVXZ";
export const CODE_LENGTH = 4;

export type ClientMessage =
  | { t: "create"; v: number; name: string; settings: RoomSettings; packs: Pack[]; seen: string[] }
  /** Rejoin with a seat token, or take a new seat with a name. */
  | { t: "join"; v: number; code: string; token?: string; name?: string }
  /** Big screen: a read-only view without a seat. */
  | { t: "watch"; v: number; code: string }
  | { t: "act"; action: ClientAction }
  | { t: "ping" };

export type ErrorCode =
  | "proto" // client and server versions differ: reload
  | "invalid" // malformed message
  | "noRoom"
  | "full"
  | "nameTaken"
  | "badName"
  | "needName" // the token is unknown: ask for a name
  | "noQuestions"
  | "badPacks"
  | "busy" // rate limit or server capacity
  | "kicked"
  | "expired"; // the room reached its time limit

export type ServerMessage =
  | { t: "seat"; code: string; id: string | null; token: string | null }
  | { t: "view"; view: RoomView; now: number }
  | { t: "error"; error: ErrorCode }
  | { t: "pong"; now: number };

export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, "").slice(0, CODE_LENGTH);
}

export function isCode(code: string): boolean {
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c));
}
