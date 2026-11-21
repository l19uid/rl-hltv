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
when it last synced and fetches only newer games if 24 hours have passed. The first sync can
take a few minutes. `npm run sync` runs a sync by hand.

## Deploy

Needs a host where the database file survives restarts (Render paid plan with a disk at
`/var/data` and `DB_PATH=/var/data/games.db`, Fly.io or Railway with a volume).
Set `BALLCHASING_TOKEN` as a secret and `NODE_VERSION=22`. Build `npm install`, start `npm start`.

Credit ballchasing.com as the data source.
