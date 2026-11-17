import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pack } from "../content/types.ts";
import type { PickCard } from "../engine/cards.ts";
import { ANSWER_SECONDS, DEFAULT_ROOM_SETTINGS, GRACE_MS, type ClientAction, type RoomSettings, type RoomView } from "../engine/room.ts";
import { CODE_ALPHABET, PROTOCOL, type ServerMessage } from "../net/protocol.ts";
import { cleanSettings, CLOSE, Hub } from "./rooms.ts";

const opt = (text: string) => ({ text, why: `${text} why` });
export const PACK: Pack = {
  id: "t",
  title: "Test",
  lang: "sk",
  license: "CC0-1.0",
  adult: false,
  version: 1,
  questions: Array.from({ length: 8 }, (_, i) => ({
    id: `p${i}`,
    type: "pick" as const,
    prompt: `Otázka ${i}`,
    difficulty: 1 as const,
    source: "https://example.com",
    correct: ["a", "b", "c", "d", "e"].map(opt),
    wrong: ["v", "w", "x", "y", "z", "q"].map(opt),
  })),
};
const SETTINGS: RoomSettings = { ...DEFAULT_ROOM_SETTINGS, mode: "classic", rounds: 3, packIds: ["t"] };

/** A connection that records what the hub sends. */
class FakeConn {
  sent: ServerMessage[] = [];
  closed: { code: number; reason: string } | null = null;
  handlers: { message: (raw: string) => void; close: () => void };
  constructor(
    readonly hub: Hub,
    readonly ip = "1.2.3.4",
  ) {
    this.handlers = hub.connect(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code: number, reason: string) {
    this.closed = { code, reason };
    this.handlers?.close();
  }
  msg(m: unknown) {
    this.handlers.message(typeof m === "string" ? m : JSON.stringify(m));
  }
  act(action: ClientAction | Record<string, unknown>) {
    this.msg({ t: "act", action });
  }
  drop() {
    this.handlers.close();
  }
  get view(): RoomView {
    const v = [...this.sent].reverse().find((m) => m.t === "view");
    if (!v || v.t !== "view") throw new Error("no view yet");
    return v.view;
  }
  get seat() {
    const s = this.sent.find((m) => m.t === "seat");
    return s?.t === "seat" ? s : null;
  }
  get lastError() {
    const e = [...this.sent].reverse().find((m) => m.t === "error");
    return e?.t === "error" ? e.error : null;
  }
}

function create(hub: Hub, name = "Jano", settings: RoomSettings = SETTINGS, ip?: string) {
  const c = new FakeConn(hub, ip);
  c.msg({ t: "create", v: PROTOCOL, name, settings, packs: [PACK], seen: [] });
  return c;
}

function join(hub: Hub, code: string, name?: string, token?: string) {
  const c = new FakeConn(hub);
  c.msg({ t: "join", v: PROTOCOL, code, name, token });
  return c;
}

let hub: Hub;
beforeEach(() => {
  hub = new Hub();
});
afterEach(() => {
  hub.close();
  vi.useRealTimers();
});

describe("creating rooms", () => {
  it("gives the creator a seat, a secret token and a 4-letter code", () => {
    const host = create(hub);
    const seat = host.seat!;
    expect(seat.code).toMatch(new RegExp(`^[${CODE_ALPHABET}]{4}$`));
    expect(seat.id).toBeTruthy();
    expect(seat.token).toMatch(/^[0-9a-f-]{36}$/);
    expect(host.view.phase).toBe("lobby");
    expect(host.view.you).toBe(seat.id);
    expect(host.view.controller).toBe(seat.id);
    expect(hub.roomCount).toBe(1);
  });

  it("refuses bad input", () => {
    const cases: [unknown, string][] = [
      [{ t: "create", v: PROTOCOL + 1, name: "J", settings: SETTINGS, packs: [PACK], seen: [] }, "proto"],
      [{ t: "create", v: PROTOCOL, name: "J", settings: { ...SETTINGS, rounds: 0 }, packs: [PACK], seen: [] }, "invalid"],
      [{ t: "create", v: PROTOCOL, name: "J", settings: SETTINGS, packs: [{ ...PACK, questions: [] }], seen: [] }, "badPacks"],
      [{ t: "create", v: PROTOCOL, name: "J", settings: SETTINGS, packs: [], seen: [] }, "badPacks"],
      [{ t: "create", v: PROTOCOL, name: "J", settings: SETTINGS, packs: "x", seen: [] }, "badPacks"],
      [{ t: "create", v: PROTOCOL, name: "J", settings: { ...SETTINGS, difficulties: [3] }, packs: [PACK], seen: [] }, "noQuestions"],
      [{ t: "create", v: PROTOCOL, name: "  ", settings: SETTINGS, packs: [PACK], seen: [] }, "badName"],
      [{ t: "create", v: PROTOCOL, name: "J", settings: SETTINGS, packs: [PACK], seen: "x" }, "invalid"],
    ];
    for (const [i, [m, err]] of cases.entries()) {
      // Failed attempts count against the creation limit, so each case gets its own address.
      const c = new FakeConn(hub, `10.0.0.${i}`);
      c.msg(m);
      expect(c.lastError, JSON.stringify(m).slice(0, 80)).toBe(err);
      expect(c.seat).toBeNull();
    }
    expect(hub.roomCount).toBe(0);
  });

  it("ignores packs the room does not play", () => {
    const c = new FakeConn(hub);
    c.msg({ t: "create", v: PROTOCOL, name: "J", settings: SETTINGS, packs: [PACK, { ...PACK, id: "other" }, { id: 5 }], seen: [] });
    expect(c.seat).not.toBeNull();
  });

  it("closes connections that send garbage", () => {
    const c = new FakeConn(hub);
    c.msg("not json");
    expect(c.lastError).toBe("invalid");
    expect(c.closed?.code).toBe(CLOSE.invalid);
    const d = new FakeConn(hub);
    d.msg({ t: "nope" });
    expect(d.closed?.code).toBe(CLOSE.invalid);
  });

  it("limits room creation per address over time", () => {
    const h = new Hub({ roomsPerIp: 100 });
    for (let i = 0; i < h.limits.createsPerWindow; i++) expect(create(h, "J", SETTINGS, "9.9.9.9").seat).not.toBeNull();
    expect(create(h, "J", SETTINGS, "9.9.9.9").lastError).toBe("busy");
    expect(create(h, "J", SETTINGS, "8.8.8.8").seat).not.toBeNull();
    h.close();
  });

  it("limits open rooms per address; a removed room frees the slot", () => {
    const rooms = Array.from({ length: hub.limits.roomsPerIp }, () => create(hub, "J", SETTINGS, "7.7.7.7"));
    expect(rooms.every((r) => r.seat)).toBe(true);
    expect(create(hub, "J", SETTINGS, "7.7.7.7").lastError).toBe("busy");
    rooms[0].drop();
    hub.sweep(Date.now() + hub.limits.idleEmptyMs + 1);
    // All three expired (idle and empty or idle too long); a new one fits.
    expect(create(hub, "J", SETTINGS, "7.7.7.7").seat).not.toBeNull();
  });

  it("limits connections in total and per address", () => {
    const h = new Hub({ connectionsPerIp: 3, maxConnections: 5 });
    const a = [1, 2, 3].map(() => new FakeConn(h, "5.5.5.5"));
    expect(a.every((c) => !c.closed)).toBe(true);
    const extra = new FakeConn(h, "5.5.5.5");
    expect(extra.closed?.code).toBe(CLOSE.busy);
    a[0].drop();
    expect(new FakeConn(h, "5.5.5.5").closed).toBeNull();
    new FakeConn(h, "6.6.6.6");
    new FakeConn(h, "6.6.6.7");
    expect(new FakeConn(h, "6.6.6.8").closed?.code).toBe(CLOSE.busy);
    h.close();
  });

  it("stores identical packs once and enforces the memory budget", () => {
    const size = JSON.stringify(PACK).length;
    create(hub, "A", SETTINGS, "1.0.0.1");
    create(hub, "B", SETTINGS, "1.0.0.2");
    expect(hub.storedPackBytes).toBe(size);
    const other = { ...PACK, title: "Iný" };
    const tight = new Hub({ maxPackBytes: size + 10 });
    expect(create(tight, "A", SETTINGS, "1.0.0.1").seat).not.toBeNull();
    const c = new FakeConn(tight, "1.0.0.2");
    c.msg({ t: "create", v: PROTOCOL, name: "B", settings: SETTINGS, packs: [other], seen: [] });
    expect(c.lastError).toBe("busy");
    // Freed when the room goes.
    tight.sweep(Date.now() + tight.limits.idleMs + 1);
    expect(tight.storedPackBytes).toBe(0);
    tight.close();
  });

  it("limits the number of rooms", () => {
    const small = new Hub({ maxRooms: 2 });
    create(small, "A", SETTINGS, "1.1.1.1");
    create(small, "B", SETTINGS, "1.1.1.2");
    expect(create(small, "C", SETTINGS, "1.1.1.3").lastError).toBe("busy");
    small.close();
  });

  it("closes connections that flood messages", () => {
    const host = create(hub);
    for (let i = 0; i < 200 && !host.closed; i++) host.msg({ t: "ping" });
    expect(host.closed?.code).toBe(CLOSE.busy);
  });

  it("refuses oversized messages other than create", () => {
    const host = create(hub);
    host.act({ type: "kick", id: "x".repeat(20_000) });
    expect(host.closed?.code).toBe(CLOSE.invalid);
  });
});

describe("cleanSettings", () => {
  it("accepts good settings and drops duplicates", () => {
    expect(cleanSettings({ ...SETTINGS, difficulties: [1, 1, 2], packIds: ["t", "t"] })).toEqual({ ...SETTINGS, difficulties: [1, 2], packIds: ["t"] });
  });
  it("rejects anything odd", () => {
    for (const patch of [{ mode: "x" }, { rounds: 1.5 }, { target: -1 }, { wipe: "never" }, { pace: "slow" }, { difficulties: [] }, { difficulties: [4] }, { packIds: [] }, { packIds: [1] }, { showCorrectCount: "yes" }]) {
      expect(cleanSettings({ ...SETTINGS, ...patch }), JSON.stringify(patch)).toBeNull();
    }
    expect(cleanSettings(null)).toBeNull();
  });
});

describe("joining", () => {
  it("joins by code with a name, in any letter case", () => {
    const host = create(hub);
    const code = host.seat!.code;
    const zuzka = join(hub, code.toLowerCase(), "Zuzka");
    expect(zuzka.seat!.id).toBeTruthy();
    expect(zuzka.view.players.map((p) => p.name)).toEqual(["Jano", "Zuzka"]);
    // Everyone sees the newcomer.
    expect(host.view.players).toHaveLength(2);
  });

  it("reports why a join failed", () => {
    const code = create(hub).seat!.code;
    expect(join(hub, "BBBB", "X").lastError).toBe("noRoom");
    expect(join(hub, "AEIO", "X").lastError).toBe("noRoom");
    expect(join(hub, code, "jano").lastError).toBe("nameTaken");
    expect(join(hub, code, " ").lastError).toBe("badName");
    expect(join(hub, code).lastError).toBe("needName");
    expect(join(hub, code, undefined, "bogus-token").lastError).toBe("needName");
    const old = new FakeConn(hub);
    old.msg({ t: "join", v: 0, code, name: "X" });
    expect(old.lastError).toBe("proto");
  });

  it("a returning player gets their seat back with the token, even with another name", () => {
    const host = create(hub);
    const code = host.seat!.code;
    const z1 = join(hub, code, "Zuzka");
    const { id, token } = z1.seat!;
    z1.drop();
    expect(host.view.players.find((p) => p.id === id)!.connected).toBe(false);
    const z2 = join(hub, code, "Iná", token!);
    expect(z2.seat!.id).toBe(id);
    expect(z2.seat!.token).toBe(token);
    expect(host.view.players.find((p) => p.id === id)).toMatchObject({ name: "Zuzka", connected: true });
    expect(host.view.players).toHaveLength(2);
  });

  it("a seat open on two devices stays connected until both are gone", () => {
    const host = create(hub);
    const code = host.seat!.code;
    const a = join(hub, code, "Zuzka");
    const b = join(hub, code, undefined, a.seat!.token!);
    a.drop();
    expect(host.view.players[1].connected).toBe(true);
    b.drop();
    expect(host.view.players[1].connected).toBe(false);
  });

  it("the room is full at 12 players", () => {
    const code = create(hub).seat!.code;
    for (let i = 1; i < 12; i++) expect(join(hub, code, `P${i}`).seat).not.toBeNull();
    expect(join(hub, code, "P12").lastError).toBe("full");
  });

  it("a connection cannot sit in two rooms", () => {
    const host = create(hub);
    host.msg({ t: "join", v: PROTOCOL, code: host.seat!.code, name: "Again" });
    expect(host.lastError).toBe("invalid");
  });
});

describe("big screen", () => {
  it("watches without a seat and never sees private answers", () => {
    const host = create(hub);
    const code = host.seat!.code;
    const tv = new FakeConn(hub);
    tv.msg({ t: "watch", v: PROTOCOL, code });
    expect(tv.seat).toEqual({ t: "seat", code, id: null, token: null });
    expect(tv.view.you).toBeNull();
    expect(tv.view.players).toHaveLength(1);
    join(hub, code, "Zuzka"); // keeps the question open whatever the host picks
    host.act({ type: "start" });
    host.act({ type: "pick", option: 0 });
    expect(tv.view.phase).toBe("question");
    expect(tv.view.mine).toBeNull();
    expect(JSON.stringify(tv.sent)).not.toContain('"correct"');
    // A watcher cannot act.
    tv.act({ type: "close" });
    expect(tv.lastError).toBe("invalid");
  });

  it("limits screens per room", () => {
    const code = create(hub).seat!.code;
    for (let i = 0; i < hub.limits.maxWatchers; i++) {
      const tv = new FakeConn(hub);
      tv.msg({ t: "watch", v: PROTOCOL, code });
      expect(tv.lastError).toBeNull();
    }
    const extra = new FakeConn(hub);
    extra.msg({ t: "watch", v: PROTOCOL, code });
    expect(extra.lastError).toBe("full");
  });
});

describe("playing through the hub", () => {
  function room(n: number, settings: RoomSettings = SETTINGS) {
    const host = create(hub, "Jano", settings);
    const code = host.seat!.code;
    const others = Array.from({ length: n - 1 }, (_, i) => join(hub, code, `Hráč ${i + 1}`));
    return { host, code, all: [host, ...others] };
  }

  it("plays a full game with four phones", () => {
    const { host, code, all } = room(4);
    host.act({ type: "start" });
    let rounds = 0;
    while (host.view.phase !== "over") {
      expect(host.view.phase).toBe("question");
      rounds++;
      const card = hub.room(code)!.card as PickCard;
      const right = card.options.map((o, i) => (o.correct ? i : -1)).filter((i) => i >= 0);
      all.forEach((c, k) => {
        // Player k picks k right options then banks; player 3 busts.
        if (k === 3) return c.act({ type: "pick", option: card.options.findIndex((o) => !o.correct) });
        for (const i of right.slice(0, k + 1)) c.act({ type: "pick", option: i });
        if (c.view.phase === "question") c.act({ type: "bank" });
      });
      expect(host.view.phase).toBe("reveal");
      expect(host.view.full).not.toBeNull();
      expect(host.view.results.map((r) => r.points)).toEqual([1, 3, 6, 0]);
      all.forEach((c) => c.act({ type: "ready" }));
    }
    expect(rounds).toBe(3);
    expect(host.view.players.map((p) => p.score)).toEqual([3, 9, 18, 0]);
    // Again: back to the lobby.
    all[1].act({ type: "again" });
    expect(host.view.phase).toBe("over");
    host.act({ type: "again" });
    expect(all[2].view.phase).toBe("lobby");
    expect(all[2].view.players.every((p) => p.score === 0)).toBe(true);
  });

  it("refuses actions only the server may take, and survives junk actions", () => {
    const { host, code, all } = room(3);
    const zuzka = all[1];
    const miroId = all[2].seat!.id!;
    zuzka.act({ type: "join", id: "fake", name: "Fake" });
    zuzka.act({ type: "connect", id: miroId, connected: false });
    zuzka.act({ type: "tick", now: 1e15 });
    zuzka.act({ type: "explode" });
    zuzka.act({ type: "__proto__" });
    expect(hub.room(code)!.players.map((p) => p.name)).toEqual(["Jano", "Hráč 1", "Hráč 2"]);
    expect(hub.room(code)!.players.every((p) => p.connected)).toBe(true);
    // Junk values in valid actions change nothing and never throw.
    host.act({ type: "start" });
    for (const a of [
      { type: "pick", option: "x" },
      { type: "pick", option: null },
      { type: "pick", option: { length: 1 } },
      { type: "submitOrder", arrangement: "abc" },
      { type: "submitOrder", arrangement: { length: 4 } },
      { type: "submitNumber", value: "5" },
      { type: "submitChoice", option: 1.5 },
      { type: "kick", id: { toString: 1 } },
      { type: "kick", id: null },
    ]) {
      expect(() => zuzka.act(a)).not.toThrow();
    }
    expect(hub.room(code)!.answers).toEqual({});
    expect(host.view.phase).toBe("question");
  });

  it("ignores a spoofed sender, time or seed", () => {
    const { host, all } = room(2);
    const zuzka = all[1];
    zuzka.act({ type: "start", by: host.seat!.id, now: 0, seed: 1 });
    expect(host.view.phase).toBe("lobby");
  });

  it("only sends a view when it changed", () => {
    const { host, all } = room(2);
    host.act({ type: "start" });
    const before = all[1].sent.length;
    host.act({ type: "start" }); // no-op
    host.act({ type: "pick", option: 99 }); // no-op
    expect(all[1].sent.length).toBe(before);
  });

  it("closes the question at the deadline", () => {
    vi.useFakeTimers();
    const { host, all } = room(3, { ...SETTINGS, pace: "fast" });
    host.act({ type: "start" });
    const deadline = host.view.deadline!;
    expect(deadline - Date.now()).toBe(ANSWER_SECONDS.fast.pick * 1000);
    all[1].act({ type: "pick", option: 0 });
    vi.advanceTimersByTime(ANSWER_SECONDS.fast.pick * 1000 + GRACE_MS - 10);
    expect(host.view.phase).toBe("question");
    vi.advanceTimersByTime(50);
    expect(host.view.phase).toBe("reveal");
  });

  it("kicks: the player is told, disconnected and cannot come back with the token", () => {
    const { host, code, all } = room(3);
    const miro = all[2];
    const token = miro.seat!.token!;
    host.act({ type: "kick", id: miro.seat!.id! });
    expect(miro.lastError).toBe("kicked");
    expect(miro.closed?.code).toBe(CLOSE.kicked);
    expect(host.view.players).toHaveLength(2);
    expect(join(hub, code, undefined, token).lastError).toBe("needName");
  });

  it("the next player takes control when the host drops", () => {
    const { host, all } = room(3);
    host.drop();
    expect(all[1].view.controller).toBe(all[1].seat!.id);
    all[1].act({ type: "start" });
    expect(all[2].view.phase).toBe("question");
  });

  it("each phone sees only its own picks during the question", () => {
    const { host, code, all } = room(2);
    host.act({ type: "start" });
    const card = hub.room(code)!.card as PickCard;
    const right = card.options.findIndex((o) => o.correct);
    host.act({ type: "pick", option: right });
    expect(host.view.mine).toMatchObject({ type: "pick", points: 1 });
    expect(all[1].view.mine).toBeNull();
    const zuzkaSaw = JSON.stringify(all[1].sent);
    expect(zuzkaSaw).not.toContain('"correct"');
    expect(zuzkaSaw).not.toContain(card.options[right].why);
    expect(all[1].view.players[0].pick).toEqual({ status: "playing", found: 1 });
  });
});

describe("housekeeping", () => {
  it("removes rooms nobody uses", () => {
    const host = create(hub);
    const now = Date.now();
    hub.sweep(now + hub.limits.idleEmptyMs + 1);
    expect(hub.roomCount).toBe(1); // still connected
    host.drop();
    hub.sweep(now + hub.limits.idleEmptyMs - 1000);
    expect(hub.roomCount).toBe(1);
    hub.sweep(now + hub.limits.idleEmptyMs + 1000);
    expect(hub.roomCount).toBe(0);
  });

  it("removes rooms idle for hours even with someone connected", () => {
    const host = create(hub);
    hub.sweep(Date.now() + hub.limits.idleMs + 1);
    expect(hub.roomCount).toBe(0);
    expect(host.closed?.code).toBe(CLOSE.shutdown);
  });

  it("ends a game after its time limit, telling everyone; a new game restarts the clock", () => {
    vi.useFakeTimers();
    const h = new Hub({ roomTtlMs: 60 * 60 * 1000 });
    const host = create(h, "Jano", { ...SETTINGS, rounds: 1 });
    const code = host.seat!.code;
    host.act({ type: "start" });
    host.act({ type: "close" });
    host.act({ type: "next" });
    expect(host.view.phase).toBe("over");
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(10 * 60 * 1000);
      host.msg({ t: "ping" });
    }
    host.act({ type: "again" });
    vi.advanceTimersByTime(15 * 60 * 1000);
    host.msg({ t: "ping" });
    h.sweep();
    expect(h.room(code)).toBeDefined();
    // Keep it active, but past the hour since the new game.
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(9 * 60 * 1000);
      host.msg({ t: "ping" });
    }
    h.sweep();
    expect(h.room(code)).toBeUndefined();
    expect(host.lastError).toBe("expired");
    expect(host.closed?.code).toBe(CLOSE.shutdown);
    h.close();
  });

