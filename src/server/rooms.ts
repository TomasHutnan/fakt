import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import type { Pack } from "../content/types.ts";
import { validatePack } from "../content/validate.ts";
import {
  createRoom,
  GRACE_MS,
  joinError,
  reduceRoom,
  viewFor,
  type ClientAction,
  type Pace,
  type RoomAction,
  type RoomSettings,
  type RoomState,
} from "../engine/room.ts";
import { CODE_ALPHABET, CODE_LENGTH, isCode, normalizeCode, PROTOCOL, type ClientMessage, type ErrorCode, type ServerMessage } from "../net/protocol.ts";

// All rooms of this process. Transport-agnostic: a connection is anything that can
// send a string and close, so tests drive it without sockets.

export interface Conn {
  send(data: string): void;
  close(code: number, reason: string): void;
  /** Client address, for the room-creation limit. */
  ip: string;
}

export interface Limits {
  maxRooms: number;
  /** Rooms one address may have open at once. */
  roomsPerIp: number;
  /** Open connections in total and per address (a party on one Wi-Fi shares an address). */
  maxConnections: number;
  connectionsPerIp: number;
  /** Total size of distinct uploaded packs held in memory (identical packs are stored once). */
  maxPackBytes: number;
  /** A room ends this long after it was created or a new game started in it. */
  roomTtlMs: number;
  /** Big screens per room. */
  maxWatchers: number;
  /** Rooms one address may create per window. */
  createsPerWindow: number;
  createWindowMs: number;
  /** Messages per second per connection (token bucket, burst = 2×). */
  messagesPerSecond: number;
  /** Largest message other than `create`. */
  maxMessage: number;
  maxPacks: number;
  maxSeen: number;
  /** A room nobody is connected to is removed after this long without activity. */
  idleEmptyMs: number;
  /** Any room is removed after this long without activity. */
  idleMs: number;
}

export const DEFAULT_LIMITS: Limits = {
  maxRooms: 200,
  roomsPerIp: 3,
  maxConnections: 600,
  connectionsPerIp: 40,
  maxPackBytes: 48 * 1024 * 1024,
  roomTtlMs: 60 * 60 * 1000,
  maxWatchers: 4,
  createsPerWindow: 6,
  createWindowMs: 10 * 60 * 1000,
  messagesPerSecond: 20,
  maxMessage: 16 * 1024,
  maxPacks: 100,
  maxSeen: 10_000,
  idleEmptyMs: 10 * 60 * 1000,
  idleMs: 20 * 60 * 1000,
};

export const CLOSE = { invalid: 4400, kicked: 4403, busy: 4429, shutdown: 1001 } as const;

interface Room {
  state: RoomState;
  packs: Pack[];
  /** Seat token -> player id. Tokens are secret; player ids are public. */
  tokens: Map<string, string>;
  clients: Set<Client>;
  timer: ReturnType<typeof setTimeout> | null;
  lastActive: number;
  /** When the current game's lifetime started (creation or "again"). */
  born: number;
  /** Address that created the room. */
  ip: string;
  /** Interned pack keys, released when the room goes. */
  packKeys: string[];
}

interface Client {
  conn: Conn;
  room: Room | null;
  playerId: string | null;
  watcher: boolean;
  lastView: string;
  tokens: number;
  refilled: number;
}

export interface Snapshot {
  savedAt: number;
  rooms: { state: RoomState; packs: Pack[]; tokens: [string, string][]; lastActive: number; born?: number; ip?: string }[];
}

export class Hub {
  private rooms = new Map<string, Room>();
  private creates = new Map<string, number[]>();
  private connections = new Map<string, number>();
  private connectionCount = 0;
  /** Distinct packs by content hash, shared by all rooms that play them. */
  private packStore = new Map<string, { pack: Pack; bytes: number; refs: number }>();
  private packBytes = 0;
  private sweeper: ReturnType<typeof setInterval>;
  readonly limits: Limits;

