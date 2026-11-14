// Copyright (c) 2026 Claude St-Jean. All rights reserved.

// Parseur/serialiseur de paroles synchronisees (LRC + SRT) pour ChordFlow.
// Format commun interne : LyricLine { time: number (secondes), text: string }.
// LRC : "[mm:ss.xx] texte" (une ligne par entree, metadonnees [ti:...] ignorees).
// SRT : blocs numerotes avec "hh:mm:ss,mmm --> hh:mm:ss,mmm" puis le texte.

export interface LyricLine {
  time: number; // secondes
  text: string;
}

// ---------- Detection ----------
export function detectLyricsFormat(text: string): "lrc" | "srt" | "unknown" {
  const t = text.trim();
  if (!t) return "unknown";
  // SRT : presence d'un bloc "00:00:00,000 --> 00:00:00,000"
  if (/\d{1,2}:\d{2}:\d{2}[,.]\d{2,3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{2,3}/.test(t)) {
    return "srt";
  }
  // LRC : presence de "[mm:ss.xx]"
  if (/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/.test(t)) {
    return "lrc";
  }
  return "unknown";
}

// ---------- Parse LRC ----------
function parseLrcTime(tag: string): number | null {
  // [mm:ss.xx] ou [mm:ss.xxx] ou [mm:ss]
  const m = tag.match(/^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]$/);
  if (!m) return null;
  const mm = parseInt(m[1], 10);
  const ss = parseInt(m[2], 10);
  let frac = 0;
  if (m[3]) {
    const f = m[3];
    // 2 chiffres = centiemes, 3 = milliemes
    frac = f.length === 3 ? parseInt(f, 10) / 1000 : parseInt(f, 10) / 100;
  }
  return mm * 60 + ss + frac;
}

export function parseLRC(text: string): LyricLine[] {
  const out: LyricLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // Metadonnees [ti:...], [ar:...] etc. : on ignore.
    if (/^\[[a-zA-Z]+:/.test(line) && !/^\[\d/.test(line)) continue;
    // Une ligne peut porter plusieurs tags : [00:12.00][00:13.00] texte
    const tags = line.match(/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/g);
    if (!tags) continue;
    const textPart = line.replace(/\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/g, "").trim();
    for (const tag of tags) {
      const t = parseLrcTime(tag);
      if (t === null) continue;
      out.push({ time: t, text: textPart });
    }
  }
  // tri par temps pour securite
  out.sort((a, b) => a.time - b.time);
  return out;
}

// ---------- Parse SRT ----------
function parseSrtTime(tag: string): number | null {
  // hh:mm:ss,mmm ou hh:mm:ss.mmm
  const m = tag.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{2,3})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const ss = parseInt(m[3], 10);
  const ms = parseInt(m[4].padEnd(3, "0"), 10);
  return h * 3600 + mm * 60 + ss + ms / 1000;
}

export function parseSRT(text: string): LyricLine[] {
  const out: LyricLine[] = [];
  // Blocs separes par une ligne vide
  const blocks = text.trim().split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const lines = block.trim().split(/\r?\n/);
    if (lines.length < 2) continue;
    // Ligne de temps : "00:00:01,000 --> 00:00:04,000"
    const timeLine = lines.find((l) => /-->/.test(l));
    if (!timeLine) continue;
    const m = timeLine.match(/(\d{1,2}:\d{2}:\d{2}[,.]\d{2,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{2,3})/);
    if (!m) continue;
    const start = parseSrtTime(m[1]);
    if (start === null) continue;
    // Texte = toutes les lignes apres la ligne de temps (ignore le numero de bloc)
    const timeIdx = lines.indexOf(timeLine);
    const textLines = lines.slice(timeIdx + 1).map((l) => l.trim()).filter(Boolean);
    const text = textLines.join(" ").trim();
    if (!text) continue;
    out.push({ time: start, text });
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

// ---------- Parse auto ----------
export function parseLyrics(text: string): LyricLine[] {
  const fmt = detectLyricsFormat(text);
  if (fmt === "srt") return parseSRT(text);
  if (fmt === "lrc") return parseLRC(text);
  // Tente LRC puis SRT
  const lrc = parseLRC(text);
  if (lrc.length > 0) return lrc;
  return parseSRT(text);
}

// ---------- Serialisation ----------
export function toLRC(lines: LyricLine[]): string {
  return lines
    .map((l) => {
      const mm = Math.floor(l.time / 60);
      const ss = Math.floor(l.time % 60);
      const cs = Math.round((l.time - Math.floor(l.time)) * 100);
      const tag = `[${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(cs).padStart(2, "0")}]`;
      return `${tag} ${l.text}`.trim();
    })
    .join("\n");
}

export function toSRT(lines: LyricLine[]): string {
  // Duree par defaut d'une ligne : jusqu'a la suivante, min 1 s, max 5 s.
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i];
    const next = lines[i + 1];
    let end = next ? next.time : cur.time + 3;
    end = Math.max(end, cur.time + 0.5);
    end = Math.min(end, cur.time + 6);
    out.push(String(i + 1));
    out.push(`${formatSrtTime(cur.time)} --> ${formatSrtTime(end)}`);
    out.push(cur.text);
    out.push("");
  }
  return out.join("\n").trim() + "\n";
}

function formatSrtTime(t: number): string {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const ms = Math.round((t - Math.floor(t)) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

// ---------- Helpers ----------
// Convertit un tableau de LyricLine en format LRC pour stockage dans officialSynced.
export function linesToOfficialSynced(lines: LyricLine[]): string {
  return toLRC(lines);
}

// Convertit officialSynced (LRC) en LyricLine[].
export function officialSyncedToLines(text: string | null | undefined): LyricLine[] {
  if (!text) return [];
  return parseLRC(text);
}
