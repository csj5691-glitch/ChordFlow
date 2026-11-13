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
  // Silence : `pitch` est ignoré, la note occupe la durée et sera rendue comme
  // un silence (pas de case de manche).
  rest?: boolean;
  // Corde imposée (0 = mi aigu, convention OPEN_NOTES) : la note reste sur cette
  // corde même si l'optimiseur du manche la déplacerait. Sert à garder la cible
  // (et la source) d'un hammer-on / pull-off sur la MÊME corde.
  preferString?: number;
  // Slide de la note : « / » vers l'aigu, « \ » vers le grave (visuel portée).
  slide?: "/" | "\\";
}

export interface NotesToTabOptions {
  title?: string;
  bpm?: number;
  // Tick absolu (dans la chanson entière) du début de la séquence fournie. Permet
  // d'aligner la numérotation des mesures sur celles de la chanson : un riff qui
  // démarre en plein milieu de la mesure 6 est bien rendu dans la mesure 6.
  originTick?: number;
  // Bornes de mesures (ticks 480/temps, même repère que les événements). Si
  // fourni, remplace la grille 4/4 fixe : indispensable pour les levées
  // (anacrusis), les changements de signature et les mesures incomplètes d'un
  // import Guitar Pro. Sans cette option, le comportement 4/4 historique est
  // conservé (diagrammes ChordFlow).
  measureTicks?: { startTick: number; durationTicks: number }[];
}

// Position d'une note dans la portée rendue (mesure, corde 0 = aiguë, colonne).
// Aligné sur ce que `TabStaffView` affiche, pour pouvoir surligner la note jouée.
export interface TabPosition {
  m: number;
  s: number;
  slot: number;
  // Slide de la note rendue : « / » = glissade vers l'aigu, « \ » = vers le grave.
  slide?: "/" | "\\";
}

// Silence rendu dans la portée : mesure + colonne + durée en temps (pour choisir
// le symbole : pause, demi-pause, soupir, demi-soupir, etc.).
export interface TabRest {
  m: number;
  slot: number;
  beats: number;
}

export interface NotesToTabResult {
  tab: string;
  measures: number;
  noteCount: number;
  chordCount: number;
  dropped: number;
  outOfRange: number[];
  positions: TabPosition[][];
  rests: TabRest[];
  // Grille rythmique retenue par mesure (ticks par colonne + nombre de colonnes)
  // et valeur (en temps) de chaque attaque : sert à dessiner la réglette des temps
  // (1 2 3 4) et les glyphes de valeur de note sous la portée.
  grid: { unit: number; slots: number; notes: { slot: number; beats: number }[] }[];
  // N° (0-based) de la première mesure rendue dans la chanson entière : 0 si la
  // séquence part du début, sinon le décalage fourni via `originTick`.
  measureOffset: number;
}

// Corde 0 (rangée du haut) = mi aigu (64). Voir ascii-tab-midi (OPEN_NOTES).
const OPEN_NOTES = [64, 59, 55, 50, 45, 40];
const MAX_FRET = 24;
// Écart maximal de la main : 4 doigts couvrent 4 cases consécutives, donc
// l'écart entre la case frettée la plus grave et la plus aiguë doit rester
// <= 3. Les cordes à vide (case 0) ne comptent pas (aucun doigt).
const MAX_FRET_SPAN = 3;

function frettedSpan(frets: number[]): number {
  let min = Infinity;
  let max = -Infinity;
  for (const f of frets) {
    if (f > 0) {
      if (f < min) min = f;
      if (f > max) max = f;
    }
  }
  return max >= min ? max - min : 0;
}
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
  rest?: boolean;
  durationTicks?: number;
  // Hauteur MIDI → corde imposée (0 = mi aigu).
  prefers?: Map<number, number>;
  // Hauteur MIDI → direction de slide de la note.
  slides?: Map<number, "/" | "\\">;
}

interface Assignment {
  strings: number[];
  frets: number[];
  pitches: number[];
}

