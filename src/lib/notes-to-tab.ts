// Convertisseur « partition → tablature ASCII ».
// Prend une suite de notes absolues (hauteur MIDI + positions/durées en ticks,
// 480 ticks = 1 temps, mesure = 1920 ticks = 4/4), place chaque hauteur sur une
// corde de guitare accordée standard (mi grave 40 → mi aigu 64) en optimisant
// le manche (frettes basses, enchaînement fluide), puis rend une tablature au
// format export Guitar Pro / Songsterr (6 rangées e aiguë → mi grave, barres
// `|`, liaisons `l` pour les durées réelles) : directement compatible avec
// asciiTabToMidi (conversion en MIDI jouable). Pur : aucun import.

export interface TabNoteEvent {
  pitch: number;
  startTick: number;
  durationTicks: number;
}

export interface NotesToTabOptions {
  title?: string;
  bpm?: number;
}

export interface NotesToTabResult {
  tab: string;
  measures: number;
  noteCount: number;
  chordCount: number;
  dropped: number;
  outOfRange: number[];
}

// Corde 0 (rangée du haut) = mi aigu (64). Voir ascii-tab-midi (OPEN_NOTES).
const OPEN_NOTES = [64, 59, 55, 50, 45, 40];
const MAX_FRET = 24;
const TICKS_PER_BEAT = 480;
const BAR_TICKS = 4 * TICKS_PER_BEAT; // 1920 (4/4)
// Unités exprimables par le parseur (max 24 arcs : au-delà, unit < 60 km/h... er, ticks).
const LADDER = [
  { unit: 480, slots: 4 },
  { unit: 240, slots: 8 },
  { unit: 160, slots: 12 },
  { unit: 120, slots: 16 },
  { unit: 80, slots: 24 },
];

interface Column {
  startTick: number;
  pitches: number[];
}

interface Assignment {
  strings: number[];
  frets: number[];
  pitches: number[];
}

function tuneGrid(rels: number[]): { unit: number; slots: number } {
  let best = LADDER[0];
  let bestErr = Infinity;
  for (const cand of LADDER) {
    let err = 0;
    for (const rel of rels) {
      const slot = Math.round(rel / cand.unit);
      err += Math.abs(rel - slot * cand.unit);
    }
    if (err < bestErr - 1e-6) {
      bestErr = err;
      best = cand;
    }
  }
  return best;
}

