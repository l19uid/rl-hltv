const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DAY_MS = 86400000;
const DECIDED = "blue IS NOT NULL AND orange IS NOT NULL AND bg IS NOT NULL AND og IS NOT NULL AND bg != og";

function openDb(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY, t INTEGER NOT NULL, blue TEXT, orange TEXT, bg INTEGER, og INTEGER
    );
    CREATE INDEX IF NOT EXISTS games_t ON games (t);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
  `);

  const upsert = db.prepare("INSERT OR REPLACE INTO games (id, t, blue, orange, bg, og) VALUES (@id, @t, @blue, @orange, @bg, @og)");
  const upsertMany = db.transaction(rows => rows.forEach(r => upsert.run(r)));
  const prune = db.prepare("DELETE FROM games WHERE t < ?");
  const newest = db.prepare("SELECT MAX(t) AS t FROM games");
  const count = db.prepare("SELECT COUNT(*) AS n FROM games");
  const getMeta = db.prepare("SELECT value FROM meta WHERE key = ?");
  const setMeta = db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)");
  const rankStmt = db.prepare(`
    WITH sides AS (
      SELECT blue AS team, bg > og AS won FROM games WHERE ${DECIDED} AND t >= @cutoff
      UNION ALL
      SELECT orange AS team, og > bg AS won FROM games WHERE ${DECIDED} AND t >= @cutoff
    )
    SELECT team AS name, COUNT(*) AS games, SUM(won) AS wins, 1.0 * SUM(won) / COUNT(*) AS winRate
    FROM sides GROUP BY team HAVING COUNT(*) >= @min
    ORDER BY winRate DESC, games DESC LIMIT @limit`);
  const teamStmt = db.prepare(`
    SELECT id, t,
      CASE WHEN blue = @team THEN orange ELSE blue END AS opp,
      CASE WHEN blue = @team THEN bg ELSE og END AS gf,
      CASE WHEN blue = @team THEN og ELSE bg END AS ga
    FROM games WHERE ${DECIDED} AND t >= @cutoff AND (blue = @team OR orange = @team)
    ORDER BY t DESC LIMIT @limit`);

  return {
    upsertGames: rows => upsertMany(rows),
    prune: cutoff => prune.run(cutoff),
    newest: () => newest.get().t,
    count: () => count.get().n,
    getMeta: key => getMeta.get(key)?.value ?? null,
    setMeta: (key, value) => setMeta.run(key, value),
    rank(days, limit) {
      const minGames = Math.max(6, Math.round(days / 12));
      const teams = rankStmt.all({ cutoff: Date.now() - days * DAY_MS, min: minGames, limit });
      return { days, minGames, teams };
    },
    teamGames: (team, days, limit = 100) => teamStmt.all({ team, cutoff: Date.now() - days * DAY_MS, limit }),
  };
}

module.exports = { openDb };
