const DAY_MS = 86400000;
const HALF_LIFE_DAYS = 90;
const MIN_RELATIVE_MARGIN = 0.25;

function inferTeams(rows, series, mode, anchor, days) {
  const teamsBySeries = new Map();
  for (const s of series) if (s.mode === mode) teamsBySeries.set(s.id, [s.a, s.b]);

  const cutoff = anchor - Math.max(days, 180) * DAY_MS;
  const weights = new Map();
  for (const r of rows) {
    if (r.t < cutoff) continue;
    const pair = teamsBySeries.get(r.series);
    if (!pair) continue;
    const w = 0.5 ** (Math.max(0, anchor - r.t) / (HALF_LIFE_DAYS * DAY_MS));
    let m = weights.get(r.pid);
    if (!m) weights.set(r.pid, (m = new Map()));
    for (const team of pair) m.set(team, (m.get(team) || 0) + w);
  }

  const out = new Map();
  for (const [pid, m] of weights) {
    const ranked = [...m.entries()].sort((a, b) => b[1] - a[1]);
    if (ranked.length === 1 || (ranked[0][1] - ranked[1][1]) / ranked[0][1] >= MIN_RELATIVE_MARGIN) out.set(pid, ranked[0][0]);
  }
  return out;
}

module.exports = { inferTeams };
