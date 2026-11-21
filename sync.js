const path = require("path");
const { loadStore, saveStore, mergeGames } = require("./store");

const TOKEN = process.env.BALLCHASING_TOKEN;
const CREATOR = process.env.RLCS_CREATOR_ID || "76561199225615730";
const UPSTREAM = process.env.BALLCHASING_URL || "https://ballchasing.com/api/";
const FILE = process.env.DATA_FILE || path.join(__dirname, "data", "games.json");
const RETAIN_DAYS = 400;
const OVERLAP_DAYS = 3;
const MIN_GAP_MS = Number(process.env.REQUEST_GAP_MS || 600);
const MAX_PAGES = 60;
const DAY_MS = 86400000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getJson(url) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, { headers: { Authorization: TOKEN } });
    await sleep(MIN_GAP_MS);
    if (res.status === 429) { await sleep(2000 * attempt); continue; }
    if (!res.ok) throw new Error(`ballchasing returned ${res.status}`);
    return res.json();
  }
  throw new Error("ballchasing rate limit exceeded");
}

async function fetchSince(sinceMs) {
  let url = `${UPSTREAM}replays?uploader=${CREATOR}&replay-date-after=${encodeURIComponent(new Date(sinceMs).toISOString())}&sort-by=replay-date&sort-dir=desc&count=200`;
  const games = [];
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const data = await getJson(url);
    for (const r of data.list || []) {
      games.push({ i: r.id, t: Date.parse(r.date || r.created), b: r.blue?.name, o: r.orange?.name, x: r.blue?.goals, y: r.orange?.goals });
    }
    url = data.next && data.next.startsWith(UPSTREAM) ? data.next : null;
  }
  return games;
}

async function main() {
  if (!TOKEN) throw new Error("BALLCHASING_TOKEN is not set");
  const now = Date.now();
  const existing = loadStore(FILE)?.games || [];
  const newest = existing.reduce((max, g) => Math.max(max, g.t), 0);
  const since = newest ? newest - OVERLAP_DAYS * DAY_MS : now - RETAIN_DAYS * DAY_MS;

  const incoming = await fetchSince(since);
  const games = mergeGames(existing, incoming, now, RETAIN_DAYS);
  saveStore(FILE, { updatedAt: new Date(now).toISOString(), games });
  console.log(`fetched ${incoming.length}, stored ${games.length} games (${games.length - existing.length} new)`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
