const fs = require("fs");
const { rankings, tournamentList } = require("./rating");
const { leaderboard, playerTable } = require("./players");
const { inferTeams } = require("./roster");

const DAY_MS = 86400000;
const HOUR_MS = 3600000;

function loadSchedule(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

const safeUrl = u => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : null);

function upcoming(schedule, mode, now) {
  const forMode = x => !x.mode || Number(x.mode) === mode;
  const tournaments = (schedule.tournaments || [])
    .filter(forMode)
    .map(t => ({ name: t.name, start: t.start, end: t.end || t.start, prize: t.prize ?? null, url: safeUrl(t.url), startMs: Date.parse(t.start), endMs: Date.parse(t.end || t.start) }))
    .filter(t => Number.isFinite(t.startMs) && t.endMs + DAY_MS >= now)
    .sort((a, b) => a.startMs - b.startMs)
    .slice(0, 6);
  const matches = (schedule.matches || [])
    .filter(forMode)
    .map(m => ({ a: m.a, b: m.b, event: m.event || "", time: m.time, timeMs: Date.parse(m.time) }))
    .filter(m => Number.isFinite(m.timeMs) && m.timeMs >= now - 3 * HOUR_MS)
    .sort((a, b) => a.timeMs - b.timeMs)
    .slice(0, 8);
  return { tournaments, matches };
}

function gameRecords(games, mode, cutoff, anchor) {
  const out = new Map();
  const bump = (team, won) => {
    const r = out.get(team) || { wins: 0, losses: 0 };
    if (won) r.wins++; else r.losses++;
    out.set(team, r);
  };
  for (const g of games) {
    if (g.mode !== mode || g.t < cutoff || g.t > anchor || !g.blue || !g.orange || g.bg == null || g.og == null || g.bg === g.og) continue;
    bump(g.blue, g.bg > g.og);
    bump(g.orange, g.og > g.bg);
  }
  return out;
}

function buildHome({ state, playerState, schedule, mode, days, teamLimit, now = Date.now() }) {
  const anchor = Math.min(now, state.latest || now);
  const cutoff = anchor - days * DAY_MS;

  const board = leaderboard(playerState, mode, days, 10, now);
  const table = playerTable(playerState, mode, days, now);
  const teamOf = inferTeams(playerState[mode].rows, state.series, mode, anchor, days);
  const players = board.players.map(p => ({ ...p, team: teamOf.get(p.pid) || null }));

  const records = gameRecords(state.games, mode, cutoff, anchor);
  const titles = new Map();
  for (const t of state.tournaments.values()) {
    if (t.mode !== mode || !t.winner || t.end < cutoff) continue;
    if (!titles.has(t.winner)) titles.set(t.winner, []);
    titles.get(t.winner).push({ title: t.title, end: t.end });
  }
  const rosterByTeam = new Map();
  for (const p of table) {
    const team = teamOf.get(p.pid);
    if (!team) continue;
    if (!rosterByTeam.has(team)) rosterByTeam.set(team, []);
    rosterByTeam.get(team).push(p);
  }

  const ranked = rankings(state, mode, days, teamLimit, now);
  const teams = ranked.teams.map(t => {
    const rec = records.get(t.name) || { wins: 0, losses: 0 };
    return {
      name: t.name,
      points: t.points,
      provisional: t.provisional,
      seriesWins: t.wins,
      seriesLosses: t.losses,
      gameWins: rec.wins,
      gameLosses: rec.losses,
      titles: (titles.get(t.name) || []).sort((a, b) => b.end - a.end).map(x => x.title),
      roster: (rosterByTeam.get(t.name) || []).sort((a, b) => b.games - a.games).slice(0, mode).map(p => ({ pid: p.pid, name: p.name, rating: p.rating, games: p.games })),
    };
  });

  const pastMatches = state.series
    .filter(s => s.mode === mode)
    .slice(-12)
    .reverse()
    .map(s => ({ id: s.id, a: s.a, b: s.b, wa: s.wa, wb: s.wb, t: s.t, name: s.name, event: state.tournaments.get(`${s.tid}|${mode}`)?.title || "", games: s.games }));

  return {
    mode,
    days,
    latest: state.latest || null,
    minGames: board.minGames,
    minSeries: ranked.minSeries,
    bestPlayer: players[0] || null,
    topPlayers: players,
    topTeams: teams,
    recentTournaments: tournamentList(state, mode).slice(0, 5),
    pastMatches,
    upcoming: upcoming(schedule, mode, now),
  };
}

module.exports = { buildHome, loadSchedule };
