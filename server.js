// World War 24/7 — zero-dependency static server (ESM).
// Serves the repository (the broadcast lives at /worldwar247/), redirecting
// "/" there so the preview lands directly on the game. Binds 0.0.0.0 and
// takes the port from the environment (Freebuff injects PORT).

"use strict";

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = path.dirname(fileURLToPath(import.meta.url));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".zip": "application/zip",
  ".webmanifest": "application/manifest+json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  } catch {
    res.writeHead(400).end("Bad request");
    return;
  }

  // Land the preview/deploy root directly on the broadcast.
  if (urlPath === "/" || urlPath === "/index.html") {
    res.writeHead(302, { Location: "/worldwar247/" });
    res.end();
    return;
  }
  if (urlPath.endsWith("/")) urlPath += "index.html";

  // The broadcast app lives at /worldwar247/ on disk under public/.
  const diskPath = urlPath.startsWith("/worldwar247/")
    ? path.join(ROOT, "public", urlPath)
    : path.join(ROOT, urlPath);
  const filePath = path.normalize(diskPath);
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 — not found. The broadcast lives at /worldwar247/");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Content-Length": st.size,
      "Cache-Control": "no-cache",
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[worldwar247] serving on http://${HOST}:${PORT} — broadcast at /worldwar247/`);
});
