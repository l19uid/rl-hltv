const http = require("http");
const fs = require("fs");
const path = require("path");
const { loadStore, rank, teamGames } = require("./store");

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.BALLCHASING_TOKEN || "";
const CREATOR = process.env.RLCS_CREATOR_ID || "76561199225615730";
const UPSTREAM = process.env.BALLCHASING_URL || "https://ballchasing.com/api/";
const ALLOWED = /^(replays|groups)(\/[A-Za-z0-9-]+)?$/;
const TTL_MS = 5 * 60 * 1000;
const MIN_GAP_MS = Number(process.env.REQUEST_GAP_MS || 600);
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "data", "games.json");
const PERIODS = [30, 180, 365];
const PUBLIC = path.join(__dirname, "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const cache = new Map();
let gate = Promise.resolve();

function throttled(task) {
  const run = gate.then(task);
  gate = run.then(() => sleep(MIN_GAP_MS), () => sleep(MIN_GAP_MS));
  return run;
}

function upstream(url) {
  return throttled(() => fetch(url, { headers: { Authorization: TOKEN } }));
}

async function upstreamJson(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await upstream(url);
    if (res.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`ballchasing returned ${res.status}`);
    return res.json();
  }
  throw new Error("ballchasing rate limit exceeded");
}

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
    const response = await upstream(UPSTREAM + upstreamPath + search);
    const body = await response.text();
    if (response.ok) cache.set(key, { body, expires: Date.now() + TTL_MS });
    send(res, response.status, body, { "X-Cache": "MISS" });
  } catch {
    send(res, 502, { error: "ballchasing.com unreachable" });
  }
}

let storeCache = { mtime: 0, store: null };

function currentStore() {
  try {
    const mtime = fs.statSync(DATA_FILE).mtimeMs;
    if (mtime !== storeCache.mtime) storeCache = { mtime, store: loadStore(DATA_FILE) };
  } catch {
    storeCache = { mtime: 0, store: null };
  }
  return storeCache.store;
}

function fromStore(res, search, build) {
  const store = currentStore();
  if (!store) return send(res, 503, { error: "No match history yet — run `node sync.js` or the Sync workflow." });
  const params = new URLSearchParams(search);
  const days = Number(params.get("days"));
  if (!PERIODS.includes(days)) return send(res, 400, { error: "days must be 30, 180 or 365" });
  send(res, 200, build(store, days, params));
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
      return fromStore(res, url.search, (store, days, p) => rank(store, days, Math.min(Number(p.get("limit")) || 10, 50)));
    }
    if (url.pathname === "/api/team-games") {
      return fromStore(res, url.search, (store, days, p) => ({ games: teamGames(store, p.get("team") || "", days) }));
    }
    if (url.pathname.startsWith("/api/ballchasing/")) {
      return proxy(res, url.pathname.slice("/api/ballchasing/".length), url.search);
    }
    serveStatic(res, decodeURIComponent(url.pathname));
  })
  .listen(PORT, () => console.log(`listening on :${PORT}`));
