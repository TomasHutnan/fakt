import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { PickCard } from "../engine/cards.ts";
import { DEFAULT_ROOM_SETTINGS, type RoomSettings, type RoomView } from "../engine/room.ts";
import { PROTOCOL, WS_PATH, type ServerMessage } from "../net/protocol.ts";
import { Hub } from "./rooms.ts";
import { PACK } from "./rooms.test.ts";
import { attachRooms } from "./ws.ts";

const ORIGIN = "https://fakt.test";
const SETTINGS: RoomSettings = { ...DEFAULT_ROOM_SETTINGS, mode: "classic", rounds: 2, packIds: ["t"], doubleFinal: false, lastPicks: false };

let server: Server;
let hub: Hub;
let url: string;

beforeAll(async () => {
  hub = new Hub();
  server = createServer((_req, res) => res.end("ok"));
  attachRooms(server, hub, { publicOrigin: ORIGIN });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}${WS_PATH}`;
});
afterAll(async () => {
  hub.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

/** A test phone: a socket plus the last view and seat. */
class Phone {
  ws: WebSocket;
  msgs: ServerMessage[] = [];
  waiters: (() => void)[] = [];
  opened: Promise<void>;
  constructor(origin = ORIGIN) {
    this.ws = new WebSocket(url, { origin });
    this.ws.on("message", (d) => {
      this.msgs.push(JSON.parse(d.toString()));
      this.waiters.splice(0).forEach((w) => w());
    });
    this.opened = new Promise((res, rej) => {
      this.ws.once("open", () => res());
      this.ws.once("error", rej);
      this.ws.once("unexpected-response", (_req, r) => rej(new Error(`HTTP ${r.statusCode}`)));
    });
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m));
  }
  async until<T>(pick: () => T | undefined | null | false, ms = 3000): Promise<T> {
    const end = Date.now() + ms;
    for (;;) {
      const v = pick();
      if (v) return v;
      if (Date.now() > end) throw new Error("timeout");
      await new Promise<void>((r) => {
        this.waiters.push(r);
        setTimeout(r, 50);
      });
    }
  }
  get view(): RoomView | null {
    const v = [...this.msgs].reverse().find((m) => m.t === "view");
    return v?.t === "view" ? v.view : null;
  }
  get seat() {
    const s = this.msgs.find((m) => m.t === "seat");
    return s?.t === "seat" ? s : null;
  }
  close() {
    this.ws.close();
  }
}

describe("rooms over WebSocket", () => {
  it("refuses other origins and paths", async () => {
    await expect(new Phone("https://evil.example").opened).rejects.toThrow("403");
    const wrong = new WebSocket(url.replace(WS_PATH, "/other"), { origin: ORIGIN });
    await expect(new Promise((res, rej) => (wrong.once("open", res), wrong.once("unexpected-response", (_q, r) => rej(new Error(String(r.statusCode))))))).rejects.toThrow("403");
  });

  it("plays a whole game with three phones and a big screen, with a reconnect in the middle", async () => {
    const host = new Phone();
    await host.opened;
    host.send({ t: "create", v: PROTOCOL, name: "Jano", settings: SETTINGS, packs: [PACK], seen: [] });
    const { code } = await host.until(() => host.seat);

    const zuzka = new Phone();
    const miro = new Phone();
    const tv = new Phone();
    await Promise.all([zuzka.opened, miro.opened, tv.opened]);
    zuzka.send({ t: "join", v: PROTOCOL, code, name: "Zuzka" });
    miro.send({ t: "join", v: PROTOCOL, code, name: "Miro" });
    tv.send({ t: "watch", v: PROTOCOL, code });
    await host.until(() => host.view?.players.length === 3);
    await tv.until(() => tv.view?.players.length === 3);

    host.send({ t: "act", action: { type: "start" } });
    await tv.until(() => tv.view?.phase === "question");

    // Miro's phone drops and comes back with its token.
    const token = (await miro.until(() => miro.seat)).token!;
    miro.close();
    await host.until(() => host.view?.players.find((p) => p.name === "Miro")?.connected === false);
    const miro2 = new Phone();
    await miro2.opened;
    miro2.send({ t: "join", v: PROTOCOL, code, token });
    await miro2.until(() => miro2.view?.phase === "question");

    for (let round = 1; round <= 2; round++) {
      const card = hub.room(code)!.card as PickCard;
      const right = card.options.findIndex((o) => o.correct);
      for (const p of [host, zuzka, miro2]) {
        p.send({ t: "act", action: { type: "pick", option: right } });
        p.send({ t: "act", action: { type: "bank" } });
      }
      await tv.until(() => tv.view?.phase === "reveal" && tv.view.round === round);
      for (const p of [host, zuzka, miro2]) p.send({ t: "act", action: { type: "ready" } });
      await tv.until(() => tv.view?.phase === (round === 2 ? "over" : "question"));
    }
    expect(tv.view!.players.map((p) => p.score)).toEqual([2, 2, 2]);
    expect(JSON.stringify(tv.msgs.filter((m) => m.t === "view" && m.view.phase === "question"))).not.toContain('"correct"');
    for (const p of [host, zuzka, miro2, tv]) p.close();
  });

  it("answers pings and reports protocol mismatches", async () => {
    const p = new Phone();
    await p.opened;
    p.send({ t: "ping" });
    await p.until(() => p.msgs.find((m) => m.t === "pong"));
    p.send({ t: "join", v: 999, code: "BCDF", name: "X" });
    await p.until(() => p.msgs.find((m) => m.t === "error" && m.error === "proto"));
    p.close();
  });

  it("closes connections that send binary frames or garbage", async () => {
    const p = new Phone();
    await p.opened;
    const closed = new Promise<number>((r) => p.ws.once("close", (code) => r(code)));
    p.ws.send(Buffer.from([1, 2, 3]));
    expect(await closed).toBe(4400);
  });
});
