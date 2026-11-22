const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DAY_MS = 86400000;

function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");

  const hadPlayers = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'playerstats'").get();
  const cols = db.prepare("PRAGMA table_info(games)").all().map(c => c.name);
  if (cols.length && !cols.includes("series")) {
    db.exec("DROP TABLE games; DELETE FROM meta WHERE key = 'lastSync';");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY, t INTEGER NOT NULL, blue TEXT, orange TEXT, bg INTEGER, og INTEGER,
      series TEXT, tid TEXT, mode INTEGER
    );
    CREATE INDEX IF NOT EXISTS games_t ON games (t);
    CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, name TEXT, created TEXT, crawled INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS playerstats (
      series TEXT NOT NULL, pid TEXT NOT NULL, mode INTEGER, tid TEXT, name TEXT, t INTEGER, games INTEGER,
      goals INTEGER, assists INTEGER, saves INTEGER, shots INTEGER, score INTEGER, demos INTEGER,
      PRIMARY KEY (series, pid)
    );
  `);
  if (!hadPlayers) db.exec("UPDATE groups SET crawled = 0; DELETE FROM meta WHERE key = 'lastSync';");

  const upsert = db.prepare("INSERT OR REPLACE INTO games (id, t, blue, orange, bg, og, series, tid, mode) VALUES (@id, @t, @blue, @orange, @bg, @og, @series, @tid, @mode)");
  const upsertMany = db.transaction(rows => rows.forEach(r => upsert.run(r)));
  const prune = db.prepare("DELETE FROM games WHERE t < ?");
  const prunePlayers = db.prepare("DELETE FROM playerstats WHERE t < ?");
  const upsertPlayer = db.prepare("INSERT OR REPLACE INTO playerstats (series, pid, mode, tid, name, t, games, goals, assists, saves, shots, score, demos) VALUES (@series, @pid, @mode, @tid, @name, @t, @games, @goals, @assists, @saves, @shots, @score, @demos)");
  const upsertPlayers = db.transaction(rows => rows.forEach(r => upsertPlayer.run(r)));
  const allPlayers = db.prepare("SELECT series, pid, mode, name, t, games, goals, assists, saves, shots, score, demos FROM playerstats");
  const count = db.prepare("SELECT COUNT(*) AS n FROM games");
  const all = db.prepare("SELECT id, t, blue, orange, bg, og, series, tid, mode FROM games");
  const groups = db.prepare("SELECT id, name FROM groups");
  const getGroup = db.prepare("SELECT id, crawled FROM groups WHERE id = ?");
  const upsertGroup = db.prepare("INSERT INTO groups (id, name, created, crawled) VALUES (?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET name = excluded.name, created = excluded.created");
  const markCrawled = db.prepare("UPDATE groups SET crawled = 1 WHERE id = ?");
  const getMeta = db.prepare("SELECT value FROM meta WHERE key = ?");
  const setMeta = db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)");
  const teamStmt = db.prepare(`
    SELECT id, t,
      CASE WHEN blue = @team THEN orange ELSE blue END AS opp,
      CASE WHEN blue = @team THEN bg ELSE og END AS gf,
      CASE WHEN blue = @team THEN og ELSE bg END AS ga
    FROM games
    WHERE mode = @mode AND t >= @cutoff AND bg IS NOT NULL AND og IS NOT NULL AND bg != og
      AND (blue = @team OR orange = @team)
    ORDER BY t DESC LIMIT @limit`);

  return {
    upsertGames: rows => upsertMany(rows),
    prune: cutoff => { prune.run(cutoff); prunePlayers.run(cutoff); },
    upsertPlayers: rows => upsertPlayers(rows),
    allPlayers: () => allPlayers.all(),
    count: () => count.get().n,
    allGames: () => all.all(),
    groupNames: () => new Map(groups.all().map(g => [g.id, g.name])),
    getGroup: id => getGroup.get(id),
    upsertGroup: (id, name, created) => upsertGroup.run(id, name, created),
    markCrawled: id => markCrawled.run(id),
    getMeta: key => getMeta.get(key)?.value ?? null,
    setMeta: (key, value) => setMeta.run(key, value),
    teamGames: (team, mode, days, ref = Date.now(), limit = 100) => teamStmt.all({ team, mode, cutoff: ref - days * DAY_MS, limit }),
  };
}

module.exports = { openDb };