  constructor(limits: Partial<Limits> = {}, snapshot?: Snapshot) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    if (snapshot) this.restore(snapshot);
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    this.sweeper.unref?.();
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  /** Room state for tests and diagnostics. */
  room(code: string): RoomState | undefined {
    return this.rooms.get(code)?.state;
  }

  /** Registers a connection; returns its message and close handlers. */
  connect(conn: Conn): { message: (raw: string) => void; close: () => void } {
    const perIp = this.connections.get(conn.ip) ?? 0;
    if (this.connectionCount >= this.limits.maxConnections || perIp >= this.limits.connectionsPerIp) {
      conn.send(JSON.stringify({ t: "error", error: "busy" } satisfies ServerMessage));
      conn.close(CLOSE.busy, "busy");
      return { message: () => {}, close: () => {} };
    }
    this.connectionCount++;
    this.connections.set(conn.ip, perIp + 1);
    let open = true;
    const client: Client = { conn, room: null, playerId: null, watcher: false, lastView: "", tokens: this.limits.messagesPerSecond * 2, refilled: Date.now() };
    return {
      message: (raw) => this.onMessage(client, raw),
      close: () => {
        if (!open) return;
        open = false;
        this.connectionCount--;
        const n = (this.connections.get(conn.ip) ?? 1) - 1;
        if (n > 0) this.connections.set(conn.ip, n);
        else this.connections.delete(conn.ip);
        this.onClose(client);
      },
    };
  }

