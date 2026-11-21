# Rocket League Replay Site

Match scoreboards in an HLTV-style layout. Two sources:

- **Pro games**: newest RLCS series via the ballchasing.com API (token stays on the server).
- **Upload**: drop a `.replay` file; it is parsed in the browser and never uploaded.

## Run

    BALLCHASING_TOKEN=your_token node server.js

Token: ballchasing.com → Upload tab → API key. Requires Node 18+.

Optional env: `PORT`, `RLCS_CREATOR_ID` (ballchasing account whose groups are listed).

## Deploy

Any Node host works (Render, Railway, Fly.io): build command none, start command `npm start`,
set `BALLCHASING_TOKEN` as a secret environment variable.

Responses are cached in memory for 5 minutes to stay inside ballchasing rate limits.
Credit ballchasing.com (and Liquipedia, if you add it) as the data source.