function colCost(a: Assignment): number {
  let cost = 0;
  const fretted: number[] = [];
  for (let i = 0; i < a.frets.length; i++) {
    const f = a.frets[i];
    cost += f;
    if (f > 0) {
      cost += 0.6;
      fretted.push(f);
    }
  }
  if (fretted.length >= 2) {
    const span = Math.max(...fretted) - Math.min(...fretted);
    cost += Math.max(0, span - 2) * 1.5 + Math.max(0, span - 4) * 5;
  }
  return cost;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function transitionCost(prev: Assignment | null, a: Assignment): number {
  if (!prev) return 0;
  const prevPos = new Map<number, string>();
  for (let i = 0; i < prev.pitches.length; i++) {
    prevPos.set(prev.pitches[i], `${prev.strings[i]}:${prev.frets[i]}`);
  }
  let cost = Math.abs(median(a.frets.filter((f) => f > 0)) - median(prev.frets.filter((f) => f > 0))) * 0.35;
  for (let i = 0; i < a.pitches.length; i++) {
    const key = `${a.strings[i]}:${a.frets[i]}`;
    if (prevPos.get(a.pitches[i]) === key) cost -= 1.4;
    else if (prevPos.has(a.pitches[i])) cost += 0.5;
  }
  return cost;
}

function enumerateAssignments(pitches: number[]): Assignment[] {
  const openLow = OPEN_NOTES[OPEN_NOTES.length - 1];
  const openHigh = OPEN_NOTES[0];
  if (pitches.some((p) => p < openLow || p > openHigh + MAX_FRET)) return [];
  const out: Assignment[] = [];
  const cur: { string: number; fret: number }[] = [];
  const used = new Set<number>();
  const recurse = (i: number) => {
    if (i === pitches.length) {
      out.push({
        strings: cur.map((c) => c.string),
        frets: cur.map((c) => c.fret),
        pitches: [...pitches],
      });
      return;
    }
    const pitch = pitches[i];
    for (let s = 0; s < 6; s++) {
      if (used.has(s)) continue;
      const fret = pitch - OPEN_NOTES[s];
      if (fret < 0 || fret > MAX_FRET) continue;
      cur.push({ string: s, fret });
      used.add(s);
      recurse(i + 1);
      used.delete(s);
      cur.pop();
    }
  };
  recurse(0);
  return out;
}

// Test du manche pour une portée à plus de 6 hauteurs (claviers) : on garde la
// fenêtre de 6 hauteurs la plus serrée ; le reste est compté comme rejeté.
function pickColumn(pitches: number[]): { keep: number[]; outOfRange: number[] } {
  const openLow = OPEN_NOTES[OPEN_NOTES.length - 1];
  const openHigh = OPEN_NOTES[0];
  const outOfRange = pitches.filter((p) => p < openLow || p > openHigh + MAX_FRET);
  let keep = pitches.filter((p) => p >= openLow && p <= openHigh + MAX_FRET);
  while (keep.length > 6) {
    let bestIdx = 0;
    let bestSpan = Infinity;
    for (let i = 0; i + 6 <= keep.length; i++) {
      const span = keep[i + 5] - keep[i];
      if (span < bestSpan) {
        bestSpan = span;
        bestIdx = i;
      }
    }
    keep = keep.slice(bestIdx, bestIdx + 6);
  }
  return { keep, outOfRange };
}

function groupColumns(events: TabNoteEvent[]): {
  columns: Column[];
  dropped: number;
  noteCount: number;
  outOfRange: number[];
} {
  const byStart = new Map<number, number[]>();
  const droppedSet = new Set<number>();
  let noteCount = 0;
  for (const ev of events) {
    if (!Number.isFinite(ev.pitch) || ev.durationTicks <= 0) continue;
    noteCount++;
    const list = byStart.get(ev.startTick) ?? [];
    list.push(ev.pitch);
    byStart.set(ev.startTick, list);
  }
  const columns: Column[] = [];
  const seen = new Set<number>();
  for (const [startTick, raw] of [...byStart.entries()].sort((a, b) => a[0] - b[0])) {
    const { keep, outOfRange } = pickColumn(raw);
    for (const p of outOfRange) if (!seen.has(p)) {
      seen.add(p);
      droppedSet.add(p);
    }
    columns.push({ startTick, pitches: [...keep] });
  }
  return {
    columns,
    dropped: droppedSet.size,
    noteCount,
    outOfRange: [...droppedSet].sort((a, b) => a - b),
  };
}

const KEEP_BEAM = 6;

function planFrets(columns: Column[]): (Assignment | null)[] {
  const chosen: (Assignment | null)[] = [];
  let prevTop: { cost: number; assign: Assignment }[] = [];
  for (const col of columns) {
    const cands = enumerateAssignments([...col.pitches].sort((a, b) => a - b));
    const top: { cost: number; assign: Assignment }[] = [];
    for (const cand of cands) {
      let bestPrev = 0;
      if (prevTop.length > 0) {
        for (const p of prevTop) {
          const t = p.cost + transitionCost(p.assign, cand);
          if (t < bestPrev || bestPrev === 0) bestPrev = t;
        }
      }
      top.push({ cost: colCost(cand) + bestPrev, assign: cand });
    }
    top.sort((a, b) => a.cost - b.cost);
    if (top.length > KEEP_BEAM) top.length = KEEP_BEAM;
    if (top.length > 0) {
      chosen.push(top[0].assign);
      prevTop = top;
    } else {
      chosen.push(null);
      prevTop = [];
    }
  }
  return chosen;
}

// Chaque slot porte un token de LARGEUR NETTOYÉE uniforme (3 caractères) : le
// parseur retire les espaces pour mesurer les colonnes, donc « - 0- », « - 3l »
// et « -x- » (3 caractères une fois nettoyés) conservent l'alignement des barres
// de mesures — des largeurs inégales fabriqueraient de fausses mesures. Les
// cordes non jouées sont des `x` (étouffées : sans hauteur → aucun événement MIDI).
const MUTE = "-x-";
function noteFor(fret: number): string {
  return `-${String(fret).padStart(2, " ")}-`;
}
function tieFor(fret: number): string {
  return `-${String(fret).padStart(2, " ")}l`;
}

function renderMeasure(
  entries: { slot: number; assign: Assignment; durations: TabNoteEvent[] }[],
  unit: number,
  slots: number
): string[] {
  // Chaque slot porte un token (le parseur ignore les cellules vides : un token
  // ne resterait pas aligné sur sa colonne). Les cordes non jouées sont des `x`
  // (étouffé : sans hauteur → aucun événement MIDI, juste un remplissage).
  const grid: string[][] = Array.from({ length: 6 }, () => Array(slots).fill(MUTE));
  for (const { slot, assign } of entries) {
    if (slot >= slots || slot < 0) continue;
    for (let i = 0; i < assign.pitches.length; i++) {
      grid[assign.strings[i]][slot] = noteFor(assign.frets[i]);
    }
  }

  // Liaisons `l` : étend chaque note sur sa durée réelle, tant que sa corde est
  // libre (une ré-attaque plus tardive sur la même corde coupe la tenue).
  const spans: { row: number; fret: number; slot: number; endSlot: number }[] = [];
  for (const { slot, assign, durations } of entries) {
    const durByPitch = new Map<number, number>();
    for (const d of durations) durByPitch.set(d.pitch, (durByPitch.get(d.pitch) ?? 0) + d.durationTicks);
    for (let i = 0; i < assign.pitches.length; i++) {
const dur = durByPitch.get(assign.pitches[i]);
    if (!dur || dur <= 0) continue;
    const endSlot = Math.min(slots, slot + Math.max(1, Math.ceil(dur / unit)));
    // Liaison seulement si la note occupe 2 slots ou plus (un token `l` sur une
    // attaque de 1 slot créerait une fausse tenue avec la mesure précédente).
    if (endSlot <= slot + 1) continue;
    spans.push({
      row: assign.strings[i],
      fret: assign.frets[i],
      slot,
      endSlot,
    });
    }
  }
  spans.sort((a, b) => a.slot - b.slot || a.row - b.row);
  for (const span of spans) {
    for (let k = span.slot; k < span.endSlot; k++) {
      const cur = grid[span.row][k];
      // Le token d'attaque (déjà écrit) et chaque prolongement portent `l` :
      // le parseur relie un token `l` au précédent de même case.
      if (cur === MUTE || cur === noteFor(span.fret)) grid[span.row][k] = tieFor(span.fret);
      else break;
    }
  }

  const rows: string[] = [];
  for (let r = 0; r < 6; r++) {
    let line = "";
    for (let s = 0; s < slots; s++) line += grid[r][s] ?? "-  ";
    rows.push(line);
  }
  return rows;
}

export function notesToTab(events: TabNoteEvent[], options: NotesToTabOptions = {}): NotesToTabResult {
  const sorted = [...events].sort(
    (a, b) => a.startTick - b.startTick || a.durationTicks - b.durationTicks
  );
  const { columns, dropped, noteCount, outOfRange } = groupColumns(sorted);
  const assignments = planFrets(columns);

  let chordCount = 0;
  for (let i = 0; i < columns.length; i++) {
    const a = assignments[i];
    if (a && a.pitches.length > 1) chordCount++;
  }

  if (columns.length === 0) {
    return { tab: "", measures: 0, noteCount, chordCount, dropped, outOfRange };
  }

  const bpm = Math.min(400, Math.max(20, options.bpm ?? 120));
  const byMeasure = new Map<number, Column[]>();
  for (const col of columns) {
    const mb = Math.floor(col.startTick / BAR_TICKS);
    const list = byMeasure.get(mb) ?? [];
    list.push(col);
    byMeasure.set(mb, list);
  }

  const durByStart = new Map<number, TabNoteEvent[]>();
  for (const ev of sorted) {
    const list = durByStart.get(ev.startTick) ?? [];
    list.push(ev);
    durByStart.set(ev.startTick, list);
  }

  const rendered: string[][] = [];
  let gi = 0;
  const maxMb = Math.floor(Math.max(...columns.map((c) => c.startTick)) / BAR_TICKS);
  for (let mb = 0; mb <= maxMb; mb++) {
    const cols = byMeasure.get(mb) ?? [];
    if (cols.length === 0) {
      rendered.push(Array(6).fill(Array(4).fill(MUTE).join("")));
      continue;
    }
    const rels = cols.map((c) => c.startTick - mb * BAR_TICKS);
    const { unit, slots } = tuneGrid(rels);
    const entries = cols.map((col) => ({
      slot: Math.round((col.startTick - mb * BAR_TICKS) / unit),
      assign: assignments[gi++] ?? { strings: [], frets: [], pitches: [] },
      durations: durByStart.get(col.startTick) ?? [],
    }));
    rendered.push(renderMeasure(entries, unit, slots));
  }

  // Portées de 4 mesures ; si la portée finale n'a qu'une mesure, on la double
  // d'une mesure vide pour conserver un barreau `|` (le parseur exige `|`).
  const header: string[] = [];
  if (options.title) header.push(`Title: ${options.title}`);
  header.push(`Tempo: ${bpm}`);

  const lines: string[] = [...header];
  for (let i = 0; i < rendered.length; i += 4) {
    let group = rendered.slice(i, i + 4);
    if (group.length === 1) group = [...group, ...[Array(6).fill(Array(4).fill(MUTE).join(""))]];
    for (let r = 0; r < 6; r++) {
      lines.push(group.map((m) => m[r]).join("|"));
    }
    lines.push("");
  }

  return {
    tab: lines.join("\n").trim(),
    measures: rendered.length,
    noteCount,
    chordCount,
    dropped,
    outOfRange,
  };
}