const path = require("path");
const { BASE, CREATOR, TOKEN, getJson } = require("./ballchasing");
const { openDb } = require("./db");

const DAY_MS = 86400000;
const HISTORY_DAYS = Number(process.env.HISTORY_DAYS || 730);
const RECRAWL_DAYS = 30;
const MAX_PAGES = 40;
const CONTAINER = /^\s*[123]\s?v\s?[123]\s+events?\s*$/i;
const MODE_IN_NAME = /\b([123])\s?v\s?\1\b/i;

const url = (route, params) => `${BASE}${route}?${new URLSearchParams(params)}`;
const modeFromName = name => { const m = MODE_IN_NAME.exec(name || ""); return m ? Number(m[1]) : null; };
const modeFromSize = r => { const n = r.blue?.players?.length || r.team_size; return n >= 1 && n <= 3 ? n : null; };

async function listAll(first) {
  const out = [];
  let next = first;
  for (let page = 0; next && page < MAX_PAGES; page++) {
    const data = await getJson(next);
    out.push(...(data.list || []));
    next = data.next && data.next.startsWith(BASE) ? data.next : null;
  }
  return out;
}

const childGroups = id => listAll(url("groups", { group: id, "sort-by": "created", "sort-dir": "desc", count: 200 }));

async function storePlayers(db, g, tid, mode, replays) {
  let detail;
  try {
    detail = await getJson(`${BASE}groups/${g.id}`);
  } catch (err) {
    console.error(`player stats skipped for group ${g.id}: ${err.message}`);
    return;
  }
  const t = Math.max(...replays.map(r => Date.parse(r.date || r.created)).filter(Number.isFinite));
  const rows = [];
  for (const p of detail.players || []) {
    const idv = p.id && typeof p.id === "object" ? p.id : { platform: p.platform, id: p.id };
    const c = p.cumulative || {};
    const core = c.core || {};
    const games = c.games ?? replays.length;
    if (!(games > 0) || core.goals == null) continue;
    rows.push({
      series: g.id, pid: `${idv.platform || "?"}:${idv.id || p.name}`, mode, tid, name: p.name, t, games,
      goals: core.goals, assists: core.assists ?? null, saves: core.saves ?? null, shots: core.shots ?? null,
      score: core.score ?? null, demos: c.demo?.inflicted ?? null,
    });
  }
  db.upsertPlayers(rows);
}

// A group's replay list only contains replays directly inside it, so walk the whole subtree.
async function walk(db, g, ctx, now) {
  const alreadyDone = db.getGroup(g.id)?.crawled && now - (Date.parse(g.created) || 0) > RECRAWL_DAYS * DAY_MS;
  db.upsertGroup(g.id, g.name, g.created);
  if (alreadyDone) return;

  const mode = modeFromName(g.name) ?? ctx.mode;
  const replays = await listAll(url("replays", { group: g.id, "sort-by": "replay-date", "sort-dir": "asc", count: 200 }));
  if (replays.length) await storePlayers(db, g, ctx.tid, mode ?? modeFromSize(replays[0]) ?? 3, replays);
  db.upsertGames(replays.map(r => ({
    id: r.id,
    t: Date.parse(r.date || r.created),
    blue: r.blue?.name ?? null,
    orange: r.orange?.name ?? null,
    bg: r.blue?.goals ?? null,
    og: r.orange?.goals ?? null,
    series: g.id,
    tid: ctx.tid,
    mode: mode ?? modeFromSize(r) ?? 3,
  })));

  // A series holds games directly; only events and stages hold sub-groups, so skip the extra request.
  if (!replays.length) {
    for (const child of await childGroups(g.id)) await walk(db, child, { tid: ctx.tid, mode, stats: ctx.stats }, now);
  }
  db.markCrawled(g.id);
  ctx.stats.groups++;
  if (ctx.stats.groups % 15 === 0) ctx.stats.onProgress(ctx.stats.groups);
}

async function syncNow(db, now = Date.now(), onProgress = () => {}) {
  if (!TOKEN) throw new Error("BALLCHASING_TOKEN is not set");
  const cutoff = now - HISTORY_DAYS * DAY_MS;
  const recent = g => (Date.parse(g.created) || now) >= cutoff - 60 * DAY_MS;

  const top = (await listAll(url("groups", { creator: CREATOR, "sort-by": "created", "sort-dir": "desc", count: 200 })))
    .filter(g => !g.parent && recent(g));

  const stats = { groups: 0, onProgress };
  for (const g of top) {
    if (CONTAINER.test(g.name)) {
      const mode = Number(g.name.match(/[123]/)[0]);
      for (const child of (await childGroups(g.id)).filter(recent)) {
        await walk(db, child, { tid: child.id, mode, stats }, now);
        onProgress(stats.groups);
      }
    } else {
      await walk(db, g, { tid: g.id, mode: null, stats }, now);
      onProgress(stats.groups);
    }
  }

  if (!db.count()) throw new Error(`No replays found in groups created by ${CREATOR}. Check RLCS_CREATOR_ID.`);
  db.prune(cutoff);
  db.setMeta("lastSync", new Date(now).toISOString());
  return db.count();
}

module.exports = { syncNow };

if (require.main === module) {
  const db = openDb(process.env.DB_PATH || path.join(__dirname, "data", "games.db"));
  syncNow(db)
    .then(n => console.log(`${n} games stored`))
    .catch(err => { console.error(err.message); process.exit(1); });
}
