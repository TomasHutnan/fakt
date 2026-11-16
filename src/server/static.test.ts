import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cacheControl, resolvePath, staticHandler } from "./static.ts";

describe("resolvePath", () => {
  const root = "/srv/app";
  it("maps paths under root", () => {
    expect(resolvePath(root, "/")).toBe("/srv/app/index.html");
    expect(resolvePath(root, "/assets/a.js")).toBe("/srv/app/assets/a.js");
    expect(resolvePath(root, "/packs/")).toBe("/srv/app/packs/index.html");
  });
  it("rejects escapes, hidden files and malformed input", () => {
    for (const p of ["/../etc/passwd", "/%2e%2e/etc/passwd", "/a/%2E%2E/%2E%2E/x", "/.env", "/a\\..\\b", "/%00", "/%E0%A4%A", "x"]) {
      expect(resolvePath(root, p), p).toBeNull();
    }
  });
});

describe("cacheControl", () => {
  it("caches hashed files forever and revalidates the rest", () => {
    expect(cacheControl("/assets/index-Bx1.js")).toContain("immutable");
    expect(cacheControl("/packs/sk-dano-drevo.a4364a719ba9.json")).toContain("immutable");
    expect(cacheControl("/packs/index.json")).toBe("no-cache");
    expect(cacheControl("/sw.js")).toBe("no-cache");
    expect(cacheControl("/index.html")).toBe("no-cache");
  });
});

describe("staticHandler", () => {
  let dir: string;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "fakt-static-"));
    writeFileSync(join(dir, "index.html"), "<!doctype html><title>Fakt?</title>");
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "assets", "app-abc.js"), "console.log(1)");
    const handle = staticHandler(dir);
    server = createServer((req, res) => void handle(req, res));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("serves index.html at / with revalidation", async () => {
    const res = await fetch(`${base}/?r=KTVR`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.text()).toContain("Fakt?");

    const again = await fetch(`${base}/`, { headers: { "If-None-Match": res.headers.get("etag")! } });
    expect(again.status).toBe(304);
  });

  it("serves hashed assets as immutable", async () => {
    const res = await fetch(`${base}/assets/app-abc.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(res.headers.get("cache-control")).toContain("immutable");
  });

  it("answers health checks, 404s and other methods", async () => {
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    expect((await fetch(`${base}/nope.js`)).status).toBe(404);
    expect((await fetch(`${base}/assets`)).status).toBe(404);
    expect((await fetch(`${base}/`, { method: "POST" })).status).toBe(405);
  });
});
