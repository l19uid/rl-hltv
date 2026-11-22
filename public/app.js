const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const prettyMap = s => esc(String(s || "").replace(/_P$/, "").replace(/_/g, " "));
const duration = s => s == null ? "" : Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");

const api = {
  async get(path) {
    const res = await fetch("/api/ballchasing/" + path);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(res.status === 429 ? "Rate limited by ballchasing — try again shortly." : body.error || "Request failed (" + res.status + ")");
    return body;
  },
};

function fromBallchasing(r) {
  const side = (t, team) => (t.players || []).map(p => ({
    name: p.name, team, platform: p.id?.platform || "",
    score: p.stats?.core?.score ?? 0, goals: p.stats?.core?.goals ?? 0, assists: p.stats?.core?.assists ?? 0,
    saves: p.stats?.core?.saves ?? 0, shots: p.stats?.core?.shots ?? 0, demos: p.stats?.demo?.inflicted ?? null,
  }));
  return {
    map: r.map_name || r.map_code || "", type: r.playlist_name || r.playlist_id || "", size: r.team_size || 0,
    date: (r.date || "").slice(0, 16).replace("T", " "), secs: r.duration ?? null,
    blueName: r.blue?.name || "Blue", orangeName: r.orange?.name || "Orange",
    blue: r.blue?.goals ?? r.blue?.stats?.core?.goals ?? 0, orange: r.orange?.goals ?? r.orange?.stats?.core?.goals ?? 0,
    players: [...side(r.blue || {}, 0), ...side(r.orange || {}, 1)],
  };
}

const baselines = {};
async function getBaseline(mode) {
  if (!(mode in baselines)) {
    baselines[mode] = fetch(`/api/player-baseline?mode=${mode}`).then(r => r.ok ? r.json() : null).catch(() => null);
  }
  return baselines[mode];
}

async function withRatings(m) {
  const base = await getBaseline(Math.min(3, Math.max(1, m.size || 3)));
  if (!base) return m;
  for (const p of m.players) {
    const c = PlayerRating.composite({ goals: p.goals, assists: p.assists, saves: p.saves, shots: p.shots, demos: p.demos, score: p.score }, base.means);
    if (c != null) p.rating = Math.round(PlayerRating.toRating(c, base.mu, base.sigma) * 100) / 100;
  }
  return m;
}

const ratingBadge = r => r == null ? "–" : `<span class="rt ${PlayerRating.band(r)}">${r.toFixed(2)}</span>`;

