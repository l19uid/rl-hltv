const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const prettyMap = s => esc(String(s || "").replace(/_P$/, "").replace(/_/g, " "));
const duration = s => s == null ? "" : Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
const dateOf = ms => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const timeOf = ms => new Date(ms).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const fmtPrize = n => n >= 1e6 ? "$" + +(n / 1e6).toFixed(1) + "M" : "$" + Math.round(n / 1000) + "k";
const PERIOD_LABEL = { 30: "last month", 180: "last 6 months", 365: "last year" };

const state = { mode: 3, days: 30, teams: 5 };
let homeTicket = 0;
let archiveTicket = 0;
let refreshTimer = null;

const api = {
  async get(path) {
    const res = await fetch("/api/ballchasing/" + path);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(res.status === 429 ? "ballchasing is rate limiting requests. Try again in a minute." : body.error || "Request failed (" + res.status + ")");
    return body;
  },
};

const panel = (id, html) => { $(id).querySelector(".body").innerHTML = html; };
const empty = text => `<p class="hint">${text}</p>`;
const ratingBadge = r => r == null ? "–" : `<span class="rt ${PlayerRating.band(r)}">${r.toFixed(2)}</span>`;
const gamePills = games => games.map(g => `<button class="game" data-id="${esc(g.id)}">${g.a ?? "–"}–${g.b ?? "–"}</button>`).join("");

