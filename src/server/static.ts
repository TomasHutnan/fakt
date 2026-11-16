// Serves the built app (dist/) over plain HTTP. TLS and compression are Caddy's job.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const IMMUTABLE = "public, max-age=31536000, immutable";

/** Vite's hashed assets and hashed pack files never change; everything else is revalidated. */
export function cacheControl(urlPath: string): string {
  if (urlPath.startsWith("/assets/")) return IMMUTABLE;
  if (/^\/packs\/[^/]+\.[0-9a-f]{8,}\.json$/.test(urlPath)) return IMMUTABLE;
  return "no-cache";
}

/**
 * Maps a URL path to a file under root, or null if it is malformed, hidden or escapes root.
 * "/" and paths ending in "/" map to index.html.
 */
export function resolvePath(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (!decoded.startsWith("/") || decoded.includes("\0") || decoded.includes("\\")) return null;
  const segments = decoded.split("/");
  if (segments.some((s) => s === ".." || s.startsWith("."))) return null;
  if (decoded.endsWith("/")) decoded += "index.html";
  const base = resolve(root);
  const file = resolve(join(base, decoded));
  return file.startsWith(base + sep) ? file : null;
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy": "frame-ancestors 'none'",
};

function send(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}

/** Request handler for the static app plus /healthz. */
export function staticHandler(root: string) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const urlPath = (req.url ?? "/").split("?")[0]!;
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      return send(res, 405, "Method not allowed\n");
    }
    if (urlPath === "/healthz") return send(res, 200, "ok\n");

    const file = resolvePath(root, urlPath);
    if (!file) return send(res, 400, "Bad request\n");
    let info;
    try {
      info = await stat(file);
    } catch {
      return send(res, 404, "Not found\n");
    }
    if (!info.isFile()) return send(res, 404, "Not found\n");

    const etag = `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
    const headers: Record<string, string> = {
      ...SECURITY_HEADERS,
      "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
      "Cache-Control": cacheControl(urlPath),
      ETag: etag,
      "Last-Modified": info.mtime.toUTCString(),
    };
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, headers);
      return void res.end();
    }
    headers["Content-Length"] = String(info.size);
    res.writeHead(200, headers);
    if (req.method === "HEAD") return void res.end();
    const stream = createReadStream(file);
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  };
}
