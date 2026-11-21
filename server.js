const http = require("http");
const fs = require("fs");
const path = require("path");
const { TOKEN, CREATOR, BASE, request } = require("./ballchasing");
const { openDb } = require("./db");
const { syncNow } = require("./sync");

const PORT = process.env.PORT || 3000;
const ALLOWED = /^(replays|groups)(\/[A-Za-z0-9-]+)?$/;
const TTL_MS = 5 * 60 * 1000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "games.db");
const SYNC_INTERVAL_MS = Number(process.env.SYNC_INTERVAL_HOURS || 24) * 3600000;
const SYNC_CHECK_MS = 3600000;
const PERIODS = [30, 180, 365];
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
    let response = await request(BASE + upstreamPath + search);
    for (let attempt = 1; attempt <= 3 && (response.status === 429 || response.status >= 500); attempt++) {
      await new Promise(r => setTimeout(r, 1500 * attempt));
      response = await request(BASE + upstreamPath + search);
    }
    const body = await response.text();
    if (response.ok) cache.set(key, { body, expires: Date.now() + TTL_MS });
    send(res, response.status, body, { "X-Cache": "MISS" });
  } catch {
    send(res, 502, { error: "ballchasing.com unreachable" });
  }
}

const db = openDb(DB_PATH);
const syncState = { running: false, error: null };

async function syncIfStale() {
  if (!TOKEN || syncState.running) return;
  const last = Date.parse(db.getMeta("lastSync") || "") || 0;
  if (Date.now() - last < SYNC_INTERVAL_MS) return;
  syncState.running = true;
  try {
    const n = await syncNow(db);
    syncState.error = null;
    console.log(`sync: fetched ${n} games, ${db.count()} stored`);
  } catch (err) {
    syncState.error = err.message;
    console.error("sync failed:", err.message);
  } finally {
    syncState.running = false;
  }
}

function fromDb(res, search, build) {
  if (!TOKEN) return send(res, 503, { error: "BALLCHASING_TOKEN is not configured" });
  if (!db.count()) {
    const message = syncState.running ? "Building match history… the first sync can take a few minutes." : syncState.error || "No match history yet.";
    return send(res, 503, { error: message, syncing: syncState.running });
  }
  const params = new URLSearchParams(search);
  const days = Number(params.get("days"));
  if (!PERIODS.includes(days)) return send(res, 400, { error: "days must be 30, 180 or 365" });
  send(res, 200, { ...build(days, params), updatedAt: db.getMeta("lastSync") });
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
    if (url.pathname === "/api/rankings") {
      return fromDb(res, url.search, (days, p) => db.rank(days, Math.min(Number(p.get("limit")) || 10, 50)));
    }
    if (url.pathname === "/api/team-games") {
      return fromDb(res, url.search, (days, p) => ({ games: db.teamGames(p.get("team") || "", days) }));
    }
    if (url.pathname.startsWith("/api/ballchasing/")) {
      return proxy(res, url.pathname.slice("/api/ballchasing/".length), url.search);
    }
    serveStatic(res, decodeURIComponent(url.pathname));
  })
  .listen(PORT, () => {
    console.log(`listening on :${PORT}`);
    syncIfStale();
    setInterval(syncIfStale, SYNC_CHECK_MS);
  });