function teamTable(m, team, label, cls, mvp, showDemos) {
  const ps = m.players.filter(p => p.team === team).sort((a, b) => b.score - a.score);
  const max = Math.max(1, ...m.players.map(p => p.score));
  const showRating = m.players.some(p => p.rating != null);
  const heads = ["Score", "G", "A", "Sv", "Sh", "Sh%"].concat(showDemos ? ["Demos"] : []).concat(showRating ? ["Rating"] : []);
  const rows = ps.map(p => {
    const pct = p.shots ? Math.round(p.goals / p.shots * 100) + "%" : "–";
    const cells = [p.goals, p.assists, p.saves, p.shots, pct].concat(showDemos ? [p.demos ?? "–"] : []).concat(showRating ? [ratingBadge(p.rating)] : []);
    return `<tr><td class="name">${esc(p.name)}${p === mvp ? '<span class="star" title="MVP">★</span>' : ""}<span class="pf">${esc(p.platform)}</span></td>
      <td class="${p === mvp ? "top" : ""}"><span class="bar" style="width:${Math.round(p.score / max * 60)}px;background:var(--${cls})"></span>${p.score}</td>
      ${cells.map(c => `<td>${c}</td>`).join("")}</tr>`;
  }).join("");
  return `<div class="sc"><table><thead><tr><th class="${cls}">${esc(label)}</th>${heads.map(h => `<th class="${cls}">${h}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderMatch(m) {
  const res = (a, b) => a > b ? '<div class="r win">Winner</div>' : a < b ? '<div class="r loss">Defeat</div>' : '<div class="r draw">Draw</div>';
  const tone = (a, b) => a > b ? "win" : a < b ? "loss" : "";
  const mvp = [...m.players].sort((a, b) => b.score - a.score)[0];
  const showDemos = m.players.some(p => p.demos != null);
  $("out").innerHTML = `<div class="match">
    <div class="meta"><span><b>${prettyMap(m.map)}</b></span><span>${esc(m.type)} · ${m.size}v${m.size}</span><span>${esc(m.date)}</span>${m.secs != null ? `<span>${duration(m.secs)} played</span>` : ""}</div>
    <div class="score">
      <div class="team blue"><div class="n">${esc(m.blueName)}</div>${res(m.blue, m.orange)}</div>
      <div class="big"><span class="${tone(m.blue, m.orange)}">${m.blue}</span> : <span class="${tone(m.orange, m.blue)}">${m.orange}</span></div>
      <div class="team orange"><div class="n">${esc(m.orangeName)}</div>${res(m.orange, m.blue)}</div>
    </div>
    ${teamTable(m, 0, m.blueName, "blue", mvp, showDemos)}${teamTable(m, 1, m.orangeName, "orange", mvp, showDemos)}</div>`;
}

function notify(text, isError = false) {
  $("msg").textContent = text;
  $("msg").className = isError ? "err" : "";
}

async function showReplay(id) {
  notify("Loading match…");
  try {
    renderMatch(await withRatings(fromBallchasing(await api.get("replays/" + id))));
    notify("");
  } catch (e) { notify(e.message, true); }
}

function openMatch(btn, scope) {
  scope.querySelectorAll(".game.on").forEach(x => x.classList.remove("on"));
  btn.classList.add("on");
  showReplay(btn.dataset.id).then(() => $("out").scrollIntoView({ behavior: "smooth", block: "start" }));
}

let mode = 3;
let rankState = { days: 30, limit: 10 };
let rankingRequest = 0;
let tourneyRequest = 0;
let playerRequest = 0;

const syncNote = d => d.syncing ? `<p class="hint">Still loading history (${d.groupsDone} groups so far) — newest events first, this list fills in as it goes.</p>` : "";
if (typeof window !== "undefined") setInterval(() => { if (document.querySelector(".syncing")) { loadRanking(); loadPlayers(); loadTournaments(); } }, 60000);

const fmtPrize = n => n >= 1e6 ? "$" + +(n / 1e6).toFixed(1) + "M" : "$" + Math.round(n / 1000) + "k";

async function loadRanking() {
  const ticket = ++rankingRequest;
  const body = $("rankbody");
  $("teamgames").innerHTML = "";
  try {
    const res = await fetch(`/api/rankings?mode=${mode}&days=${rankState.days}&limit=${rankState.limit}`);
    const d = await res.json();
    if (ticket !== rankingRequest) return;
    if (res.status === 503 && d.syncing) {
      body.innerHTML = `<p class="hint">${esc(d.error)}</p>`;
      setTimeout(() => ticket === rankingRequest && loadRanking(), 15000);
      return;
    }
    if (!res.ok) throw new Error(d.error || "Rankings unavailable");
    const top = d.teams[0]?.points || 1500;
    const low = Math.min(1400, ...d.teams.map(t => t.points));
    const rows = d.teams.map((t, i) => {
      const pct = Math.max(6, Math.round((t.points - low) / Math.max(1, top - low) * 100));
      return `<button class="rrow" data-team="${esc(t.name)}"><span class="rk">${i + 1}</span><span class="rn">${esc(t.name)}</span><span class="rg" title="series W–L in this period">${t.wins}–${t.losses}</span><span class="wr"><i style="width:${pct}%"></i><b>${t.points}${t.provisional ? "*" : ""}</b></span></button>`;
    }).join("");
    const more = rankState.limit < 50 ? '<button id="more">Show top 50</button>' : '<button id="more">Show top 10</button>';
    const updated = d.updatedAt ? ` · updated ${esc(d.updatedAt.slice(0, 10))}` : "";
    document.body.classList.toggle("syncing", !!d.syncing);
    body.innerHTML = syncNote(d) + (rows || `<p class="hint">Not enough series in this period.${d.latest ? ` Newest data is from ${esc(new Date(d.latest).toISOString().slice(0, 10))}.` : ""} <a href="/api/status" target="_blank">Data status</a></p>`) +
      `<p class="hint">Points: prize-weighted rating from every series since the history starts. W–L = series in this period, minimum ${d.minSeries}. * = fewer than 8 series so far${updated}.</p>${more}`;
  } catch (e) {
    if (ticket === rankingRequest) body.innerHTML = `<p class="hint err">${esc(e.message)}</p>`;
  }
}

async function loadPlayers() {
  const ticket = ++playerRequest;
  const body = $("playerbody");
  try {
    const res = await fetch(`/api/players?mode=${mode}&days=${rankState.days}&limit=20`);
    const d = await res.json();
    if (ticket !== playerRequest) return;
    if (res.status === 503 && d.syncing) {
      body.innerHTML = `<p class="hint">${esc(d.error)}</p>`;
      setTimeout(() => ticket === playerRequest && loadPlayers(), 15000);
      return;
    }
    if (!res.ok) throw new Error(d.error || "Players unavailable");
    const f = n => n == null ? "–" : n.toFixed(1);
    const rows = d.players.map((p, i) => `<div class="prow"><span class="rk">${i + 1}</span><span class="pn">${esc(p.name)}</span><span class="pm pg">${p.games}g</span><span class="pm">${f(p.goals)} G · ${f(p.assists)} A · ${f(p.saves)} Sv</span><span class="pr">${ratingBadge(p.rating)}</span></div>`).join("");
    body.innerHTML = rows
      ? `<div class="prow h"><span></span><span>Player</span><span class="pg">Games</span><span class="pm">Per game</span><span class="pr">Rating</span></div>${rows}<p class="hint">Min ${d.minGames} games in this period. Each stat is compared with the league average for the mode, weighted goals 25% · score 25% · saves 20% · assists 15% · shots 10% · demos 5%, then scaled so ±2 standard deviations = 1.5 / 0.5. Few-game samples are pulled toward 1.00.</p>`
      : '<p class="hint">Not enough games in this period.</p>';
  } catch (e) {
    if (ticket === playerRequest) body.innerHTML = `<p class="hint err">${esc(e.message)}</p>`;
  }
}

async function loadTeamGames(team) {
  const box = $("teamgames");
  box.innerHTML = '<p class="hint">Loading…</p>';
  try {
    const res = await fetch(`/api/team-games?mode=${mode}&days=${rankState.days}&team=${encodeURIComponent(team)}`);
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || "Games unavailable");
    const pills = d.games.map(g => `<button class="game ${g.gf > g.ga ? "w" : "l"}" data-id="${esc(g.id)}" title="${esc(new Date(g.t).toISOString().slice(0, 10))}">${g.gf}–${g.ga} vs ${esc(g.opp)}</button>`).join("");
    box.innerHTML = `<div class="tg"><b>${esc(team)}</b><div class="games">${pills || '<span class="hint">No games.</span>'}</div></div>`;
  } catch (e) {
    box.innerHTML = `<p class="hint err">${esc(e.message)}</p>`;
  }
}

