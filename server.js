const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.BALLCHASING_TOKEN || "";
const CREATOR = process.env.RLCS_CREATOR_ID || "76561199225615730";
const UPSTREAM = "https://ballchasing.com/api/";
const ALLOWED = /^(replays|groups)(\/[A-Za-z0-9-]+)?$/;
const TTL_MS = 5 * 60 * 1000;
const PUBLIC = path.join(__dirname, "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

const cache = new Map();

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

async function proxy(res, upstreamPath, search) {
  if (!TOKEN) return send(res, 503, { error: "BALLCHASING_TOKEN is not configured" });
  if (!ALLOWED.test(upstreamPath)) return send(res, 404, { error: "unsupported endpoint" });

  const key = upstreamPath + search;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return send(res, 200, hit.body, { "X-Cache": "HIT" });

  try {
    const upstream = await fetch(UPSTREAM + upstreamPath + search, { headers: { Authorization: TOKEN } });
    const body = await upstream.text();
    if (upstream.ok) cache.set(key, { body, expires: Date.now() + TTL_MS });
    send(res, upstream.status, body, { "X-Cache": "MISS" });
  } catch {
    send(res, 502, { error: "ballchasing.com unreachable" });
  }
}

function serveStatic(res, pathname) {
  const file = path.normalize(path.join(PUBLIC, pathname === "/" ? "index.html" : pathname));
  if (!file.startsWith(PUBLIC)) return send(res, 403, { error: "forbidden" });
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, { error: "not found" });
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (req.method !== "GET") return send(res, 405, { error: "method not allowed" });
    if (url.pathname === "/api/config") return send(res, 200, { creator: CREATOR, hasToken: Boolean(TOKEN) });
    if (url.pathname.startsWith("/api/ballchasing/")) {
      return proxy(res, url.pathname.slice("/api/ballchasing/".length), url.search);
    }
    serveStatic(res, decodeURIComponent(url.pathname));
  })
  .listen(PORT, () => console.log(`listening on :${PORT}`));
