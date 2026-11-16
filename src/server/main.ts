// Entry point of the container: serves the app; the room server will join it here.
// Runs directly with Node's type stripping: `node src/server/main.ts`.
import { createServer } from "node:http";
import { resolve } from "node:path";
import { staticHandler } from "./static.ts";

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "0.0.0.0";
const root = resolve(process.env.FAKT_STATIC_DIR ?? "dist");

const handle = staticHandler(root);
const server = createServer((req, res) => {
  handle(req, res).catch((err: unknown) => {
    console.error(err);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
});

server.listen(port, host, () => console.log(`fakt: serving ${root} on http://${host}:${port}`));

function shutdown(): void {
  server.close(() => process.exit(0));
  server.closeIdleConnections();
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
