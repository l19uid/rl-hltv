const { ratingFor, seriesRating, groupBy } = require("./players");

const DAY_MS = 86400000;
const VOTE_DAYS = 90;
const RECENT_SERIES = 8;
const MVP_MIN_GAMES = 10;
const MVP_MIN_PLAYERS = 6;
const PERIODS = [30, 180, 365];
const MIN_GAMES = { 30: 6, 180: 12, 365: 20 };
const PERIOD_NAME = { 30: "last month", 180: "last 6 months", 365: "last year" };
const MILESTONES = [1000, 500, 250, 100, 50];
const STATS = ["goals", "assists", "saves", "shots", "score", "demos"];
const KIND_ORDER = ["title", "mvp", "final", "form", "series", "milestone"];

const seriesIndexes = new WeakMap();
const mvpIndexes = new WeakMap();

const round2 = n => Math.round(n * 100) / 100;

function seriesIndex(state) {
  let idx = seriesIndexes.get(state);
  if (!idx) seriesIndexes.set(state, idx = new Map(state.series.map(s => [s.id, s])));
  return idx;
}

function tournamentMvps(playerState, mode) {
  let byMode = mvpIndexes.get(playerState);
  if (!byMode) mvpIndexes.set(playerState, byMode = {});
  if (byMode[mode]) return byMode[mode];
  const m = playerState[mode];
  const out = new Map();
  for (const [tid, rows] of groupBy(m.rows, r => r.tid)) {
    const rated = [];
    for (const [pid, prs] of groupBy(rows, r => r.pid)) {
      const r = ratingFor(m, prs);
      if (r && r.games >= MVP_MIN_GAMES) rated.push({ pid, rating: r.rating });
    }
    if (rated.length >= MVP_MIN_PLAYERS) out.set(tid, rated.sort((a, b) => b.rating - a.rating)[0]);
  }
  byMode[mode] = out;
  return out;
}

function teamsBySeries(rows, byId) {
  const list = rows.map(r => byId.get(r.series)).filter(Boolean);
  const out = new Map();
  for (const s of list) {
    const votes = new Map([[s.a, 0], [s.b, 0]]);
    for (const o of list) {
      if (o === s || Math.abs(o.t - s.t) > VOTE_DAYS * DAY_MS) continue;
      for (const t of [o.a, o.b]) if (votes.has(t)) votes.set(t, votes.get(t) + 1);
    }
    const [va, vb] = [votes.get(s.a), votes.get(s.b)];
    out.set(s.id, va > vb ? s.a : vb > va ? s.b : null);
  }
  return out;
}

function orient(games, team, s) {
  return games.map(g => team === s.b ? { id: g.id, a: g.b, b: g.a } : { id: g.id, a: g.a, b: g.b });
}

