// Entry point of the container: serves the app and runs the rooms.
// Runs directly with Node's type stripping: `node src/server/main.ts`.
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { Hub, type Limits, type Snapshot } from "./rooms.ts";
import { staticHandler } from "./static.ts";
import { attachRooms } from "./ws.ts";

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "0.0.0.0";
const root = resolve(process.env.FAKT_STATIC_DIR ?? "dist");
const dataDir = process.env.FAKT_DATA_DIR ?? "";
const snapshotFile = dataDir ? join(dataDir, "rooms.json") : "";

/** Limits from the environment (see .env.example); unset or invalid values keep the defaults. */
function limitsFromEnv(): Partial<Limits> {
  const num = (name: string, scale = 1): number | undefined => {
    const v = Number(process.env[name]);
    return process.env[name] && Number.isFinite(v) && v > 0 ? v * scale : undefined;
  };
  const out: Partial<Limits> = {
    maxRooms: num("FAKT_MAX_ROOMS"),
    roomsPerIp: num("FAKT_ROOMS_PER_IP"),
    createsPerWindow: num("FAKT_CREATES_PER_10MIN"),
    maxConnections: num("FAKT_MAX_CONNECTIONS"),
    connectionsPerIp: num("FAKT_CONNECTIONS_PER_IP"),
    maxPackBytes: num("FAKT_MAX_PACK_MB", 1024 * 1024),
    roomTtlMs: num("FAKT_ROOM_TTL_MINUTES", 60_000),
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
}

const hub = new Hub(limitsFromEnv(), loadSnapshot());
console.log("fakt: limits", JSON.stringify(hub.limits));
const handle = staticHandler(root);
const server = createServer((req, res) => {
  handle(req, res).catch((err: unknown) => {
    console.error(err);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});
const wss = attachRooms(server, hub, { publicOrigin: process.env.FAKT_PUBLIC_ORIGIN ?? "" });

server.listen(port, host, () => console.log(`fakt: serving ${root} on http://${host}:${port}, ${hub.roomCount} room(s) restored`));

/** Running games survive a restart: rooms are written on shutdown and read back once. */
function loadSnapshot(): Snapshot | undefined {
  if (!snapshotFile) return undefined;
  try {
    const snap = JSON.parse(readFileSync(snapshotFile, "utf8")) as Snapshot;
    rmSync(snapshotFile, { force: true });
    return snap;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") console.error("fakt: snapshot not loaded:", err);
    return undefined;
  }
}

function saveSnapshot(): void {
  if (!snapshotFile || hub.roomCount === 0) return;
  try {
    const tmp = `${snapshotFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(hub.snapshot()));
    renameSync(tmp, snapshotFile);
    console.log(`fakt: saved ${hub.roomCount} room(s)`);
  } catch (err) {
    console.error("fakt: snapshot not saved:", err);
  }
}

let stopping = false;
function shutdown(): void {
  if (stopping) return;
  stopping = true;
  saveSnapshot();
  hub.close();
  wss.close();
  server.close(() => process.exit(0));
  server.closeIdleConnections();
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
