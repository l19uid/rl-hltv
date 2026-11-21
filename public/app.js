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

async function loadReplays(groupId) {
  notify("Loading series…");
  try {
    const data = await api.get(`replays?group=${groupId}&sort-by=replay-date&sort-dir=desc&count=20`);
    const list = data.list || [];
    $("replays").innerHTML = list.map(r => `<button class="row" data-id="${esc(r.id)}">
      <span>${esc(r.blue?.name || "Blue")}</span><span class="s">${r.blue?.goals ?? "–"} : ${r.orange?.goals ?? "–"}</span><span class="a">${esc(r.orange?.name || "Orange")}</span></button>`).join("");
    notify(list.length ? "" : "No replays in this group.");
    if (list[0]) showReplay(list[0].id);
  } catch (e) { notify(e.message, true); }
}

async function loadGroups() {
  try {
    const cfg = await (await fetch("/api/config")).json();
    if (!cfg.hasToken) return notify("Server has no ballchasing token configured — only replay upload is available.", true);
    const data = await api.get(`groups?creator=${cfg.creator}&sort-by=created&sort-dir=desc&count=12`);
    $("groups").innerHTML = (data.list || []).map(g => `<button data-id="${esc(g.id)}">${esc(g.name)}</button>`).join("");
    const first = $("groups").firstElementChild;
    if (first) { first.classList.add("on"); loadReplays(first.dataset.id); }
    else notify("No groups found.");
  } catch (e) { notify(e.message, true); }
}

$("groups").onclick = e => {
  const b = e.target.closest("button");
  if (!b) return;
  [...$("groups").children].forEach(c => c.classList.toggle("on", c === b));
  loadReplays(b.dataset.id);
};
$("replays").onclick = e => {
  const b = e.target.closest(".row");
  if (b) showReplay(b.dataset.id);
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

loadGroups();
