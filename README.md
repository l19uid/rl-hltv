# Rocket League Replay Site

Match scoreboards in an HLTV-style layout.


Dashboard for the pro Rocket League scene, from the ballchasing.com API. Layout: best player and top
players (left), top teams with recent titles, game record and rosters plus upcoming and recent tournaments
(middle), upcoming and past matches (right), and the full tournament archive below. The 3v3 / 2v2 / 1v1 and
1 month / 6 months / 1 year buttons filter everything. Click a game score to open its scoreboard.

## Run

    npm install
    BALLCHASING_TOKEN=your_token npm start

Token: ballchasing.com → Upload tab → API key. Requires Node 22+.

Optional env: `SITE_NAME` (header title, default "RL Pro Stats"), `SCHEDULE_FILE`, `PORT`, `RLCS_CREATOR_ID`, `DB_PATH` (default `data/games.db`),
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

## Upcoming tournaments and matches

Ballchasing only has games that were already played, so upcoming events come from `schedule.json`, which you
edit by hand (copy them from Liquipedia). Entries in the past are hidden automatically and the file is read on
every page load, so no restart is needed. `mode` (3, 2 or 1) is optional.

## Player profiles

Click any player name to open a profile: team, rating for 1 month / 6 months / 1 year, average per-game stats compared with the league, recent series with their games, and achievements. Served by `/api/player?mode=&pid=`, built in `profile.js`.

Achievements are derived from the data: Champion and Runner-up (the player appeared in the tournament's last series), Tournament MVP (best rating at an event, at least 10 games and 6 rated players), Amazing form (1.5+ over a period), Best series (1.5+), and games-tracked milestones. A player's team in each series is the team they share the most nearby series with (within 90 days), so transfers show correctly.

## Team rosters

The data has no team for each player, so rosters are inferred: a player belongs to the team that appears in
most of their recent series (recent ones count more). A player with only one series stays unassigned until
they have played a second one against a different opponent.

## Deploy (Railway, with a volume)

The database must live on storage that survives redeploys, and the service must not sleep (a sleeping service
pauses the sync).

1. Push the code to GitHub. `data/` is gitignored; never commit the database.
2. railway.com: New project, Deploy from GitHub repo, pick this repo.
3. Add a volume to the service and mount it at `/data`.
4. Variables: `BALLCHASING_TOKEN` (your key), `DB_PATH=/data/games.db`, optionally `SITE_NAME`.
5. Settings, Networking: generate a domain. Leave app sleeping / serverless turned off.
6. Open `/api/status`. `dbPath` should be `/data/games.db`. `dbCreated` must stay the same after every
   redeploy; if it changes, the database is not on the volume. `games` and `groupsDone` should keep rising
   until `syncing` is false.

Other hosts work the same way: attach a volume, point `DB_PATH` at it, keep the service always on.

Credit ballchasing.com as the data source.
