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

function teamTable(m, team, label, cls, mvp, showDemos) {
  const ps = m.players.filter(p => p.team === team).sort((a, b) => b.score - a.score);
  const max = Math.max(1, ...m.players.map(p => p.score));
  const heads = ["Score", "G", "A", "Sv", "Sh", "Sh%"].concat(showDemos ? ["Demos"] : []);
  const rows = ps.map(p => {
    const pct = p.shots ? Math.round(p.goals / p.shots * 100) + "%" : "–";
    const cells = [p.goals, p.assists, p.saves, p.shots, pct].concat(showDemos ? [p.demos ?? "–"] : []);
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
    renderMatch(fromBallchasing(await api.get("replays/" + id)));
    notify("");
  } catch (e) { notify(e.message, true); }
}

const SERIES_MAX_GAMES = 7;

function groupNode(g) {
  return `<li><details data-group="${esc(g.id)}"><summary>${esc(g.name)}</summary><ul class="kids"></ul></details></li>`;
}

function gameButtons(games) {
  return games.map(r => `<button class="game" data-id="${esc(r.id)}" title="${esc(r.blue?.name || "Blue")} vs ${esc(r.orange?.name || "Orange")}">${r.blue?.goals ?? "–"}–${r.orange?.goals ?? "–"}</button>`).join("");
}

async function fetchGames(id, count) {
  return (await api.get(`replays?group=${id}&sort-by=replay-date&sort-dir=asc&count=${count}`)).list || [];
}

async function resolveChild(li) {
  const id = li.dataset.group;
  try {
    const games = await fetchGames(id, SERIES_MAX_GAMES + 1);
    if (games.length > SERIES_MAX_GAMES) {
      const name = li.querySelector(".sname").innerHTML;
      li.className = "";
      li.innerHTML = `<details data-group="${esc(id)}"><summary>${name}</summary><ul class="kids"></ul></details>`;
    } else {
      li.querySelector(".games").innerHTML = games.length ? gameButtons(games) : '<span class="hint">no replays</span>';
    }
  } catch (e) {
    li.querySelector(".games").innerHTML = `<span class="hint err">${esc(e.message)}</span>`;
  }
}

async function fillGroup(details) {
  if (details.dataset.loaded) return;
  details.dataset.loaded = "1";
  const ul = details.querySelector(".kids");
  ul.innerHTML = '<li class="hint">Loading…</li>';
  const id = details.dataset.group;
  try {
    const kids = (await api.get(`groups?group=${id}&sort-by=created&sort-dir=desc&count=50`)).list || [];
    if (!kids.length) {
      const games = await fetchGames(id, 50);
      ul.innerHTML = games.length ? `<li class="series"><span class="games">${gameButtons(games)}</span></li>` : '<li class="hint">No replays.</li>';
      return;
    }
    ul.innerHTML = kids.map(g => `<li class="series" data-group="${esc(g.id)}"><span class="sname">${esc(g.name)}</span><span class="games"><span class="hint">…</span></span></li>`).join("");
    for (const li of [...ul.children]) await resolveChild(li);
  } catch (e) {
    delete details.dataset.loaded;
    ul.innerHTML = `<li class="hint err">${esc(e.message)}</li>`;
  }
}

const yearOf = g => (g.created || "").slice(0, 4) || (g.name.match(/20\d\d/) || ["Other"])[0];
let groupsByYear = {};

function showYear(year) {
  [...$("years").children].forEach(b => b.classList.toggle("on", b.dataset.year === year));
  $("tree").innerHTML = `<ul>${groupsByYear[year].map(groupNode).join("")}</ul>`;
}

async function loadTree() {
  try {
    const cfg = await (await fetch("/api/config")).json();
    if (!cfg.hasToken) return notify("Server has no ballchasing token configured — only replay upload is available.", true);
    const list = (await api.get(`groups?creator=${cfg.creator}&sort-by=created&sort-dir=desc&count=50`)).list || [];
    if (!list.length) return notify("No groups found.");
    groupsByYear = {};
    list.forEach(g => (groupsByYear[yearOf(g)] ||= []).push(g));
    const years = Object.keys(groupsByYear).sort().reverse();
    $("years").innerHTML = years.map(y => `<button data-year="${esc(y)}">${esc(y)}</button>`).join("");
    showYear(years[0]);
  } catch (e) { notify(e.message, true); }
}

$("years").onclick = e => {
  const b = e.target.closest("button");
  if (b) showYear(b.dataset.year);
};

$("tree").addEventListener("toggle", e => {
  if (e.target.open && e.target.dataset.group) fillGroup(e.target);
}, true);

$("tree").onclick = e => {
  const b = e.target.closest(".game");
  if (!b) return;
  $("tree").querySelectorAll(".game.on").forEach(x => x.classList.remove("on"));
  b.classList.add("on");
  showReplay(b.dataset.id).then(() => $("out").scrollIntoView({ behavior: "smooth", block: "start" }));
};

let rankingRequest = 0;
let rankState = { days: 30, limit: 10 };

async function loadRanking() {
  const ticket = ++rankingRequest;
  const body = $("rankbody");
  $("teamgames").innerHTML = "";
  try {
    const res = await fetch(`/api/rankings?days=${rankState.days}&limit=${rankState.limit}`);
    const d = await res.json();
    if (ticket !== rankingRequest) return;
    if (!res.ok) throw new Error(d.error || "Rankings unavailable");
    const rows = d.teams.map((t, i) => {
      const pct = Math.round(t.winRate * 100);
      return `<button class="rrow" data-team="${esc(t.name)}"><span class="rk">${i + 1}</span><span class="rn">${esc(t.name)}</span><span class="rg">${t.wins}–${t.games - t.wins}</span><span class="wr"><i style="width:${pct}%"></i><b>${pct}%</b></span></button>`;
    }).join("");
    const more = rankState.limit < 50 ? '<button id="more">Show top 50</button>' : '<button id="more">Show top 10</button>';
    const updated = d.updatedAt ? ` · updated ${esc(d.updatedAt.slice(0, 10))}` : "";
    body.innerHTML = (rows || '<p class="hint">Not enough games in this period.</p>') +
      `<p class="hint">Minimum ${d.minGames} games${updated} · click a team for its games</p>${more}`;
  } catch (e) {
    if (ticket === rankingRequest) body.innerHTML = `<p class="hint err">${esc(e.message)}</p>`;
  }
}

async function loadTeamGames(team) {
  const box = $("teamgames");
  box.innerHTML = '<p class="hint">Loading…</p>';
  try {
    const res = await fetch(`/api/team-games?days=${rankState.days}&team=${encodeURIComponent(team)}`);
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || "Games unavailable");
    const pills = d.games.map(g => `<button class="game ${g.gf > g.ga ? "w" : "l"}" data-id="${esc(g.id)}" title="${esc(new Date(g.t).toISOString().slice(0, 10))}">${g.gf}–${g.ga} vs ${esc(g.opp)}</button>`).join("");
    box.innerHTML = `<div class="tg"><b>${esc(team)}</b><div class="games">${pills || '<span class="hint">No games.</span>'}</div></div>`;
  } catch (e) {
    box.innerHTML = `<p class="hint err">${esc(e.message)}</p>`;
  }
}

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
  if (!b) return;
  $("teamgames").querySelectorAll(".game.on").forEach(x => x.classList.remove("on"));
  b.classList.add("on");
  showReplay(b.dataset.id).then(() => $("out").scrollIntoView({ behavior: "smooth", block: "start" }));
};

$("period").onclick = e => {
  const b = e.target.closest("button");
  if (!b) return;
  [...$("period").children].forEach(c => c.classList.toggle("on", c === b));
  rankState.days = Number(b.dataset.days);
  loadRanking();
};

document.querySelector(".tabs").onclick = e => {
  const b = e.target.closest("button");
  if (!b) return;
  document.querySelectorAll(".tabs button").forEach(t => t.classList.toggle("on", t === b));
  $("pro").hidden = b.dataset.tab !== "pro";
  $("upload").hidden = b.dataset.tab !== "upload";
};

function loadFile(file) {
  file.arrayBuffer().then(buf => {
    try { renderMatch(parseReplayFile(buf)); notify(""); } catch (e) { notify(e.message, true); }
  });
}
const drop = $("drop"), input = $("file");
$("pick").onclick = () => input.click();
input.onchange = () => input.files[0] && loadFile(input.files[0]);
drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
drop.ondragleave = () => drop.classList.remove("over");
drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); e.dataTransfer.files[0] && loadFile(e.dataTransfer.files[0]); };

loadTree();
loadRanking();