  private onMessage(c: Client, raw: string): void {
    if (!this.allowMessage(c)) return c.conn.close(CLOSE.busy, "busy");
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      return this.fail(c, "invalid", true);
    }
    if (!msg || typeof msg !== "object" || typeof msg.t !== "string") return this.fail(c, "invalid", true);
    if (msg.t !== "create" && raw.length > this.limits.maxMessage) return this.fail(c, "invalid", true);
    if (c.room) c.room.lastActive = Date.now();
    switch (msg.t) {
      case "ping":
        return this.send(c, { t: "pong", now: Date.now() });
      case "create":
        return this.create(c, msg);
      case "join":
        return this.join(c, msg);
      case "watch":
        return this.watch(c, msg);
      case "act":
        return this.act(c, msg.action);
      default:
        return this.fail(c, "invalid", true);
    }
  }

  private allowMessage(c: Client): boolean {
    const now = Date.now();
    const rate = this.limits.messagesPerSecond;
    c.tokens = Math.min(rate * 2, c.tokens + ((now - c.refilled) / 1000) * rate);
    c.refilled = now;
    if (c.tokens < 1) return false;
    c.tokens -= 1;
    return true;
  }

  private create(c: Client, msg: Extract<ClientMessage, { t: "create" }>): void {
    if (msg.v !== PROTOCOL) return this.fail(c, "proto");
    if (c.room) return this.fail(c, "invalid");
    if (this.rooms.size >= this.limits.maxRooms || this.roomsOf(c.conn.ip) >= this.limits.roomsPerIp || !this.allowCreate(c.conn.ip))
      return this.fail(c, "busy");
    const settings = cleanSettings(msg.settings);
    if (!settings || typeof msg.name !== "string") return this.fail(c, "invalid");
    if (!Array.isArray(msg.seen) || msg.seen.length > this.limits.maxSeen || !msg.seen.every((k) => typeof k === "string" && k.length <= 200))
      return this.fail(c, "invalid");
    const cleaned = this.cleanPacks(msg.packs, settings.packIds);
    if (!cleaned) return this.fail(c, "badPacks");
    const hostId = newPlayerId();
    const state = createRoom({ code: this.newCode(), hostId, hostName: msg.name, settings, packs: cleaned, seen: msg.seen, seed: randomInt(2 ** 32) });
    if (!state) return this.fail(c, joinError(emptyRoom(), msg.name) ?? "noQuestions");
    const interned = this.intern(cleaned);
    if (!interned) return this.fail(c, "busy");
    const now = Date.now();
    const room: Room = {
      state,
      packs: interned.packs,
      packKeys: interned.keys,
      tokens: new Map(),
      clients: new Set(),
      timer: null,
      lastActive: now,
      born: now,
      ip: c.conn.ip,
    };
    this.rooms.set(state.code, room);
    this.seat(c, room, hostId);
  }

  private allowCreate(ip: string): boolean {
    const now = Date.now();
    const recent = (this.creates.get(ip) ?? []).filter((t) => now - t < this.limits.createWindowMs);
    if (recent.length >= this.limits.createsPerWindow) {
      this.creates.set(ip, recent);
      return false;
    }
    recent.push(now);
    this.creates.set(ip, recent);
    return true;
  }

  private roomsOf(ip: string): number {
    let n = 0;
    for (const r of this.rooms.values()) if (r.ip === ip) n++;
    return n;
  }

  /** Stores packs once per content; null when the memory budget would be exceeded. */
  private intern(packs: Pack[]): { packs: Pack[]; keys: string[] } | null {
    const items = packs.map((pack) => {
      const json = JSON.stringify(pack);
      return { pack, json, key: createHash("sha256").update(json).digest("hex") };
    });
    const added = items.filter((x, i) => !this.packStore.has(x.key) && items.findIndex((y) => y.key === x.key) === i);
    const extra = added.reduce((n, x) => n + x.json.length, 0);
    if (this.packBytes + extra > this.limits.maxPackBytes) return null;
    for (const x of items) {
      const e = this.packStore.get(x.key);
      if (e) e.refs++;
      else {
        this.packStore.set(x.key, { pack: x.pack, bytes: x.json.length, refs: 1 });
        this.packBytes += x.json.length;
      }
    }
    return { packs: items.map((x) => this.packStore.get(x.key)!.pack), keys: items.map((x) => x.key) };
  }

  private release(room: Room): void {
    for (const key of room.packKeys) {
      const e = this.packStore.get(key);
      if (!e) continue;
      if (--e.refs <= 0) {
        this.packStore.delete(key);
        this.packBytes -= e.bytes;
      }
    }
    room.packKeys = [];
  }

  /** Memory held by distinct packs, for tests and diagnostics. */
  get storedPackBytes(): number {
    return this.packBytes;
  }

  /** Only the packs the room plays, each validated like an import. */
  private cleanPacks(raw: unknown, ids: string[]): Pack[] | null {
    if (!Array.isArray(raw) || raw.length > this.limits.maxPacks) return null;
    const packs: Pack[] = [];
    for (const p of raw) {
      const id = (p as { id?: unknown } | null)?.id;
      if (typeof id !== "string" || !ids.includes(id) || packs.some((x) => x.id === id)) continue;
      const res = validatePack(p);
      if (!res.pack) return null;
      packs.push(res.pack);
    }
    return packs.length ? packs : null;
  }

  private newCode(): string {
    for (;;) {
      let code = "";
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
  }

  private join(c: Client, msg: Extract<ClientMessage, { t: "join" }>): void {
    if (msg.v !== PROTOCOL) return this.fail(c, "proto");
    if (c.room) return this.fail(c, "invalid");
    const code = normalizeCode(String(msg.code ?? ""));
    const room = isCode(code) ? this.rooms.get(code) : undefined;
    if (!room) return this.fail(c, "noRoom");
    const known = typeof msg.token === "string" ? room.tokens.get(msg.token) : undefined;
    if (known && room.state.players.some((p) => p.id === known)) return this.seat(c, room, known, msg.token);
    if (typeof msg.name !== "string") return this.fail(c, "needName");
    const err = joinError(room.state, msg.name);
    if (err) return this.fail(c, err);
    const id = newPlayerId();
    this.dispatch(room, { type: "join", id, name: msg.name });
    this.seat(c, room, id);
  }

  private watch(c: Client, msg: Extract<ClientMessage, { t: "watch" }>): void {
    if (msg.v !== PROTOCOL) return this.fail(c, "proto");
    if (c.room) return this.fail(c, "invalid");
    const code = normalizeCode(String(msg.code ?? ""));
    const room = isCode(code) ? this.rooms.get(code) : undefined;
    if (!room) return this.fail(c, "noRoom");
    if ([...room.clients].filter((x) => x.watcher).length >= this.limits.maxWatchers) return this.fail(c, "full");
    c.room = room;
    c.watcher = true;
    room.clients.add(c);
    this.send(c, { t: "seat", code: room.state.code, id: null, token: null });
    this.pushView(room, c);
  }

  private seat(c: Client, room: Room, playerId: string, token?: string): void {
    const t = token ?? randomUUID();
    room.tokens.set(t, playerId);
    c.room = room;
    c.playerId = playerId;
    room.clients.add(c);
    room.lastActive = Date.now();
    this.send(c, { t: "seat", code: room.state.code, id: playerId, token: t });
    this.dispatch(room, { type: "connect", id: playerId, connected: true });
    this.pushView(room, c);
  }

  private act(c: Client, action: ClientAction): void {
    if (!c.room || !c.playerId) return this.fail(c, "invalid");
    if (!action || typeof action !== "object" || typeof action.type !== "string") return this.fail(c, "invalid");
    // The reducer validates the rest; `by`, `now` and `seed` always come from here.
    const { by: _b, now: _n, seed: _s, ...rest } = action as ClientAction & { by?: unknown; now?: unknown; seed?: unknown };
    const seed = action.type === "start" || action.type === "again" ? randomInt(2 ** 32) : undefined;
    this.dispatch(c.room, { ...(rest as ClientAction), by: c.playerId, now: Date.now(), ...(seed != null ? { seed } : {}) } as RoomAction);
  }

  private onClose(c: Client): void {
    const room = c.room;
    if (!room) return;
    room.clients.delete(c);
    c.room = null;
    if (c.playerId && ![...room.clients].some((x) => x.playerId === c.playerId)) {
      this.dispatch(room, { type: "connect", id: c.playerId, connected: false });
    }
  }

  private dispatch(room: Room, action: RoomAction): void {
    const before = room.state;
    room.state = reduceRoom(room.state, action, room.packs);
    if (room.state === before) return;
    room.lastActive = Date.now();
    if (before.phase === "over" && room.state.phase === "lobby") room.born = room.lastActive;
    this.dropRemoved(room, before);
    this.schedule(room);
    for (const c of room.clients) this.pushView(room, c);
  }

  /** Closes connections of players who were removed (kicked). */
  private dropRemoved(room: Room, before: RoomState): void {
    const gone = before.players.filter((p) => !room.state.players.some((q) => q.id === p.id)).map((p) => p.id);
    if (!gone.length) return;
    for (const [t, id] of room.tokens) if (gone.includes(id)) room.tokens.delete(t);
    for (const c of [...room.clients]) {
      if (c.playerId && gone.includes(c.playerId)) {
        this.send(c, { t: "error", error: "kicked" });
        room.clients.delete(c);
        c.room = null;
        c.conn.close(CLOSE.kicked, "kicked");
      }
    }
  }

  /** One timer per room, for the question deadline. */
  private schedule(room: Room): void {
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    const { phase, deadline } = room.state;
    if (phase !== "question" || deadline == null) return;
    const wait = Math.max(0, deadline + GRACE_MS + 5 - Date.now());
    room.timer = setTimeout(() => {
      room.timer = null;
      this.dispatch(room, { type: "tick", now: Date.now() });
      // A tick that arrived a little early: try again.
      if (room.state.phase === "question" && room.timer == null) this.schedule(room);
    }, wait);
    room.timer.unref?.();
  }

  private pushView(room: Room, c: Client): void {
    const view = JSON.stringify(viewFor(room.state, c.playerId));
    if (view === c.lastView) return;
    c.lastView = view;
    c.conn.send(`{"t":"view","now":${Date.now()},"view":${view}}`);
  }

  private send(c: Client, msg: ServerMessage): void {
    c.conn.send(JSON.stringify(msg));
  }

  private fail(c: Client, error: ErrorCode, close = false): void {
    this.send(c, { t: "error", error });
    if (close) c.conn.close(CLOSE.invalid, error);
  }

  /** Removes idle rooms. */
  sweep(now = Date.now()): void {
    for (const [code, room] of this.rooms) {
      const idle = now - room.lastActive;
      const expired = now - room.born > this.limits.roomTtlMs;
      if ((room.clients.size === 0 && idle > this.limits.idleEmptyMs) || idle > this.limits.idleMs || expired) {
        for (const c of [...room.clients]) {
          if (expired) this.send(c, { t: "error", error: "expired" });
          c.room = null;
          c.conn.close(CLOSE.shutdown, "expired");
        }
        if (room.timer) clearTimeout(room.timer);
        this.release(room);
        this.rooms.delete(code);
      }
    }
    for (const [ip, times] of this.creates) {
      if (times.every((t) => now - t >= this.limits.createWindowMs)) this.creates.delete(ip);
    }
  }

  /** Everything needed to carry running games over a restart. */
  snapshot(): Snapshot {
    return {
      savedAt: Date.now(),
      rooms: [...this.rooms.values()].map((r) => ({ state: r.state, packs: r.packs, tokens: [...r.tokens], lastActive: r.lastActive, born: r.born, ip: r.ip })),
    };
  }

  private restore(snap: Snapshot): void {
    const now = Date.now();
    for (const r of snap.rooms ?? []) {
      if (!r?.state?.code || !Array.isArray(r.packs) || !Array.isArray(r.tokens)) continue;
      // Everyone reconnects; questions get some extra time back for the restart.
      let state: RoomState = { ...r.state, players: r.state.players.map((p) => ({ ...p, connected: false })) };
      if (state.phase === "question" && state.deadline != null) state = { ...state, deadline: Math.max(state.deadline, now + 15_000) };
      const interned = this.intern(r.packs);
      if (!interned) continue;
      const room: Room = {
        state,
        packs: interned.packs,
        packKeys: interned.keys,
        tokens: new Map(r.tokens),
        clients: new Set(),
        timer: null,
        lastActive: now,
        born: typeof r.born === "number" ? r.born : now,
        ip: typeof r.ip === "string" ? r.ip : "",
      };
      this.rooms.set(state.code, room);
      this.schedule(room);
    }
  }

  /** Stops timers and closes every connection (on shutdown, after taking a snapshot). */
  close(): void {
    clearInterval(this.sweeper);
    for (const room of this.rooms.values()) {
      if (room.timer) clearTimeout(room.timer);
      for (const c of room.clients) c.conn.close(CLOSE.shutdown, "restart");
    }
  }
}

