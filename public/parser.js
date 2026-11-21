class Reader {
  constructor(buf) { this.d = new DataView(buf); this.b = new Uint8Array(buf); this.p = 0; }
  u8() { return this.d.getUint8(this.p++); }
  i32() { const v = this.d.getInt32(this.p, true); this.p += 4; return v; }
  u32() { const v = this.d.getUint32(this.p, true); this.p += 4; return v; }
  f32() { const v = this.d.getFloat32(this.p, true); this.p += 4; return v; }
  u64() { const lo = this.u32(), hi = this.u32(); return lo + hi * 4294967296; }
  str() {
    let n = this.i32();
    if (!n) return "";
    if (n > 0) {
      const s = new TextDecoder("windows-1252").decode(this.b.subarray(this.p, this.p + n - 1));
      this.p += n;
      return s;
    }
    n = -n;
    const s = new TextDecoder("utf-16le").decode(this.b.subarray(this.p, this.p + n * 2 - 2));
    this.p += n * 2;
    return s;
  }
}

function readValue(r, kind, size) {
  switch (kind) {
    case "IntProperty": return r.i32();
    case "FloatProperty": return r.f32();
    case "StrProperty": case "NameProperty": return r.str();
    case "QWordProperty": return r.u64();
    case "BoolProperty": return !!r.u8();
    case "ByteProperty": { const e = r.str(); return e === "None" ? null : r.str(); }
    case "ArrayProperty": { const n = r.u32(), a = []; for (let i = 0; i < n; i++) a.push(readDict(r)); return a; }
    default: r.p += Number(size); return null;
  }
}

function readDict(r) {
  const o = {};
  for (;;) {
    const k = r.str();
    if (k === "None" || k === "") return o;
    const kind = r.str(), size = r.u64();
    o[k] = readValue(r, kind, size);
  }
}

function parseReplayFile(buf) {
  const r = new Reader(buf);
  try {
    const size = r.u32(); r.u32();
    const major = r.u32(), minor = r.u32();
    if (major > 865 && minor > 17) r.u32();
    if (!r.str().includes("Replay")) throw 0;
    const p = readDict(r);
    if (r.p > size + 8) throw 0;
    return {
      map: p.MapName || "", type: p.MatchType || "", size: p.TeamSize || 0, date: p.Date || "", secs: p.TotalSecondsPlayed ?? null,
      blueName: "Blue", orangeName: "Orange", blue: p.Team0Score || 0, orange: p.Team1Score || 0,
      players: (p.PlayerStats || []).map(x => ({
        name: x.Name || "?", team: x.Team || 0, platform: (x.Platform || "").replace("OnlinePlatform_", ""),
        score: x.Score || 0, goals: x.Goals || 0, assists: x.Assists || 0, saves: x.Saves || 0, shots: x.Shots || 0, demos: null,
      })),
    };
  } catch {
    throw new Error("This doesn’t look like a valid Rocket League replay file.");
  }
}
