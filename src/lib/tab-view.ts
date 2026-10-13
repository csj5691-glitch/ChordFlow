// Modèle et sérialisation pour la « tablature HTML » (aperçu façon Songsterr).
// Consomme le modèle de parseAsciiTabModel (mesures × 6 cordes × tokens ordonnés)
// et sait re-sérialiser en tablature ASCII au même format que les générateurs
// (notes-to-tab / text-to-tab) : compatible parseAsciiTab → conversion MIDI.

import type { ChordQuality } from "./chord-data.ts";
import { NOTES, formatChordName } from "./chord-data.ts";
import { OPEN_NOTES, type TabToken } from "./ascii-tab-midi.ts";

export type TabSlotKind = "rest" | "mute" | "note";
export const TAB_STRING_NAMES = ["e", "B", "G", "D", "A", "E"];
export const MAX_FRET = 24;
const DEFAULT_BPM = 120;

// Noms de cordes déduits d'un libellé d'accordage de type « D A F C G C »,
// listé de l'aiguë (haut) vers la grave (bas). Renvoie undefined si le libellé
// n'est pas une liste de 6 notes (ex. « Standard (EADGBE) ») : l'appelant garde
// alors l'affichage standard.
export function parseTuningNotes(tuning?: string): string[] | undefined {
  if (!tuning) return undefined;
  const parts = tuning.trim().split(/\s+/);
  if (parts.length !== 6) return undefined;
  if (!parts.every((p) => /^[A-Ga-g][#b]?$/.test(p))) return undefined;
  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1));
}

export function slotKind(token: TabToken | undefined): TabSlotKind {
  if (!token) return "rest";
  return token.fret === null ? "mute" : "note";
}

export function fretPitch(stringIdx: number, fret: number): number {
  return OPEN_NOTES[stringIdx] + fret;
}

const QUALITY_PCS: Record<ChordQuality, number[]> = {
  Maj: [0, 4, 7],
  Min: [0, 3, 7],
  Aug: [0, 4, 8],
  dim: [0, 3, 6],
  Dom7: [0, 4, 7, 10],
  Min7: [0, 3, 7, 10],
  Maj7: [0, 4, 7, 11],
  Dim7: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10],
  MinMaj7: [0, 3, 7, 11],
  Aug7: [0, 4, 8, 10],
};

const QUALITY_ORDER: ChordQuality[] = [
  "Maj",
  "Min",
  "Dom7",
  "Min7",
  "Maj7",
  "Aug",
  "dim",
  "Dim7",
  "m7b5",
  "MinMaj7",
  "Aug7",
];

// Identifie l'accord le plus probable joué à un instant (≤ 6 cases) : on teste
// les 12 racines × 11 qualités, chaque casse jouée vaut +2 (dans l'accord) ou -3
// (hors accord), chaque note d'accord non jouée vaut -1, on favorise l'accord
// dont la racine est la basse (+2) et les accords plus petits (tie-break).
export function guessChordLabel(frets: (number | null)[]): string | null {
  const played: number[] = [];
  let lowest: number | null = null;
  for (let i = 0; i < frets.length && i < OPEN_NOTES.length; i++) {
    const f = frets[i];
    if (f === null || f < 0) continue;
    const pc = (OPEN_NOTES[i] + f) % 12;
    if (!played.includes(pc)) played.push(pc);
    const pitch = OPEN_NOTES[i] + f;
    if (lowest === null || pitch < lowest) lowest = pitch;
  }
  if (played.length < 2) return null;

  let best: { root: number; quality: ChordQuality; score: number } | null = null;
  for (let r = 0; r < 12; r++) {
    for (const quality of QUALITY_ORDER) {
      const chord = new Set(QUALITY_PCS[quality].map((iv) => (r + iv) % 12));
      let score = 0;
      for (const p of played) score += chord.has(p) ? 2 : -3;
      for (const c of chord) if (!played.includes(c)) score -= 1;
      if (lowest !== null && lowest % 12 === r) score += 2;
      const sameScore =
        best !== null && score === best.score;
      const smaller =
        sameScore &&
        QUALITY_PCS[quality].length < QUALITY_PCS[best!.quality].length;
      if (
        best === null ||
        score > best.score ||
        smaller
      ) {
        best = { root: r, quality, score };
      }
    }
  }
  if (best === null || best.score < 2) return null;
  // NOTES (chord-data) est indexé sur la (A=0) ; une classe de hauteur C=0
  // correspond donc à l'index 3 (NOTES[3] = "C").
  return formatChordName(NOTES[(best.root + 3) % 12], best.quality);
}

