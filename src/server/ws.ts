import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { WS_PATH } from "../net/protocol.ts";
import type { Hub } from "./rooms.ts";

// Connects WebSocket clients at /ws to the hub. Caddy terminates TLS and forwards
// the upgrade; X-Forwarded-For is trusted only from a private or loopback peer.

export interface WsOptions {
  /** Exact allowed Origin (https://fakt.hutnan.dev). Empty: the Origin's host must equal the Host header. */
  publicOrigin: string;
  /** Largest frame; `create` carries the room's packs. */
  maxPayload: number;
  /** Interval of protocol pings that detect dead connections. */
  heartbeatMs: number;
}

export const DEFAULT_WS: WsOptions = { publicOrigin: "", maxPayload: 4 * 1024 * 1024, heartbeatMs: 25_000 };

export function attachRooms(server: Server, hub: Hub, opts: Partial<WsOptions> = {}): WebSocketServer {
  const o = { ...DEFAULT_WS, ...opts };
  const wss = new WebSocketServer({ noServer: true, maxPayload: o.maxPayload, perMessageDeflate: { threshold: 1024 } });
  const alive = new WeakMap<WebSocket, boolean>();

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = (req.url ?? "").split("?")[0];
    if (path !== WS_PATH || !originAllowed(req, o.publicOrigin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      alive.set(ws, true);
      ws.on("pong", () => alive.set(ws, true));
      const handlers = hub.connect({
        ip: clientIp(req),
        send: (data) => {
          if (ws.readyState === ws.OPEN) ws.send(data);
        },
        close: (code, reason) => ws.close(code, reason),
      });
      ws.on("message", (data, isBinary) => {
        if (isBinary) return ws.close(4400, "binary");
        handlers.message(data.toString());
      });
      ws.on("close", handlers.close);
      ws.on("error", () => ws.terminate());
    });
  });

  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, o.heartbeatMs);
  beat.unref();
  wss.on("close", () => clearInterval(beat));
  return wss;
}

export function originAllowed(req: IncomingMessage, publicOrigin: string): boolean {
  const origin = req.headers.origin;
  if (!origin) return false;
  if (publicOrigin) return origin === publicOrigin;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

const PRIVATE = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|::ffff:(127|10|192\.168|172\.(1[6-9]|2\d|3[01]))\.)/i;

export function clientIp(req: IncomingMessage): string {
  const peer = req.socket.remoteAddress ?? "";
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && PRIVATE.test(peer)) {
    const last = fwd.split(",").pop()?.trim();
    if (last) return last;
  }
  return peer;
}