async function loadTournaments() {
  const ticket = ++tourneyRequest;
  const box = $("tourneys");
  box.innerHTML = '<p class="hint">Loading…</p>';
  try {
    const res = await fetch(`/api/tournaments?mode=${mode}`);
    const d = await res.json();
    if (ticket !== tourneyRequest) return;
    if (res.status === 503 && d.syncing) {
      box.innerHTML = `<p class="hint">${esc(d.error)}</p>`;
      setTimeout(() => ticket === tourneyRequest && loadTournaments(), 15000);
      return;
    }
    if (!res.ok) throw new Error(d.error || "Tournaments unavailable");
    if (!d.tournaments.length) { box.innerHTML = '<p class="hint">No tournaments for this mode yet.</p>'; return; }
    let html = "", year = null;
    for (const t of d.tournaments) {
      if (t.year !== year) {
        if (year !== null) html += "</div>";
        year = t.year;
        html += `<h2 class="yr">${t.year}</h2><div class="tlist">`;
      }
      html += `<div class="tour" data-id="${esc(t.id)}" data-mode="${t.mode}"><button class="thead"><span class="tn">${esc(t.title)}</span><span class="tw">${t.winner ? "🏆 " + esc(t.winner) : ""}</span><span class="tp" title="estimated prize pool (prizes.json)">${fmtPrize(t.prize)}</span></button><div class="tbody" hidden></div></div>`;
    }
    box.innerHTML = syncNote(d) + html + "</div>";
  } catch (e) {
    if (ticket === tourneyRequest) box.innerHTML = `<p class="hint err">${esc(e.message)}</p>`;
  }
}