function newPlayerId(): string {
  return randomBytes(6).toString("hex");
}

function emptyRoom(): RoomState {
  return { players: [] } as unknown as RoomState;
}

const PACES: Pace[] = ["none", "calm", "fast"];

/** Settings from a client, checked field by field; null when anything is off. */
export function cleanSettings(raw: unknown): RoomSettings | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const int = (v: unknown, lo: number, hi: number) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
  if (s.mode !== "mix" && s.mode !== "classic") return null;
  if (!int(s.rounds, 1, 100)) return null;
  if (s.target !== null && !int(s.target, 1, 1000)) return null;
  if (s.wipe !== "always" && s.wipe !== "firstFree") return null;
  if (typeof s.showCorrectCount !== "boolean") return null;
  if (!PACES.includes(s.pace as Pace)) return null;
  const diffs = s.difficulties;
  if (!Array.isArray(diffs) || diffs.length === 0 || !diffs.every((d) => d === 1 || d === 2 || d === 3)) return null;
  const ids = s.packIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200 || !ids.every((id) => typeof id === "string" && id.length <= 100)) return null;
  return {
    mode: s.mode,
    rounds: s.rounds as number,
    target: s.target as number | null,
    wipe: s.wipe,
    showCorrectCount: s.showCorrectCount,
    pace: s.pace as Pace,
    difficulties: Array.from(new Set(diffs as number[])),
    packIds: Array.from(new Set(ids as string[])),
  };
}
