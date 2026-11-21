const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.BALLCHASING_TOKEN || "";
const CREATOR = process.env.RLCS_CREATOR_ID || "76561199225615730";
const UPSTREAM = process.env.BALLCHASING_URL || "https://ballchasing.com/api/";
const ALLOWED = /^(replays|groups)(\/[A-Za-z0-9-]+)?$/;
const TTL_MS = 5 * 60 * 1000;
const MIN_GAP_MS = Number(process.env.REQUEST_GAP_MS || 600);
const DATASET_TTL_MS = 6 * 60 * 60 * 1000;
const WINDOW_DAYS = 365;
const MAX_PAGES = 40;
const DAY_MS = 86400000;
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

let dataset = null;
let loading = null;

async function fetchGames() {
  const since = new Date(Date.now() - WINDOW_DAYS * DAY_MS).toISOString();
  let url = `${UPSTREAM}replays?uploader=${CREATOR}&replay-date-after=${encodeURIComponent(since)}&sort-by=replay-date&sort-dir=desc&count=200`;
  const games = [];
  let pages = 0;
  let truncated = false;
  while (url) {
    if (pages++ >= MAX_PAGES) { truncated = true; break; }
    const data = await upstreamJson(url);
    for (const r of data.list || []) {
      games.push({ t: Date.parse(r.date || r.created), b: r.blue?.name, o: r.orange?.name, bg: r.blue?.goals, og: r.orange?.goals });
    }
    url = data.next && data.next.startsWith(UPSTREAM) ? data.next : null;
  }
  return { games, truncated, oldest: games.length ? games[games.length - 1].t : null, loadedAt: Date.now() };
}

async function getDataset() {
  if (dataset && Date.now() - dataset.loadedAt < DATASET_TTL_MS) return dataset;
  loading ||= fetchGames()
    .then(data => (dataset = data))
    .finally(() => { loading = null; });
  return loading;
}

function rank(data, days) {
  const cutoff = Date.now() - days * DAY_MS;
  const teams = new Map();
  const tally = (name, won) => {
    const t = teams.get(name) || { name, games: 0, wins: 0 };
    t.games++;
    if (won) t.wins++;
    teams.set(name, t);
  };
  for (const g of data.games) {
    if (!(g.t >= cutoff) || !g.b || !g.o || g.bg == null || g.og == null || g.bg === g.og) continue;
    tally(g.b, g.bg > g.og);
    tally(g.o, g.og > g.bg);
  }
  const minGames = Math.max(6, Math.round(days / 12));
  const list = [...teams.values()]
    .filter(t => t.games >= minGames)
    .map(t => ({ ...t, winRate: t.wins / t.games }))
    .sort((a, b) => b.winRate - a.winRate || b.games - a.games)
    .slice(0, 10);
  const partial = data.truncated && data.oldest > cutoff;
  return { days, minGames, teams: list, since: partial ? new Date(data.oldest).toISOString().slice(0, 10) : null };
}

async function rankings(res, search) {
  if (!TOKEN) return send(res, 503, { error: "BALLCHASING_TOKEN is not configured" });
  const days = Number(new URLSearchParams(search).get("days"));
  if (!PERIODS.includes(days)) return send(res, 400, { error: "days must be 30, 180 or 365" });
  try {
    send(res, 200, rank(await getDataset(), days));
  } catch (err) {
    send(res, 502, { error: err.message });
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
    if (url.pathname === "/api/rankings") return rankings(res, url.search);
    if (url.pathname.startsWith("/api/ballchasing/")) {
      return proxy(res, url.pathname.slice("/api/ballchasing/".length), url.search);
    }
    serveStatic(res, decodeURIComponent(url.pathname));
  })
  .listen(PORT, () => console.log(`listening on :${PORT}`));
