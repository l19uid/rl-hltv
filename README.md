# Rocket League Replay Site

Match scoreboards in an HLTV-style layout.

- **Pro games**: top teams by win rate (1 month / 6 months / 1 year), team game lists and an
  event browser, from the ballchasing.com API.

## Run

    npm install
    BALLCHASING_TOKEN=your_token npm start

Token: ballchasing.com → Upload tab → API key. Requires Node 22+.

Optional env: `PORT`, `RLCS_CREATOR_ID`, `DB_PATH` (default `data/games.db`),
`SYNC_INTERVAL_HOURS` (default 24), `REQUEST_GAP_MS` (default 600).

## Match history and ranking

The sync crawls every group created by the RLCS uploader (events, stages, series) and stores each game
with its series, tournament and mode (3v3, 2v2, 1v1) in SQLite. Groups called "2v2 Events" / "1v1 Events"
become one tournament per child group; any other tournament that mixes modes is split per mode.
History length: `HISTORY_DAYS` (default 730). The first sync makes hundreds of requests and can take 10+ minutes;
later syncs (every 24 h) only re-crawl groups younger than 30 days.

Ranking (per mode, so trios, duos and solos each have their own table): every series, oldest first, updates an
Elo-style rating. Everyone starts at 1500, which is how teams with no score get placed by replaying history.
A series win against a stronger team gains more; the step size scales with the tournament's prize pool
(`prizes.json`, log scale). Points decay toward 1500 with a 180-day half-life when a team stops playing.
The period buttons only choose which teams were active and the W–L shown.

Ballchasing has no prize data: edit `prizes.json` (estimates) to match Liquipedia. Tournament winner = winner of the
chronologically last series.

## Player rating

Per-series player totals (goals, assists, saves, shots, score, demos) are stored by the sync from each series
group's stats. Each stat is divided by the league average per game for that mode, combined with the weights in
`public/prating.js`, and scaled so +2 / -2 standard deviations = 1.5 / 0.5 (1.00 = average). The leaderboard
is calibrated across players and shrinks small samples toward 1.00; single-match ratings on the scoreboard use
a per-game scale. Bands: <0.5 awful, 0.5-1 below average, 1-1.5 great, 1.5+ amazing.

## Deploy

Needs a host where the database file survives restarts (Render paid plan with a disk at
`/var/data` and `DB_PATH=/var/data/games.db`, Fly.io or Railway with a volume).
Set `BALLCHASING_TOKEN` as a secret and `NODE_VERSION=22`. Build `npm install`, start `npm start`.

Credit ballchasing.com as the data source.