  it("carries a game over a restart", () => {
    const host = create(hub, "Jano", { ...SETTINGS, pace: "fast" });
    const code = host.seat!.code;
    const zuzka = join(hub, code, "Zuzka");
    host.act({ type: "start" });
    host.act({ type: "pick", option: 0 });
    const snap = JSON.parse(JSON.stringify(hub.snapshot()));
    hub.close();
    expect(host.closed?.code).toBe(CLOSE.shutdown);

    hub = new Hub({}, snap);
    expect(hub.room(code)!.players.every((p) => !p.connected)).toBe(true);
    expect(hub.room(code)!.deadline! - Date.now()).toBeGreaterThanOrEqual(14_000);
    const back = join(hub, code, undefined, zuzka.seat!.token!);
    expect(back.seat!.id).toBe(zuzka.seat!.id);
    expect(back.view.phase).toBe("question");
    expect(back.view.players.find((p) => p.name === "Jano")!.pick?.found).toBeGreaterThanOrEqual(0);
    const hostBack = join(hub, code, undefined, host.seat!.token!);
    expect(hostBack.view.controller).toBe(host.seat!.id);
  });
});

describe("snapshots from disk", () => {
  it("skips broken rooms instead of failing to start", () => {
    const good = create(hub);
    const snap = JSON.parse(JSON.stringify(hub.snapshot()));
    snap.rooms.push({ state: { code: "BBBB", players: "x" }, packs: [], tokens: [] }, null, { state: null }, { state: { code: "CCCC", players: [] }, packs: 5, tokens: [] });
    const h = new Hub({}, snap);
    expect(h.roomCount).toBe(1);
    expect(h.room(good.seat!.code)).toBeDefined();
    expect(() => new Hub({}, { savedAt: 0, rooms: "nope" } as never)).not.toThrow();
    h.close();
  });
});