/* ---------- scoreboard dialog ---------- */

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
function getBaseline(mode) {
  if (!(mode in baselines)) baselines[mode] = fetch(`/api/player-baseline?mode=${mode}`).then(r => r.ok ? r.json() : null).catch(() => null);
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

function teamTable(m, team, label, cls, mvp, showDemos) {
  const ps = m.players.filter(p => p.team === team).sort((a, b) => b.score - a.score);
  const max = Math.max(1, ...m.players.map(p => p.score));
  const showRating = m.players.some(p => p.rating != null);
  const heads = ["Score", "G", "A", "Sv", "Sh", "Sh%"].concat(showDemos ? ["Demos"] : []).concat(showRating ? ["Rating"] : []);
  const rows = ps.map(p => {
    const pct = p.shots ? Math.round(p.goals / p.shots * 100) + "%" : "–";
    const cells = [p.goals, p.assists, p.saves, p.shots, pct].concat(showDemos ? [p.demos ?? "–"] : []).concat(showRating ? [ratingBadge(p.rating)] : []);
    return `<tr><td class="name">${esc(p.name)}${p === mvp ? '<span class="star" title="Top score">★</span>' : ""}<span class="pf">${esc(p.platform)}</span></td>
      <td class="${p === mvp ? "top1" : ""}"><span class="bar" style="width:${Math.round(p.score / max * 60)}px;background:var(--${cls})"></span>${p.score}</td>
      ${cells.map(c => `<td>${c}</td>`).join("")}</tr>`;
  }).join("");
  return `<div class="sc-wrap"><table><thead><tr><th class="${cls}">${esc(label)}</th>${heads.map(h => `<th class="${cls}">${h}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderMatch(m) {
  const res = (a, b) => a > b ? '<div class="r win">Winner</div>' : a < b ? '<div class="r loss">Defeat</div>' : '<div class="r draw">Draw</div>';
  const tone = (a, b) => a > b ? "win" : a < b ? "loss" : "";
  const mvp = [...m.players].sort((a, b) => b.score - a.score)[0];
  const showDemos = m.players.some(p => p.demos != null);
  $("out").innerHTML = `<div class="meta"><b>${prettyMap(m.map)}</b><span>${esc(m.type)} ${m.size}v${m.size}</span><span>${esc(m.date)}</span>${m.secs != null ? `<span>${duration(m.secs)} played</span>` : ""}</div>
    <div class="score">
      <div class="side blue"><div class="n">${esc(m.blueName)}</div>${res(m.blue, m.orange)}</div>
      <div class="big"><span class="${tone(m.blue, m.orange)}">${m.blue}</span> : <span class="${tone(m.orange, m.blue)}">${m.orange}</span></div>
      <div class="side orange"><div class="n">${esc(m.orangeName)}</div>${res(m.orange, m.blue)}</div>
    </div>
    ${teamTable(m, 0, m.blueName, "blue", mvp, showDemos)}${teamTable(m, 1, m.orangeName, "orange", mvp, showDemos)}`;
}

async function openMatch(id) {
  const dlg = $("dlg");
  $("out").innerHTML = '<p class="hint" style="padding:18px">Loading match…</p>';
  if (!dlg.open) dlg.showModal();
  try {
    renderMatch(await withRatings(fromBallchasing(await api.get("replays/" + id))));
  } catch (e) {
    $("out").innerHTML = `<p class="hint err" style="padding:18px">${esc(e.message)}</p>`;
  }
}

/* ---------- dashboard panels ---------- */

function renderBest(p) {
  if (!p) return panel("best", empty("Not enough games in this period yet."));
  const band = PlayerRating.band(p.rating);
  const pct = (Math.min(p.rating, 2) / 2 * 100).toFixed(1);
  const f = n => n == null ? "–" : n.toFixed(1);
  panel("best", `<div class="meter"><div class="num ${band}">${p.rating.toFixed(2)}</div>
      <div class="gauge" aria-hidden="true"><i class="fill ${band}" style="width:${pct}%"></i><b class="avg"></b></div>
      <div class="scale"><span>0</span><span>1.0 average</span><span>2</span></div></div>
    <div class="best-name">${esc(p.name)}</div>
    <div class="best-team">${esc(p.team || "")}</div>
    <div class="best-stats">
      <div class="stat"><b>${f(p.goals)}</b><span>goals</span></div>
      <div class="stat"><b>${f(p.assists)}</b><span>assists</span></div>
      <div class="stat"><b>${f(p.saves)}</b><span>saves</span></div>
      <div class="stat"><b>${p.games}</b><span>games</span></div>
    </div>`);
}

function renderPlayers(list, minGames) {
  if (!list.length) return panel("players", empty(`Players need at least ${minGames} games in this period to be rated.`));
  panel("players", list.map((p, i) => `<div class="prow"><span class="rk">${i + 1}</span><span><span class="pn">${esc(p.name)}</span><span class="pt">${esc(p.team || "")}</span></span>${ratingBadge(p.rating)}</div>`).join(""));
}

function renderTeams(teams, d) {
  if (!teams.length) {
    const since = d.latest ? ` The newest data is from ${dateOf(d.latest)}.` : "";
    return panel("teams", empty(`No team has played ${d.minSeries} series in this period.${since}`));
  }
  const html = teams.map((t, i) => {
    const total = t.gameWins + t.gameLosses;
    const pct = total ? Math.round(t.gameWins / total * 100) : 0;
    const roster = t.roster.length
      ? t.roster.map(p => `<li>${esc(p.name)}${ratingBadge(p.rating)}</li>`).join("")
      : '<li class="none">Players not identified yet</li>';
    return `<article class="team" data-team="${esc(t.name)}">
      <button class="team-head" aria-expanded="false"><span class="rk">${i + 1}</span><h3>${esc(t.name)}</h3><span class="pts">${t.points}${t.provisional ? "*" : ""}<small>points</small></span></button>
      <div class="tstats">
        <div class="stat"><b>${t.titles.length}</b><span>${t.titles.length === 1 ? "title" : "titles"}</span></div>
        <div class="stat"><b>${t.gameWins}–${t.gameLosses}</b><span>games, ${pct}% won</span></div>
        <div class="stat"><b>${t.seriesWins}–${t.seriesLosses}</b><span>series</span></div>
      </div>
      ${t.titles.length ? `<div class="titles"><b>Won</b> ${t.titles.map(esc).join(", ")}</div>` : ""}
      <ul class="roster">${roster}</ul>
      <div class="tgames" hidden></div>
    </article>`;
  }).join("");
  const more = state.teams < 15 ? '<button class="more" data-more="1">Show 15 teams</button>' : '<button class="more" data-more="1">Show 5 teams</button>';
  panel("teams", html + more + `<p class="hint">Points come from every series since the history starts, weighted by prize pool. A star means fewer than 8 series so far. Click a team to see its games.</p>`);
}

function renderRecentTournaments(list) {
  if (!list.length) return panel("rtourneys", empty("No tournaments for this mode yet."));
  panel("rtourneys", list.map(tourRow).join(""));
}

function tourRow(t) {
  return `<div class="tour" data-id="${esc(t.id)}" data-mode="${t.mode}"><button class="thead" aria-expanded="false"><span class="tn">${esc(t.title)}</span><span class="tp" title="Estimated prize pool">${fmtPrize(t.prize)}</span><span class="tw">${t.winner ? `<b>Winner</b> ${esc(t.winner)}, ${dateOf(t.end)}` : dateOf(t.end)}</span></button><div class="tbody" hidden></div></div>`;
}

function renderUpcomingTournaments(list) {
  if (!list.length) return panel("utourneys", empty("No upcoming tournaments listed yet."));
  panel("utourneys", list.map(t => {
    const range = t.end && t.end !== t.start ? `${dateOf(t.startMs)} to ${dateOf(t.endMs)}` : dateOf(t.startMs);
    const name = t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.name)}</a>` : esc(t.name);
    return `<div class="up"><b>${name}</b><span>${range}${t.prize ? `, ${fmtPrize(t.prize)} prize pool` : ""}</span></div>`;
  }).join(""));
}

function renderUpcomingMatches(list) {
  if (!list.length) return panel("umatches", empty("No upcoming matches listed yet."));
  panel("umatches", list.map(m => `<div class="up"><b>${esc(m.a)} vs ${esc(m.b)}</b><span>${timeOf(m.timeMs)}${m.event ? `, ${esc(m.event)}` : ""}</span></div>`).join(""));
}

function renderPast(list) {
  if (!list.length) return panel("past", empty("No finished matches yet."));
  panel("past", list.map(s => `<div class="pm">
    <div class="pm-line"><span class="t ${s.wa > s.wb ? "won" : ""}">${esc(s.a)}</span><span class="sc">${s.wa}–${s.wb}</span><span class="t ${s.wb > s.wa ? "won" : ""}">${esc(s.b)}</span></div>
    <div class="pm-meta"><span>${esc(s.event || s.name)}</span><span>${dateOf(s.t)}</span></div>
    <div class="games">${gamePills(s.games)}</div></div>`).join(""));
}

function showBanner(d) {
  const b = $("banner");
  if (d && d.syncing) {
    b.hidden = false;
    b.textContent = d.groupsDone
      ? `Still collecting match history (${d.groupsDone} groups so far). Newest events come first, so this page fills in as it goes.`
      : (d.error || "Collecting match history. The first load can take a long time.");
  } else {
    b.hidden = true;
  }
}

function scheduleRefresh(syncing) {
  clearTimeout(refreshTimer);
  if (syncing) refreshTimer = setTimeout(refresh, 30000);
}

async function loadHome() {
  const ticket = ++homeTicket;
  try {
    const res = await fetch(`/api/home?mode=${state.mode}&days=${state.days}&teams=${state.teams}`);
    const d = await res.json();
    if (ticket !== homeTicket) return;
    showBanner(d);
    if (!res.ok) {
      scheduleRefresh(d.syncing);
      if (d.syncing) return;
      throw new Error(d.error || "The dashboard could not be loaded.");
    }
    renderBest(d.bestPlayer);
    renderPlayers(d.topPlayers, d.minGames);
    renderTeams(d.topTeams, d);
    renderRecentTournaments(d.recentTournaments);
    renderUpcomingTournaments(d.upcoming.tournaments);
    renderUpcomingMatches(d.upcoming.matches);
    renderPast(d.pastMatches);
    scheduleRefresh(d.syncing);
  } catch (e) {
    if (ticket !== homeTicket) return;
    for (const id of ["best", "players", "teams", "rtourneys", "utourneys", "umatches", "past"]) panel(id, `<p class="hint err">${esc(e.message)}</p>`);
  }
}

/* ---------- tournaments: expanding rows and the full archive ---------- */

async function toggleTournament(tour) {
  const body = tour.querySelector(".tbody");
  body.hidden = !body.hidden;
  tour.querySelector(".thead").setAttribute("aria-expanded", String(!body.hidden));
  if (body.hidden || body.dataset.loaded) return;
  body.innerHTML = '<p class="hint">Loading…</p>';
  try {
    const res = await fetch(`/api/tournament?id=${encodeURIComponent(tour.dataset.id)}&mode=${tour.dataset.mode}`);
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || "Tournament unavailable");
    body.innerHTML = d.series.slice().reverse().map(s => `<div class="ser"><span class="sn">${esc(s.a)} <b>${s.wa}–${s.wb}</b> ${esc(s.b)}${s.name ? `<em>${esc(s.name)}</em>` : ""}</span><span class="games">${gamePills(s.games)}</span></div>`).join("") || '<p class="hint">No series recorded.</p>';
    body.dataset.loaded = "1";
  } catch (e) {
    body.innerHTML = `<p class="hint err">${esc(e.message)}</p>`;
  }
}

async function loadArchive() {
  const ticket = ++archiveTicket;
  const box = $("archive");
  try {
    const res = await fetch(`/api/tournaments?mode=${state.mode}`);
    const d = await res.json();
    if (ticket !== archiveTicket) return;
    if (!res.ok) { box.innerHTML = d.syncing ? empty("The archive fills in while the match history is collected.") : `<p class="hint err">${esc(d.error || "Tournaments unavailable")}</p>`; return; }
    if (!d.tournaments.length) { box.innerHTML = empty("No tournaments for this mode yet."); return; }
    let html = "", year = null;
    for (const t of d.tournaments) {
      if (t.year !== year) {
        if (year !== null) html += "</div>";
        year = t.year;
        html += `<h3 class="yr">${t.year}</h3><div class="tlist">`;
      }
      html += tourRow(t);
    }
    box.innerHTML = html + "</div>";
  } catch (e) {
    if (ticket === archiveTicket) box.innerHTML = `<p class="hint err">${esc(e.message)}</p>`;
  }
}

/* ---------- team games (click a team) ---------- */

async function toggleTeamGames(article) {
  const head = article.querySelector(".team-head");
  const box = article.querySelector(".tgames");
  box.hidden = !box.hidden;
  head.setAttribute("aria-expanded", String(!box.hidden));
  if (box.hidden || box.dataset.loaded) return;
  box.innerHTML = '<p class="hint">Loading…</p>';
  try {
    const res = await fetch(`/api/team-games?mode=${state.mode}&days=${state.days}&team=${encodeURIComponent(article.dataset.team)}`);
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || "Games unavailable");
    const pills = d.games.map(g => `<button class="game ${g.gf > g.ga ? "w" : "l"}" data-id="${esc(g.id)}" title="${dateOf(g.t)}">${g.gf}–${g.ga} vs ${esc(g.opp)}</button>`).join("");
    box.innerHTML = `<div class="games">${pills || '<span class="hint">No games in this period.</span>'}</div>`;
    box.dataset.loaded = "1";
  } catch (e) {
    box.innerHTML = `<p class="hint err">${esc(e.message)}</p>`;
  }
}

/* ---------- wiring ---------- */

function refresh() {
  loadHome();
  loadArchive();
}

function syncPeriodLabels() {
  document.querySelectorAll("[data-period]").forEach(el => { el.textContent = PERIOD_LABEL[state.days]; });
}

function choose(group, button) {
  [...group.children].forEach(c => c.classList.toggle("on", c === button));
}

$("modes").onclick = e => {
  const b = e.target.closest("button");
  if (!b) return;
  choose($("modes"), b);
  state.mode = Number(b.dataset.mode);
  refresh();
};

$("period").onclick = e => {
  const b = e.target.closest("button");
  if (!b) return;
  choose($("period"), b);
  state.days = Number(b.dataset.days);
  syncPeriodLabels();
  loadHome();
};

document.addEventListener("click", e => {
  const game = e.target.closest(".game");
  if (game && game.dataset.id) return openMatch(game.dataset.id);
  const more = e.target.closest("[data-more]");
  if (more) {
    state.teams = state.teams < 15 ? 15 : 5;
    return loadHome();
  }
  const head = e.target.closest(".thead");
  if (head) return toggleTournament(head.parentElement);
  const teamHead = e.target.closest(".team-head");
  if (teamHead) toggleTeamGames(teamHead.parentElement);
});

$("dlg-x").onclick = () => $("dlg").close();
$("dlg").addEventListener("click", e => { if (e.target === $("dlg")) $("dlg").close(); });

fetch("/api/config").then(r => r.json()).then(c => {
  if (c.siteName) {
    $("site-name").textContent = c.siteName;
    document.title = c.siteName;
  }
}).catch(() => {});

syncPeriodLabels();
refresh();
