const { composite } = require("./public/prating.js");

const DAY_MS = 86400000;
const KEYS = ["goals", "assists", "saves", "shots", "demos", "score"];
const MIN_CALIBRATION_GAMES = 10;
const SHRINK_GAMES = 10;

function aggregate(rows) {
  const a = { games: 0, totals: {}, counts: {} };
  for (const k of KEYS) { a.totals[k] = 0; a.counts[k] = 0; }
  for (const r of rows) {
    if (!r.games) continue;
    a.games += r.games;
    for (const k of KEYS) if (r[k] != null) { a.totals[k] += r[k]; a.counts[k] += r.games; }
  }
  return a;
}

function perGame(a) {
  const o = {};
  for (const k of KEYS) o[k] = a.counts[k] ? a.totals[k] / a.counts[k] : null;
  return o;
}

function groupBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

function buildMode(rows) {
  const means = perGame(aggregate(rows));

  let games = 0, weighted = 0;
  const units = [];
  for (const r of rows) {
    if (!r.games) continue;
    const pg = {};
    for (const k of KEYS) pg[k] = r[k] != null ? r[k] / r.games : null;
    const c = composite(pg, means);
    if (c == null) continue;
    units.push({ c, n: r.games });
    games += r.games;
    weighted += c * r.games;
  }
  const mu = games ? weighted / games : 1;
  const gameVar = units.length ? units.reduce((s, u) => s + u.n * (u.c - mu) ** 2, 0) / units.length : 0;
  const sigmaGame = Math.sqrt(gameVar) || 0.3;

  const composites = [];
  for (const prs of groupBy(rows, r => r.pid).values()) {
    const a = aggregate(prs);
    if (a.games < MIN_CALIBRATION_GAMES) continue;
    const c = composite(perGame(a), means);
    if (c != null) composites.push(c);
  }
  let muPlayers = 1, sigmaPlayers = sigmaGame * 0.5;
  if (composites.length >= 5) {
    muPlayers = composites.reduce((s, c) => s + c, 0) / composites.length;
    sigmaPlayers = Math.sqrt(composites.reduce((s, c) => s + (c - muPlayers) ** 2, 0) / composites.length) || sigmaPlayers;
  }
  return { rows, means, mu, sigmaGame, muPlayers, sigmaPlayers };
}

function computePlayers(rows) {
  const byMode = {};
  for (const mode of [1, 2, 3]) byMode[mode] = buildMode(rows.filter(r => r.mode === mode));
  byMode.latest = rows.reduce((m, r) => Math.max(m, r.t || 0), 0);
  return byMode;
}

function baseline(state, mode) {
  const m = state[mode];
  return { mode, means: m.means, mu: m.mu, sigma: m.sigmaGame };
}

function leaderboard(state, mode, days, limit, now = Date.now()) {
  const m = state[mode];
  const minGames = days <= 30 ? 6 : days <= 180 ? 12 : 20;
  now = Math.min(now, state.latest || now);
  const cutoff = now - days * DAY_MS;
  const players = [];
  for (const prs of groupBy(m.rows.filter(r => r.t >= cutoff), r => r.pid).values()) {
    const a = aggregate(prs);
    if (a.games < minGames) continue;
    const pg = perGame(a);
    const c = composite(pg, m.means);
    if (c == null) continue;
    const shrink = a.games / (a.games + SHRINK_GAMES);
    const rating = Math.max(0, 1 + 0.25 * ((c - m.muPlayers) / m.sigmaPlayers) * shrink);
    const latest = prs.reduce((x, y) => (y.t > x.t ? y : x));
    players.push({ name: latest.name, games: a.games, rating: Math.round(rating * 100) / 100, goals: pg.goals, assists: pg.assists, saves: pg.saves });
  }
  players.sort((x, y) => y.rating - x.rating || y.games - x.games);
  return { mode, days, minGames, latest: state.latest || null, players: players.slice(0, limit) };
}

module.exports = { computePlayers, baseline, leaderboard };
