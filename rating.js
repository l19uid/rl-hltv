const fs = require("fs");

const DAY_MS = 86400000;
const START = 1500;
const BASE_K = 32;
const HALF_LIFE_DAYS = 180;
const PROVISIONAL_SERIES = 8;

function loadPrizes(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { rules: [], default: 50000, defaultByMode: {} };
  }
}

function prizeFor(prizes, name, mode) {
  for (const rule of prizes.rules || []) {
    if ((!rule.mode || rule.mode === mode) && new RegExp(rule.match, "i").test(name || "")) return rule.usd;
  }
  return prizes.defaultByMode?.[mode] ?? prizes.default ?? 50000;
}

const weight = usd => Math.min(2, Math.max(0.3, (Math.log10(Math.max(usd, 1000)) - 3) / 2));

function nameFallback(name) {
  const m = /^(?:series\s*\d+\s*[:\-–]?\s*)?(.+?)\s+(\d+)\s*[-–]\s*(\d+)\s+(.+)$/i.exec((name || "").trim());
  return m ? { a: m[1].trim(), b: m[4].trim(), wa: Number(m[2]), wb: Number(m[3]) } : null;
}

function buildSeries(games, names) {
  const map = new Map();
  for (const g of games) {
    if (!g.series || !Number.isFinite(g.t)) continue;
    const key = `${g.mode}|${g.series}`;
    let s = map.get(key);
    if (!s) map.set(key, s = { id: g.series, tid: g.tid, mode: g.mode, name: names.get(g.series) || "", t: 0, games: [], teams: new Set() });
    s.games.push(g);
    s.t = Math.max(s.t, g.t);
    if (g.blue) s.teams.add(g.blue);
    if (g.orange) s.teams.add(g.orange);
  }
  const out = [];
  const stats = { seen: map.size, named: 0, fromGroupName: 0 };
  for (const s of map.values()) {
    if (s.teams.size === 0) {
      const f = nameFallback(s.name);
      if (!f) continue;
      s.games.sort((x, y) => x.t - y.t);
      stats.fromGroupName++;
      out.push({ id: s.id, tid: s.tid, mode: s.mode, name: s.name, t: s.t, a: f.a, b: f.b, wa: f.wa, wb: f.wb, games: s.games.map(g => ({ id: g.id, a: g.bg, b: g.og })), winner: f.wa === f.wb ? null : f.wa > f.wb ? f.a : f.b });
      continue;
    }
    if (s.teams.size !== 2) continue;
    stats.named++;
    const [a, b] = [...s.teams];
    s.games.sort((x, y) => x.t - y.t);
    let wa = 0, wb = 0;
    const games = [];
    for (const g of s.games) {
      const aBlue = g.blue === a;
      const ga = aBlue ? g.bg : g.og;
      const gb = aBlue ? g.og : g.bg;
      games.push({ id: g.id, a: ga, b: gb });
      if (ga == null || gb == null || ga === gb) continue;
      if (ga > gb) wa++; else wb++;
    }
    out.push({ id: s.id, tid: s.tid, mode: s.mode, name: s.name, t: s.t, a, b, wa, wb, games, winner: wa === wb ? null : wa > wb ? a : b });
  }
  out.sort((x, y) => x.t - y.t);
  out.stats = stats;
  return out;
}

function computeState(games, names, prizes) {
  const series = buildSeries(games, names);

  const tournaments = new Map();
  for (const s of series) {
    const key = `${s.tid}|${s.mode}`;
    let t = tournaments.get(key);
    if (!t) tournaments.set(key, t = { id: s.tid, mode: s.mode, name: names.get(s.tid) || "Unknown event", series: [], start: s.t, end: s.t });
    t.series.push(s);
    t.start = Math.min(t.start, s.t);
    t.end = Math.max(t.end, s.t);
  }

  const modesPerTid = new Map();
  for (const t of tournaments.values()) {
    if (!modesPerTid.has(t.id)) modesPerTid.set(t.id, new Set());
    modesPerTid.get(t.id).add(t.mode);
  }
  for (const t of tournaments.values()) {
    t.prize = prizeFor(prizes, t.name, t.mode);
    t.weight = weight(t.prize);
    const decided = t.series.filter(s => s.winner);
    t.winner = decided.length ? decided[decided.length - 1].winner : null;
    t.title = modesPerTid.get(t.id).size > 1 ? `${t.name} (${t.mode}v${t.mode})` : t.name;
  }

  const teams = { 1: new Map(), 2: new Map(), 3: new Map() };
  const get = (mode, name) => {
    const m = teams[mode];
    if (!m.has(name)) m.set(name, { name, rating: START, series: 0, last: 0, events: [] });
    return m.get(name);
  };

  for (const s of series) {
    if (!s.winner || !teams[s.mode]) continue;
    const t = tournaments.get(`${s.tid}|${s.mode}`);
    const A = get(s.mode, s.a);
    const B = get(s.mode, s.b);
    const expectedA = 1 / (1 + 10 ** ((B.rating - A.rating) / 400));
    const scoreA = s.winner === s.a ? 1 : 0;
    const k = BASE_K * t.weight;
    A.rating += k * (scoreA - expectedA);
    B.rating += k * ((1 - scoreA) - (1 - expectedA));
    for (const [team, won] of [[A, scoreA === 1], [B, scoreA === 0]]) {
      team.series++;
      team.last = s.t;
      team.events.push({ t: s.t, won });
    }
  }

  const latest = series.length ? series[series.length - 1].t : 0;
  return { tournaments, teams, latest, stats: { ...series.stats, usable: series.length, decided: series.filter(s => s.winner).length } };
}

function rankings(state, mode, days, limit, now = Date.now()) {
  now = Math.min(now, state.latest || now);
  const cutoff = now - days * DAY_MS;
  const minSeries = days <= 30 ? 2 : days <= 180 ? 4 : 6;
  const list = [];
  for (const team of state.teams[mode].values()) {
    const window = team.events.filter(e => e.t >= cutoff);
    if (window.length < minSeries) continue;
    const idle = (now - team.last) / DAY_MS;
    const points = START + (team.rating - START) * 0.5 ** (idle / HALF_LIFE_DAYS);
    const wins = window.filter(e => e.won).length;
    list.push({ name: team.name, points: Math.round(points), wins, losses: window.length - wins, provisional: team.series < PROVISIONAL_SERIES });
  }
  list.sort((a, b) => b.points - a.points || b.wins - a.wins);
  return { mode, days, minSeries, latest: state.latest || null, teams: list.slice(0, limit) };
}

function tournamentList(state, mode) {
  return [...state.tournaments.values()]
    .filter(t => t.mode === mode)
    .sort((a, b) => b.end - a.end)
    .map(t => ({ id: t.id, mode: t.mode, title: t.title, winner: t.winner, prize: t.prize, year: new Date(t.end).getUTCFullYear(), end: t.end }));
}

function tournamentDetail(state, id, mode) {
  const t = state.tournaments.get(`${id}|${mode}`);
  return t ? { title: t.title, series: t.series } : null;
}

module.exports = { loadPrizes, computeState, rankings, tournamentList, tournamentDetail, prizeFor, weight };
