import type { ClientAction, RoomView } from "../engine/room.ts";
import { PROTOCOL, WS_PATH, type ClientMessage, type ErrorCode, type ServerMessage } from "./protocol.ts";

// One device's connection to a room. Reconnects on its own (phones lock, Wi-Fi drops)
// and rejoins with the seat token; the room resends the full view each time.

export type Role = "player" | "screen";

/** What a device remembers to get back into its room after a reload. */
export interface StoredSeat {
  code: string;
  token: string | null;
  role: Role;
}

export interface ClientState {
  status: "connecting" | "open" | "closed";
  code: string | null;
  you: string | null;
  view: RoomView | null;
  /** Server clock minus local clock, in ms. */
  offset: number;
  /** Last error; fatal ones stop reconnecting. */
  error: ErrorCode | null;
}

/** Errors after which reconnecting cannot help. */
const FATAL: ErrorCode[] = ["proto", "noRoom", "kicked", "expired", "full", "nameTaken", "badName", "needName", "noQuestions", "badPacks", "busy", "invalid"];

export function roomUrl(): string {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${WS_PATH}`;
}

export class RoomClient {
  state: ClientState = { status: "connecting", code: null, you: null, view: null, offset: 0, error: null };
  private ws: WebSocket | null = null;
  private hello: ClientMessage;
  private stopped = false;
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastMessage = 0;
  private offsets: number[] = [];
  private listeners = new Set<(s: ClientState) => void>();

  constructor(
    hello: ClientMessage,
    private onSeat: (seat: StoredSeat) => void,
    private url = roomUrl(),
  ) {
    this.hello = hello;
    this.state.code = "code" in hello ? hello.code : null;
    this.open();
    document.addEventListener("visibilitychange", this.onVisible);
    window.addEventListener("online", this.onVisible);
  }

  subscribe(fn: (s: ClientState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  send(action: ClientAction): void {
    this.raw({ t: "act", action });
  }

  /** Local time corrected to the server's clock. */
  now(): number {
    return Date.now() + this.state.offset;
  }

  close(): void {
    this.stopped = true;
    document.removeEventListener("visibilitychange", this.onVisible);
    window.removeEventListener("online", this.onVisible);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close(1000, "bye");
    this.ws = null;
  }

  private set(patch: Partial<ClientState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  private raw(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private open(): void {
    if (this.stopped) return;
    this.set({ status: "connecting" });
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      return this.retry();
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retries = 0;
      this.offsets = [];
      this.lastMessage = Date.now();
      this.set({ status: "open", error: null });
      ws.send(JSON.stringify(this.hello));
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        // No word from the server for a while: the connection is dead even if the browser has not noticed.
        if (Date.now() - this.lastMessage > 45_000) return ws.close();
        this.raw({ t: "ping" });
      }, 15_000);
    };
    ws.onmessage = (e) => {
      this.lastMessage = Date.now();
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(e.data)) as ServerMessage;
      } catch {
        return;
      }
      this.onMessage(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.set({ status: "closed" });
      if (!this.state.error || !FATAL.includes(this.state.error)) this.retry();
    };
  }

  private onMessage(msg: ServerMessage): void {
    switch (msg.t) {
      case "seat": {
        // From now on, reconnects rejoin this seat (or keep watching).
        this.hello = msg.id && msg.token ? { t: "join", v: PROTOCOL, code: msg.code, token: msg.token } : { t: "watch", v: PROTOCOL, code: msg.code };
        this.onSeat({ code: msg.code, token: msg.token, role: msg.id ? "player" : "screen" });
        this.set({ code: msg.code, you: msg.id });
        return;
      }
      case "view":
        this.clock(msg.now);
        this.set({ view: msg.view });
        return;
      case "pong":
        this.clock(msg.now);
        return;
      case "error":
        this.set({ error: msg.error });
        if (FATAL.includes(msg.error)) this.stopped = true;
        return;
    }
  }

  /** Offset estimate: the smallest network delay gives the best one, so keep the largest of recent samples. */
  private clock(serverNow: number): void {
    this.offsets = [...this.offsets.slice(-9), serverNow - Date.now()];
    const offset = Math.max(...this.offsets);
    if (offset !== this.state.offset) this.set({ offset });
  }

  private retry(): void {
    if (this.stopped || this.retryTimer) return;
    const wait = Math.min(5000, 300 * 2 ** this.retries++);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, wait);
  }

  private onVisible = (): void => {
    if (document.visibilityState !== "visible" || this.stopped) return;
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) {
      // Back from the lock screen: make sure the socket is still alive.
      this.raw({ t: "ping" });
      return;
    }
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.retries = 0;
    this.open();
  };
}