function tuneGrid(rels: number[], barTicks?: number): { unit: number; slots: number } {
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
  // Mesure non 4/4 (levée, 3/4, 7/8...) : le nombre de colonnes découle de la
  // durée réelle de la mesure, pas du gabarit 4/4 de l'échelle.
  if (barTicks && barTicks > 0) {
    return { unit: best.unit, slots: Math.max(1, Math.ceil(barTicks / best.unit)) };
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

function enumerateAssignments(pitches: number[], prefer?: Map<number, number>): Assignment[] {
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
    const forced = prefer?.get(pitch);
    for (let s = 0; s < 6; s++) {
      if (used.has(s)) continue;
      if (forced !== undefined && s !== forced) continue;
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
  const byStart = new Map<number, { pitches: number[]; rest: boolean; durationTicks: number; prefers: Map<number, number>; slides: Map<number, "/" | "\\"> }>();
  const droppedSet = new Set<number>();
  let noteCount = 0;
  for (const ev of events) {
    if (ev.rest) {
      byStart.set(ev.startTick, { pitches: [], rest: true, durationTicks: ev.durationTicks, prefers: new Map<number, number>(), slides: new Map<number, "/" | "\\">() });
      continue;
    }
    if (!Number.isFinite(ev.pitch) || ev.durationTicks <= 0) continue;
    noteCount++;
    const col = byStart.get(ev.startTick) ?? { pitches: [], rest: false, durationTicks: 0, prefers: new Map<number, number>(), slides: new Map<number, "/" | "\\">() };
    col.pitches.push(ev.pitch);
    if (ev.preferString !== undefined) col.prefers.set(ev.pitch, ev.preferString);
    if (ev.slide) col.slides.set(ev.pitch, ev.slide);
    byStart.set(ev.startTick, col);
  }
  const columns: Column[] = [];
  const seen = new Set<number>();
  for (const [startTick, raw] of [...byStart.entries()].sort((a, b) => a[0] - b[0])) {
    if (raw.rest) {
      columns.push({ startTick, pitches: [], rest: true, durationTicks: raw.durationTicks });
      continue;
    }
    const { keep, outOfRange } = pickColumn(raw.pitches);
    for (const p of outOfRange) if (!seen.has(p)) {
      seen.add(p);
      droppedSet.add(p);
    }
    columns.push({ startTick, pitches: [...keep], prefers: raw.prefers, slides: raw.slides });
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
    const sorted = [...col.pitches].sort((a, b) => a - b);
    // Cordes imposées (legato) d'abord ; repli sur une assignation libre.
    let cands = enumerateAssignments(sorted, col.prefers);
    if (cands.length === 0) cands = enumerateAssignments(sorted);
    // Couvrir les notes dans un écart de 4 doigts : on privilégie les positions
    // qui tiennent dans MAX_FRET_SPAN (autre corde/case pour les mêmes notes),
    // et on ne retombe sur une position plus large que si aucune ne tient.
    const tight = cands.filter((c) => frettedSpan(c.frets) <= MAX_FRET_SPAN);
    const pool = tight.length > 0 ? tight : cands;
    const top: { cost: number; assign: Assignment }[] = [];
    for (const cand of pool) {
      // Sentinelle Infinity : un coût de transition nul (0) est une valeur
      // valide et ne doit pas être écrasé par un coût supérieur.
      let bestPrev = prevTop.length > 0 ? Infinity : 0;
      for (const p of prevTop) {
        const t = p.cost + transitionCost(p.assign, cand);
        if (t < bestPrev) bestPrev = t;
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

// Convertit une durée de mesure en temps (1 temps = noire) vers une signature
// lisible par le parseur : 3 -> 3/4, 3.5 -> 7/8, 1.25 -> 5/16.
function beatsToMeter(beats: number): string {
  for (const den of [4, 8, 16]) {
    const num = Math.round((beats * den) / 4);
    if (num > 0 && Math.abs((num * 4) / den - beats) < 1e-6) return `${num}/${den}`;
  }
  return "4/4";
}

interface CarryNote {
  fret: number;
  remainingTicks: number;
}

function renderMeasure(
  entries: { slot: number; assign: Assignment; durations: TabNoteEvent[] }[],
  unit: number,
  slots: number,
  carryIn?: Map<number, CarryNote>
): { rows: string[]; carryOut: Map<number, CarryNote> } {
  // Chaque slot porte un token (le parseur ignore les cellules vides : un token
  // ne resterait pas aligné sur sa colonne). Les cordes non jouées sont des `x`
  // (étouffé : sans hauteur → aucun événement MIDI, juste un remplissage).
  const grid: string[][] = Array.from({ length: 6 }, () => Array(slots).fill(MUTE));
  // Cases qui portent une NOUVELLE attaque : une liaison ne doit jamais les
  // écraser, sinon une ré-attaque sur la même corde/case est avalée.
  const attacks = new Set<string>();
  for (const { slot, assign } of entries) {
    if (slot >= slots || slot < 0) continue;
    for (let i = 0; i < assign.pitches.length; i++) {
      grid[assign.strings[i]][slot] = noteFor(assign.frets[i]);
      attacks.add(`${assign.strings[i]}:${slot}`);
    }
  }

  // Liaison venue de la mesure précédente : on prolonge la tenue sur les
  // premiers slots, jusqu'à épuisement de la durée ou ré-attaque sur la corde.
  const carryOut = new Map<number, CarryNote>();
  if (carryIn) {
    for (const [row, carry] of carryIn) {
      const need = Math.max(1, Math.ceil(carry.remainingTicks / unit));
      const limit = Math.min(slots, need);
      let cut = false;
      for (let k = 0; k < limit; k++) {
        if (attacks.has(`${row}:${k}`)) {
          cut = true;
          break;
        }
        grid[row][k] = tieFor(carry.fret);
      }
      // La note dépasse encore la mesure : on transmet le reste à la suivante.
      if (!cut && need > slots) {
        carryOut.set(row, {
          fret: carry.fret,
          remainingTicks: carry.remainingTicks - slots * unit,
        });
      }
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
      const row = assign.strings[i];
      const fret = assign.frets[i];
      const need = Math.max(1, Math.ceil(dur / unit));
      const endSlot = Math.min(slots, slot + need);
      // La note déborde la mesure : on prépare la liaison vers la mesure
      // suivante, sauf si une ré-attaque sur la même corde la coupe avant.
      if (slot + need > slots) {
        let cut = false;
        for (let k = slot + 1; k < slots; k++) {
          if (attacks.has(`${row}:${k}`)) {
            cut = true;
            break;
          }
        }
        if (!cut) {
          carryOut.set(row, {
            fret,
            remainingTicks: dur - (slots - slot) * unit,
          });
        }
      }
      // Liaison seulement si la note occupe 2 slots ou plus (un token `l` sur une
      // attaque de 1 slot créerait une fausse tenue avec la mesure précédente).
      if (endSlot <= slot + 1) continue;
      spans.push({ row, fret, slot, endSlot });
    }
  }
  spans.sort((a, b) => a.slot - b.slot || a.row - b.row);
  for (const span of spans) {
    // L'attaque (k = slot) reste un token simple ; seuls les prolongements
    // portent `l`. Le parseur interprète `l` comme « cette note continue la
    // précédente », donc marquer l'attaque créerait une fausse liaison avec
    // une ré-attaque de même case.
    for (let k = span.slot + 1; k < span.endSlot; k++) {
      if (attacks.has(`${span.row}:${k}`)) break;
      if (grid[span.row][k] !== MUTE) break;
      grid[span.row][k] = tieFor(span.fret);
    }
  }

  const rows: string[] = [];
  for (let r = 0; r < 6; r++) {
    let line = "";
    for (let s = 0; s < slots; s++) line += grid[r][s] ?? "-  ";
    rows.push(line);
  }
  return { rows, carryOut };
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
    return { tab: "", measures: 0, noteCount, chordCount, dropped, outOfRange, positions: [], rests: [], grid: [], measureOffset: 0 };
  }

  const bpm = Math.min(400, Math.max(20, options.bpm ?? 120));
  // Alignement sur la grille de mesures de la chanson : `originTick` = tick absolu
  // du début de la séquence fournie. On le ramène au début de sa mesure ; les
  // colonnes sont donc décalées du reste (`originBase`) pour se caler pile dessus.
  const originTick = options.originTick ?? 0;
  const measureOffset = Math.floor(originTick / BAR_TICKS);
  const originBase = originTick - measureOffset * BAR_TICKS;
  const customMeasures =
    options.measureTicks && options.measureTicks.length > 0 ? options.measureTicks : null;
  // Indice de la mesure contenant un tick (repère de la séquence fournie).
  const measureIndexForTick = (tick: number): number => {
    if (!customMeasures) return Math.floor((tick + originBase) / BAR_TICKS);
    let lo = 0;
    let hi = customMeasures.length - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (customMeasures[mid].startTick <= tick) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return ans;
  };
  const byMeasure = new Map<number, Column[]>();
  for (const col of columns) {
    const mb = measureIndexForTick(col.startTick);
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
  const positions: TabPosition[][] = [];
  const rests: TabRest[] = [];
  const grid: { unit: number; slots: number; notes: { slot: number; beats: number }[] }[] = [];
  // Durée (en temps) de chaque mesure rendue : sérialisée dans l'en-tête
  // `Meters:` pour que le parseur ASCII restitue les levées et signatures
  // irrégulières sans supposer 4/4.
  const barBeatsList: number[] = [];
  let gi = 0;
  // Nombre de mesures rendues : colonnes réelles, PLUS la fin réelle des notes
  // (une tenue qui traverse la barre de mesure garde la mesure suivante visible).
  const lastStart = Math.max(...columns.map((c) => c.startTick));
  let lastEnd = lastStart;
  for (const col of columns) {
    const ds = durByStart.get(col.startTick) ?? [];
    let maxDur = 0;
    for (const d of ds) maxDur = Math.max(maxDur, d.durationTicks);
    lastEnd = Math.max(lastEnd, col.startTick + maxDur);
  }
  const maxMb = customMeasures
    ? Math.max(customMeasures.length - 1, measureIndexForTick(lastEnd - 1))
    : Math.max(
        Math.floor((lastStart + originBase) / BAR_TICKS),
        Math.floor((lastEnd + originBase - 1) / BAR_TICKS)
      );
  // Tenues qui traversent la barre de mesure : reportées de mesure en mesure.
  let carry = new Map<number, CarryNote>();
  for (let mb = 0; mb <= maxMb; mb++) {
    const cols = byMeasure.get(mb) ?? [];
    // Durée réelle de la mesure (levée, 3/4...) ou gabarit 4/4 historique.
    const barTicks = customMeasures ? customMeasures[mb].durationTicks : BAR_TICKS;
    barBeatsList.push(barTicks / TICKS_PER_BEAT);
    if (cols.length === 0) {
      let unit = TICKS_PER_BEAT;
      for (const cand of LADDER) {
        if (barTicks % cand.unit === 0) {
          unit = cand.unit;
          break;
        }
      }
      const slots = Math.max(1, Math.round(barTicks / unit));
      const { rows, carryOut } = renderMeasure([], unit, slots, carry);
      carry = carryOut;
      rendered.push(rows);
      grid.push({ unit, slots, notes: [] });
      continue;
    }
    // Tick du début de la mesure, relatif au début de la séquence fournie.
    const barStart = customMeasures ? customMeasures[mb].startTick : mb * BAR_TICKS - originBase;
    const rels = cols.map((c) => c.startTick - barStart);
    const { unit, slots } = tuneGrid(rels, customMeasures ? barTicks : undefined);
    const entries = cols.map((col) => {
      const slot = Math.round((col.startTick - barStart) / unit);
      const assign = assignments[gi] ?? { strings: [], frets: [], pitches: [] };
      positions[gi] = assign.strings.map((s, ai) => ({
        m: mb,
        s,
        slot,
        slide: col.slides?.get(assign.pitches[ai]),
      }));
      if (col.rest) {
        rests.push({ m: mb, slot, beats: (col.durationTicks ?? 0) / TICKS_PER_BEAT });
      }
      gi++;
      return {
        slot,
        assign,
        rest: col.rest ?? false,
        durations: durByStart.get(col.startTick) ?? [],
      };
    });
    // Valeur (en temps) de chaque attaque de note = plus longue note de la colonne
    // (les silences portent déjà un symbole de pause, pas de glyphe de note).
    const notes = entries
      .filter((e) => !e.rest)
      .map((e) => {
        let ticks = 0;
        for (const d of e.durations) ticks = Math.max(ticks, d.durationTicks);
        return { slot: e.slot, beats: ticks / TICKS_PER_BEAT };
      });
    grid.push({ unit, slots, notes });
    const { rows, carryOut } = renderMeasure(entries, unit, slots, carry);
    carry = carryOut;
    rendered.push(rows);
  }

  // Portées de 4 mesures ; si la portée finale n'a qu'une mesure, on la double
  // d'une mesure vide pour conserver un barreau `|` (le parseur exige `|`).
  const header: string[] = [];
  if (options.title) header.push(`Title: ${options.title}`);
  header.push(`Tempo: ${bpm}`);
  // Signatures seulement si elles sortent du 4/4 : les grilles d'accords
  // gardent ainsi exactement leur format historique.
  if (customMeasures && barBeatsList.some((b) => b !== 4)) {
    const padded = rendered.length % 4 === 1 ? rendered.length + 1 : rendered.length;
    while (barBeatsList.length < padded) barBeatsList.push(4);
    header.push(`Meters: ${barBeatsList.map(beatsToMeter).join(",")}`);
  }

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
    positions,
    rests,
    grid,
    measureOffset,
  };
}