// Qualités acceptées pour l'interprétation harmonique d'une MESURE : triades
// majeure/mineure, plus 7, 5 (quinte seule) et sus. (guessChordLabel, pour un
// instant simultané, reste limité aux 11 qualités du modèle d'accords.)
const MEASURE_CHORD_TEMPLATES: { pcs: number[]; suffix: string }[] = [
  { pcs: [0, 4, 7], suffix: "" }, // majeur
  { pcs: [0, 3, 7], suffix: "m" }, // mineur
  { pcs: [0, 4, 7, 10], suffix: "7" }, // dominante 7
  { pcs: [0, 3, 7, 10], suffix: "m7" },
  { pcs: [0, 4, 7, 11], suffix: "maj7" },
  { pcs: [0, 5, 7], suffix: "sus4" },
  { pcs: [0, 2, 7], suffix: "sus2" },
  { pcs: [0, 7], suffix: "5" },
];

// Interprète un ENSEMBLE de classes de hauteur (notes réparties sur toute une
// mesure, pas forcément simultanées) comme un accord majeur/mineur/7/5/sus :
// même barème que guessChordLabel (+2 note dans l'accord, -3 hors accord, -1
// note d'accord absente, +2 si la basse est la racine ; plus petit accord en
// secours d'égalité). `bass` = classe de hauteur de la note la plus grave.
export function guessChordFromPitchClasses(
  pitchClasses: number[],
  bass: number | null = null
): string | null {
  const played: number[] = [];
  for (const p of pitchClasses) {
    const pc = ((p % 12) + 12) % 12;
    if (!played.includes(pc)) played.push(pc);
  }
  if (played.length < 2) return null;
  const bassPc = bass === null ? null : ((bass % 12) + 12) % 12;
  let best: { root: number; pcs: number[]; suffix: string; score: number } | null =
    null;
  for (let r = 0; r < 12; r++) {
    for (const tpl of MEASURE_CHORD_TEMPLATES) {
      const chord = new Set(tpl.pcs.map((iv) => (r + iv) % 12));
      let score = 0;
      for (const p of played) score += chord.has(p) ? 2 : -3;
      for (const c of chord) if (!played.includes(c)) score -= 1;
      if (bassPc !== null && bassPc === r) score += 2;
      const sameScore = best !== null && score === best.score;
      const smaller = sameScore && tpl.pcs.length < best!.pcs.length;
      if (best === null || score > best.score || smaller) {
        best = { root: r, pcs: tpl.pcs, suffix: tpl.suffix, score };
      }
    }
  }
  if (best === null || best.score < 2) return null;
  // NOTES (chord-data) est indexé sur la (A=0) : une classe C=0 → index 3.
  return NOTES[(best.root + 3) % 12].split("/")[0] + best.suffix;
}

// --- Diagramme d'un accord interprété (survol de l'harmonique, riffs) ---

const NOTE_PCS: Record<string, number> = {};
NOTES.forEach((n, i) => {
  const pc = (i + 9) % 12; // NOTES est indexé sur la (A=0) ; A = classe 9
  for (const t of n.split("/")) NOTE_PCS[t] = pc;
});

