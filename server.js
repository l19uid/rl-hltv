const http = require("http");
const fs = require("fs");
const path = require("path");
const { TOKEN, CREATOR, BASE, request } = require("./ballchasing");
const { openDb } = require("./db");
const { syncNow } = require("./sync");
const { computePlayers, baseline, leaderboard } = require("./players");
const { loadPrizes, computeState, rankings, tournamentList, tournamentDetail } = require("./rating");

const PORT = process.env.PORT || 3000;
const ALLOWED = /^replays\/[A-Za-z0-9-]+$/;
const TTL_MS = 5 * 60 * 1000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data", "games.db");
const SYNC_INTERVAL_MS = Number(process.env.SYNC_INTERVAL_HOURS || 24) * 3600000;
const SYNC_CHECK_MS = 3600000;
const PERIODS = [30, 180, 365];
const PRIZES_FILE = process.env.PRIZES_FILE || path.join(__dirname, "prizes.json");
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
const syncState = { running: false, error: null, groups: 0 };
let state = null;
let playerState = null;

function recompute() {
  state = computeState(db.allGames(), db.groupNames(), loadPrizes(PRIZES_FILE));
  playerState = computePlayers(db.allPlayers());
}
recompute();

async function syncIfStale() {
  if (!TOKEN || syncState.running) return;
  const last = Date.parse(db.getMeta("lastSync") || "") || 0;
  if (Date.now() - last < SYNC_INTERVAL_MS) return;
  syncState.running = true;
  try {
    syncState.groups = 0;
    const n = await syncNow(db, Date.now(), groups => {
      syncState.groups = groups;
      recompute();
    });
    recompute();
    syncState.error = null;
    console.log(`sync: ${n} games stored`);
  } catch (err) {
    syncState.error = err.message;
    console.error("sync failed:", err.message);
  } finally {
    syncState.running = false;
  }
}

function fromState(res, search, build) {
  if (!TOKEN) return send(res, 503, { error: "BALLCHASING_TOKEN is not configured" });
  if (!db.count()) {
    const message = syncState.running ? "Building match history… the first sync can take 10+ minutes." : syncState.error || "No match history yet.";
    return send(res, 503, { error: message, syncing: syncState.running });
  }
  const params = new URLSearchParams(search);
  const mode = Number(params.get("mode"));
  if (![1, 2, 3].includes(mode)) return send(res, 400, { error: "mode must be 1, 2 or 3" });
  const body = build(mode, params);
  if (!body) return send(res, 404, { error: "not found" });
  send(res, 200, { ...body, updatedAt: db.getMeta("lastSync"), syncing: syncState.running, groupsDone: syncState.groups });
}

function periodOf(params) {
  const days = Number(params.get("days"));
  return PERIODS.includes(days) ? days : 30;
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
    if (url.pathname === "/api/status") {
      const games = db.allGames();
      return send(res, 200, {
        games: games.length,
        gamesWithTeamNames: games.filter(g => g.blue && g.orange).length,
        playerRows: db.allPlayers().length,
        newestGame: games.length ? new Date(Math.max(...games.map(g => g.t))).toISOString() : null,
        series: state.stats,
        lastSync: db.getMeta("lastSync"),
        syncing: syncState.running,
        groupsDone: syncState.groups,
        syncError: syncState.error,
      });
    }
    if (url.pathname === "/api/rankings") {
      return fromState(res, url.search, (mode, p) => rankings(state, mode, periodOf(p), Math.min(Number(p.get("limit")) || 10, 50)));
    }
    if (url.pathname === "/api/tournaments") {
      return fromState(res, url.search, mode => ({ tournaments: tournamentList(state, mode) }));
    }
    if (url.pathname === "/api/tournament") {
      return fromState(res, url.search, (mode, p) => tournamentDetail(state, p.get("id") || "", mode));
    }
    if (url.pathname === "/api/players") {
      return fromState(res, url.search, (mode, p) => leaderboard(playerState, mode, periodOf(p), Math.min(Number(p.get("limit")) || 20, 50)));
    }
    if (url.pathname === "/api/player-baseline") {
      return fromState(res, url.search, mode => baseline(playerState, mode));
    }
    if (url.pathname === "/api/team-games") {
      return fromState(res, url.search, (mode, p) => ({ games: db.teamGames(p.get("team") || "", mode, periodOf(p), Math.min(Date.now(), state.latest || Date.now())) }));
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
