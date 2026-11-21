const path = require("path");
const { BASE, CREATOR, TOKEN, getJson } = require("./ballchasing");
const { openDb } = require("./db");

const RETAIN_DAYS = 400;
const OVERLAP_DAYS = 3;
const MAX_PAGES = 60;
const DAY_MS = 86400000;

async function fetchSince(sinceMs) {
  let url = `${BASE}replays?uploader=${CREATOR}&replay-date-after=${encodeURIComponent(new Date(sinceMs).toISOString())}&sort-by=replay-date&sort-dir=desc&count=200`;
  const games = [];
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const data = await getJson(url);
    for (const r of data.list || []) {
      games.push({ id: r.id, t: Date.parse(r.date || r.created), blue: r.blue?.name ?? null, orange: r.orange?.name ?? null, bg: r.blue?.goals ?? null, og: r.orange?.goals ?? null });
    }
    url = data.next && data.next.startsWith(BASE) ? data.next : null;
  }
  return games;
}

async function syncNow(db, now = Date.now()) {
  if (!TOKEN) throw new Error("BALLCHASING_TOKEN is not set");
  const newest = db.newest();
  const since = newest ? newest - OVERLAP_DAYS * DAY_MS : now - RETAIN_DAYS * DAY_MS;
  const incoming = await fetchSince(since);
  if (!incoming.length && !db.count()) {
    throw new Error(`No replays found for uploader ${CREATOR}. Check RLCS_CREATOR_ID.`);
  }
  db.upsertGames(incoming);
  db.prune(now - RETAIN_DAYS * DAY_MS);
  db.setMeta("lastSync", new Date(now).toISOString());
  return incoming.length;
}

module.exports = { syncNow };

if (require.main === module) {
  const db = openDb(process.env.DB_PATH || path.join(__dirname, "data", "games.db"));
  syncNow(db)
    .then(n => console.log(`fetched ${n} games, ${db.count()} stored`))
    .catch(err => { console.error(err.message); process.exit(1); });
}