function achievements({ state, playerState, mode, pid, rows, byId, teamOf, ratings, anchor, totalGames }) {
  const m = playerState[mode];
  const mvps = tournamentMvps(playerState, mode);
  const out = [];

  for (const tid of new Set(rows.map(r => r.tid))) {
    const t = state.tournaments.get(`${tid}|${mode}`);
    if (!t) continue;
    const decided = t.series.filter(s => s.winner);
    const final = decided[decided.length - 1];
    const team = final && rows.some(r => r.series === final.id) ? teamOf.get(final.id) : null;
    if (team) {
      out.push(final.winner === team
        ? { kind: "title", label: "Champion", detail: `${t.title} with ${team}`, t: t.end }
        : { kind: "final", label: "Runner-up", detail: `${t.title} with ${team}`, t: t.end });
    }
    const mvp = mvps.get(tid);
    if (mvp && mvp.pid === pid) out.push({ kind: "mvp", label: "Tournament MVP", detail: `${t.title}, rating ${mvp.rating.toFixed(2)}`, t: t.end });
  }

  for (const days of [...PERIODS].reverse()) {
    const r = ratings[days];
    if (r && r.games >= MIN_GAMES[days] && r.rating >= 1.5) {
      out.push({ kind: "form", label: "Amazing form", detail: `Rated ${r.rating.toFixed(2)} over the ${PERIOD_NAME[days]}`, t: anchor });
      break;
    }
  }

  let best = null;
  for (const r of rows) {
    const s = byId.get(r.series);
    if (!s || r.games < 3) continue;
    const rating = seriesRating(m, r);
    if (rating != null && (!best || rating > best.rating)) best = { rating, s, team: teamOf.get(s.id) };
  }
  if (best && best.rating >= 1.5) {
    const opp = best.team === best.s.a ? best.s.b : best.team === best.s.b ? best.s.a : null;
    out.push({ kind: "series", label: "Best series", detail: `Rated ${best.rating.toFixed(2)}${opp ? ` against ${opp}` : ""}, ${state.tournaments.get(`${best.s.tid}|${mode}`)?.title || best.s.name}`, t: best.s.t });
  }

  const milestone = MILESTONES.find(n => totalGames >= n);
  if (milestone) out.push({ kind: "milestone", label: "Milestone", detail: `${milestone}+ pro games tracked`, t: null });

  return out.sort((x, y) => KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind) || (y.t || 0) - (x.t || 0));
}

function buildProfile({ state, playerState, mode, pid, now = Date.now() }) {
  const m = playerState[mode];
  const rows = m.rows.filter(r => r.pid === pid);
  if (!rows.length) return null;

  const byId = seriesIndex(state);
  const teamOf = teamsBySeries(rows, byId);
  const anchor = Math.min(now, state.latest || now);
  const latest = rows.reduce((x, y) => (y.t > x.t ? y : x));

  const ratings = {};
  for (const days of PERIODS) {
    const r = ratingFor(m, rows.filter(x => x.t >= anchor - days * DAY_MS));
    ratings[days] = r ? { rating: r.rating, games: r.games, minGames: MIN_GAMES[days] } : null;
  }

  const overall = ratingFor(m, rows);
  const known = rows.filter(r => byId.has(r.series)).sort((x, y) => y.t - x.t);

  let wins = 0, losses = 0;
  const recent = known.slice(0, RECENT_SERIES).map(r => {
    const s = byId.get(r.series);
    const team = teamOf.get(s.id);
    const mine = team === s.a ? { f: s.wa, ag: s.wb, opp: s.b } : team === s.b ? { f: s.wb, ag: s.wa, opp: s.a } : null;
    const pg = {};
    for (const k of STATS) pg[k] = r[k] != null && r.games ? r[k] / r.games : null;
    const rating = seriesRating(m, r);
    return {
      id: s.id, t: s.t, event: state.tournaments.get(`${s.tid}|${mode}`)?.title || s.name,
      team, opp: mine ? mine.opp : null, a: s.a, b: s.b, wa: s.wa, wb: s.wb,
      won: mine ? (mine.f === mine.ag ? null : mine.f > mine.ag) : null,
      games: orient(s.games, team, s), perGame: pg, rating: rating == null ? null : round2(rating),
    };
  });
  for (const r of known) {
    const s = byId.get(r.series);
    const team = teamOf.get(s.id);
    if (!team || !s.winner) continue;
    if (s.winner === team) wins++; else losses++;
  }

  const avg = {};
  if (overall) for (const k of STATS) avg[k] = overall.pg[k];

  return {
    pid, mode, name: latest.name,
    team: known.length ? teamOf.get(known[0].series) : null,
    games: overall ? overall.games : 0,
    firstGame: rows.reduce((x, y) => Math.min(x, y.t), Infinity),
    lastGame: latest.t,
    seriesRecord: { wins, losses },
    ratings,
    averages: avg,
    league: m.means,
    recent,
    achievements: achievements({ state, playerState, mode, pid, rows, byId, teamOf, ratings, anchor, totalGames: overall ? overall.games : 0 }),
  };
}

module.exports = { buildProfile };
