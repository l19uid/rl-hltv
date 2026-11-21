const fs = require("fs");
const path = require("path");

const DAY_MS = 86400000;

function loadStore(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function saveStore(file, store) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(store));
}

function mergeGames(existing, incoming, now, retainDays) {
  const byId = new Map();
  for (const g of [...existing, ...incoming]) byId.set(g.i, g);
  const cutoff = now - retainDays * DAY_MS;
  return [...byId.values()].filter(g => g.t >= cutoff).sort((a, b) => b.t - a.t);
}

const isDecided = g => g.b && g.o && g.x != null && g.y != null && g.x !== g.y;

function rank(store, days, limit) {
  const cutoff = Date.now() - days * DAY_MS;
  const teams = new Map();
  const tally = (name, won) => {
    const t = teams.get(name) || { name, games: 0, wins: 0 };
    t.games++;
    if (won) t.wins++;
    teams.set(name, t);
  };
  for (const g of store.games) {
    if (g.t < cutoff || !isDecided(g)) continue;
    tally(g.b, g.x > g.y);
    tally(g.o, g.y > g.x);
  }
  const minGames = Math.max(6, Math.round(days / 12));
  const list = [...teams.values()]
    .filter(t => t.games >= minGames)
    .map(t => ({ ...t, winRate: t.wins / t.games }))
    .sort((a, b) => b.winRate - a.winRate || b.games - a.games)
    .slice(0, limit);
  return { days, minGames, teams: list, updatedAt: store.updatedAt };
}

function teamGames(store, name, days, limit = 100) {
  const cutoff = Date.now() - days * DAY_MS;
  const out = [];
  for (const g of store.games) {
    if (g.t < cutoff || !isDecided(g) || (g.b !== name && g.o !== name)) continue;
    const blue = g.b === name;
    out.push({ id: g.i, t: g.t, opp: blue ? g.o : g.b, gf: blue ? g.x : g.y, ga: blue ? g.y : g.x });
    if (out.length >= limit) break;
  }
  return out;
}

module.exports = { loadStore, saveStore, mergeGames, rank, teamGames };