async function openTournament(tour) {
  const body = tour.querySelector(".tbody");
  body.hidden = !body.hidden;
  tour.classList.toggle("open", !body.hidden);
  if (body.hidden || body.dataset.loaded) return;
  body.innerHTML = '<p class="hint">Loading…</p>';
  try {
    const res = await fetch(`/api/tournament?id=${encodeURIComponent(tour.dataset.id)}&mode=${tour.dataset.mode}`);
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || "Tournament unavailable");
    body.innerHTML = d.series.map(s => `<div class="ser"><span class="sn">${esc(s.a)} <b>${s.wa}–${s.wb}</b> ${esc(s.b)}${s.name ? `<em>${esc(s.name)}</em>` : ""}</span><span class="games">${s.games.map(g => `<button class="game" data-id="${esc(g.id)}">${g.a ?? "–"}–${g.b ?? "–"}</button>`).join("")}</span></div>`).join("") || '<p class="hint">No series.</p>';
    body.dataset.loaded = "1";
  } catch (e) {
    body.innerHTML = `<p class="hint err">${esc(e.message)}</p>`;
  }
}

$("tourneys").onclick = e => {
  const game = e.target.closest(".game");
  if (game) return openMatch(game, $("tourneys"));
  const head = e.target.closest(".thead");
  if (head) openTournament(head.parentElement);
};

$("rankbody").onclick = e => {
  if (e.target.id === "more") {
    rankState.limit = rankState.limit < 50 ? 50 : 10;
    return loadRanking();
  }
  const row = e.target.closest(".rrow");
  if (!row) return;
  $("rankbody").querySelectorAll(".rrow.on").forEach(x => x.classList.remove("on"));
  row.classList.add("on");
  loadTeamGames(row.dataset.team);
};

$("teamgames").onclick = e => {
  const b = e.target.closest(".game");
  if (b) openMatch(b, $("teamgames"));
};

$("period").onclick = e => {
  const b = e.target.closest("button");
  if (!b) return;
  [...$("period").children].forEach(c => c.classList.toggle("on", c === b));
  rankState.days = Number(b.dataset.days);
  loadRanking();
  loadPlayers();
};

$("modes").onclick = e => {
  const b = e.target.closest("button");
  if (!b) return;
  [...$("modes").children].forEach(c => c.classList.toggle("on", c === b));
  mode = Number(b.dataset.mode);
  loadRanking();
  loadPlayers();
  loadTournaments();
};

loadRanking();
loadPlayers();
loadTournaments();
