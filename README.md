# Rocket League Replay Site

Match scoreboards in an HLTV-style layout.

- **Pro games**: top teams by win rate (1 month / 6 months / 1 year), team game lists and an
  event browser, from the ballchasing.com API.
- **Upload**: drop a `.replay` file; it is parsed in the browser and never uploaded.

## Run

    npm install
    BALLCHASING_TOKEN=your_token npm start

Token: ballchasing.com → Upload tab → API key. Requires Node 22+.

Optional env: `PORT`, `RLCS_CREATOR_ID`, `DB_PATH` (default `data/games.db`),
`SYNC_INTERVAL_HOURS` (default 24), `REQUEST_GAP_MS` (default 600).

## Match history

Games are stored in a local SQLite database. On start, and then hourly, the server checks
when it last synced and fetches only games newer than the newest stored one if 24 hours have passed.
The first sync downloads up to 400 days of games and can take a few minutes; rankings appear
when it finishes. `npm run sync` runs a sync by hand.

The event tree and single-game stats still call the API when clicked (cached for 5 minutes).

## Deploy

Needs a host where the database file survives restarts:

- Render: use a paid web service with a persistent disk mounted at `/var/data` and set
  `DB_PATH=/var/data/games.db`. The free plan wipes the disk on every restart, which would
  trigger a full re-download each time.
- Fly.io or Railway: attach a volume and point `DB_PATH` at it.

Set `BALLCHASING_TOKEN` as a secret. On Render also set `NODE_VERSION=22`.
Start command `npm start`, build command `npm install`.

Credit ballchasing.com as the data source.
