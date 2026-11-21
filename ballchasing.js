const TOKEN = process.env.BALLCHASING_TOKEN || "";
const CREATOR = process.env.RLCS_CREATOR_ID || "76561199225615730";
const BASE = process.env.BALLCHASING_URL || "https://ballchasing.com/api/";
const GAP_MS = Number(process.env.REQUEST_GAP_MS || 600);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let gate = Promise.resolve();

function request(url) {
  const run = gate.then(() => fetch(url, { headers: { Authorization: TOKEN } }));
  gate = run.then(() => sleep(GAP_MS), () => sleep(GAP_MS));
  return run;
}

async function getJson(url) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await request(url);
    if (res.status === 429) { await sleep(2000 * attempt); continue; }
    if (!res.ok) throw new Error(`ballchasing returned ${res.status}`);
    return res.json();
  }
  throw new Error("ballchasing rate limit exceeded");
}

module.exports = { TOKEN, CREATOR, BASE, request, getJson };