const MEASURE_SUFFIX_INTERVALS: Record<string, number[]> = {
  "": [0, 4, 7],
  m: [0, 3, 7],
  "7": [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  sus4: [0, 5, 7],
  sus2: [0, 2, 7],
  "5": [0, 7],
};

// Doigtés (aiguë → grave, comme la tablature) d'un libellé d'accord pour un
// mini diagramme : la racine est posée sur la corde grave où elle est la plus
// basse, les autres notes de l'accord sur les cordes supérieures dans un petit
// intervalle ; les cordes inaccessibles restent muettes.
export function chordFretsForLabel(label: string): (number | null)[] | null {
  let root = -1;
  let intervals: number[] | null = null;
  const suffixes = Object.keys(MEASURE_SUFFIX_INTERVALS).sort(
    (a, b) => b.length - a.length
  );
  for (const suffix of suffixes) {
    if (label.slice(-suffix.length) !== suffix) continue;
    const name = label.slice(0, label.length - suffix.length);
    if (name && name in NOTE_PCS) {
      root = NOTE_PCS[name];
      intervals = MEASURE_SUFFIX_INTERVALS[suffix];
      break;
    }
  }
  if (root < 0 || !intervals) return null;
  const chordPcs = new Set(intervals.map((iv) => (root + iv) % 12));

  // Racine sur les 3 cordes graves (E, A, D) au case le plus bas ; si elle n'y
  // est pas joignable, la note grave la plus proche de l'accord (accord inversé).
  let bassIdx = -1;
  let bassFret = -1;
  for (let s = 5; s >= 3; s--) {
    const openPc = OPEN_NOTES[s] % 12;
    let rootAt: number | null = null;
    for (let f = 0; f <= 12; f++) {
      if ((openPc + f) % 12 === root) {
        rootAt = f;
        break;
      }
    }
    if (rootAt !== null && (bassIdx === -1 || rootAt < bassFret)) {
      bassIdx = s;
      bassFret = rootAt;
    }
  }
  if (bassIdx === -1) {
    for (let s = 5; s >= 3; s--) {
      const openPc = OPEN_NOTES[s] % 12;
      for (let f = 0; f <= 12; f++) {
        if (!chordPcs.has((openPc + f) % 12)) continue;
        if (bassIdx === -1 || f < bassFret) {
          bassIdx = s;
          bassFret = f;
        }
        break;
      }
    }
  }
  if (bassIdx === -1) return null;

  const cap = Math.min(15, bassFret + 5);
  const frets: (number | null)[] = new Array(6).fill(null);
  frets[bassIdx] = bassFret;
  for (let s = bassIdx - 1; s >= 0; s--) {
    const openPc = OPEN_NOTES[s] % 12;
    let place: number | null = null;
    for (let f = 0; f <= cap; f++) {
      if (chordPcs.has((openPc + f) % 12)) {
        place = f;
        break;
      }
    }
    frets[s] = place;
  }
  return frets;
}

export function measureSlots(strings: (TabToken | undefined)[][]): number {
  let max = 0;
  for (const row of strings) max = Math.max(max, row.length);
  return max;
}

// Complète chaque rangée jusqu'au nombre de slots de la mesure (undefined = repos).
export function padRows(
  strings: (TabToken | undefined)[][],
  slots: number
): (TabToken | undefined)[][] {
  return strings.map((row) => {
    const out: (TabToken | undefined)[] = new Array(slots).fill(undefined);
    for (let i = 0; i < row.length && i < slots; i++) out[i] = row[i];
    return out;
  });
}

export function slotFrets(
  rows: (TabToken | undefined)[][],
  slot: number
): (number | null)[] {
  return rows.map((row) => {
    const tok = row[slot];
    return tok && tok.fret !== null ? tok.fret : null;
  });
}

// Détecte les passages de riff (ligne mélodique « notes seules ») : suites de
// colonnes (attaque, tenue liée, repos, étouffée) contenant ≥ 2 attaques
// réelles. Une colonne « accord » (≥ 2 notes simultanées) coupe la suite.
export function detectRiffRuns(
  rows: (TabToken | undefined)[][],
  slots: number
): { start: number; end: number }[] {
  type Label = "attack" | "tie" | "chord" | "mute" | "rest";
  const labels: Label[] = new Array(slots).fill("rest");
  for (let t = 0; t < slots; t++) {
    let notes = 0;
    let ties = 0;
    let mutes = 0;
    for (const row of rows) {
      const tok = row[t];
      if (!tok) continue;
      if (tok.fret !== null) {
        notes += 1;
        if (tok.tie) ties += 1;
      } else {
        mutes += 1;
      }
    }
    labels[t] =
      notes >= 2
        ? "chord"
        : notes === 1
          ? ties > 0
            ? "tie"
            : "attack"
          : mutes > 0
            ? "mute"
            : "rest";
  }
  const runs: { start: number; end: number }[] = [];
  let start = -1;
  let attacks = 0;
  for (let t = 0; t <= slots; t++) {
    const chord = t < slots && labels[t] === "chord";
    if (!chord && start === -1) start = t;
    if (!chord && t < slots && labels[t] === "attack") attacks += 1;
    if (chord || t === slots) {
      if (start !== -1 && t - start >= 2 && attacks >= 2) {
        runs.push({ start, end: t - 1 });
      }
      start = -1;
      attacks = 0;
    }
  }
  return runs;
}

// --- Sérialisation → ASCII (format identique aux générateurs) ---

const REST = "-  "; // repos : aucune hauteur, cellules vides identiques sur les 6 cordes
const MUTE = "-x-"; // étouffée : occupe la colonne, aucun son

function tokenText(tok: TabToken | undefined, slotHasAnyToken: boolean): string {
  if (!tok) return slotHasAnyToken ? MUTE : REST;
  if (tok.fret === null) return MUTE;
  const padded = String(tok.fret).padStart(2, " ");
  return tok.tie ? `-${padded}l` : `-${padded}-`;
}

function renderMeasureRow(
  row: (TabToken | undefined)[],
  measure: (TabToken | undefined)[][],
  slots: number
): string {
  let line = "";
  for (let s = 0; s < slots; s++) {
    // Une colonne est soit un repos complet (aucune rangée n'a de token : le
    // parseur saute l'index sur les 6 cordes), soit un instant où CHAQUE rangée
    // porte un token (note ou x) — jamais un mélange, sinon l'alignement
    // temporel des colonnes dérive d'une corde à l'autre.
    const slotHasAnyToken = measure.some((other) => other[s] !== undefined);
    line += tokenText(row[s], slotHasAnyToken);
  }
  return line;
}

const MUTE_TOKEN: TabToken = {
  fret: null,
  tie: false,
  accent: false,
  soft: false,
  staccato: true,
};

function emptyMeasure(): TabToken[][] {
  return Array.from({ length: 6 }, () => Array(4).fill(MUTE_TOKEN));
}

export interface SerializableTab {
  title?: string;
  bpm?: number;
  measures: (TabToken | undefined)[][][];
}

export function serializeTabModel(model: SerializableTab): string {
  const header: string[] = [];
  if (model.title) header.push(`Title: ${model.title}`);
  header.push(`Tempo: ${model.bpm ?? DEFAULT_BPM}`);
  const lines: string[] = [...header];
  for (let i = 0; i < model.measures.length; i += 4) {
    const group = model.measures.slice(i, i + 4);
    // Portée de 4 mesures max ; si une portée n'a qu'une mesure, on la double
    // d'une mesure vide pour conserver un barreau `|` (exigence du parseur).
    const padded = group.length === 1 ? [group[0], emptyMeasure()] : group;
    const slots = Math.max(...padded.map((m) => measureSlots(m)));
    for (let r = 0; r < 6; r++) {
      lines.push(padded.map((m) => renderMeasureRow(m[r], m, slots)).join("|"));
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}