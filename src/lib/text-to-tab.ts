// Convertisseur « texte (grille d'accords / paroles avec accords) → tablature ASCII ».
// Réutilise resolveChordForDiagram + getChordShape pour associer chaque accord à
// une forme de 6 cordes, puis produit une tablature au format export Guitar Pro /
// Songsterr (6 rangées E B G D A E, barres `|`) : sortie directement compatible
// avec asciiTabToMidi (conversion en MIDI jouable).

import type { ChordQuality, NoteName } from "./chord-data.ts";
import { resolveChordForDiagram, getChordShape } from "./chord-data.ts";

// Rangées dans l'ordre d'affichage d'une tablature (corde 1 aiguë → 6 grave).
const ROW_ORDER = [5, 4, 3, 2, 1, 0];

export interface TextChordToken {
  raw: string;
  label: string;
  note: NoteName;
  quality: ChordQuality;
}

// Extrait les accords reconnus d'une ligne (tokens séparés par des espaces).
// `//` (répétition) reprend l'accord précédent de la même ligne.
export function detectChordsInLine(
  line: string,
  previous: TextChordToken | null
): TextChordToken[] {
  const out: TextChordToken[] = [];
  let last = previous;
  for (const token of line.trim().split(/\s+/)) {
    if (!token) continue;
    if (/^\/+$/.test(token)) {
      if (last) out.push({ ...last });
      continue;
    }
    const resolved = resolveChordForDiagram(token.replace(/\|+$/, ""));
    if (!resolved) continue;
    const chord: TextChordToken = {
      raw: token,
      label: resolved.label,
      note: resolved.note,
      quality: resolved.quality,
    };
    out.push(chord);
    last = chord;
  }
  return out;
}

// Répartit une mesure en battements : strum sur chaque nuance, slot porteuse du
// doigté. Retourne slots (nombre de colonnes) et strums indexes d'accord.
function measureLayout(chords: string[]): { slots: number; strumToChord: number[] } | null {
  const n = chords.length;
  if (n === 0) return null;
  if (n === 1) {
    // Ronde : 1 strum sur 4 colonnes (le parseur lit 1 token → 2 temps, le reste en silence).
    return { slots: 4, strumToChord: [0] };
  }
  if (n === 2) {
    // Blanches sur 1 et 3.
    return { slots: 4, strumToChord: [0, 1] };
  }
  if (n === 3) {
    return { slots: 4, strumToChord: [0, 1, 2] };
  }
  if (n === 4) {
    return { slots: 4, strumToChord: [0, 1, 2, 3] };
  }
  // n dans 5..8 → croches (8 colonnes) ; au-delà, on boucle les accords.
  const slots = Math.ceil(n / 8) * 8;
  const strumToChord: number[] = [];
  for (let s = 0; s < slots; s++) strumToChord.push(s % n);
  return { slots, strumToChord };
}

function renderMeasure(chords: string[]): string[] | null {
  const layout = measureLayout(chords);
  if (!layout) return null;
  const rows: string[] = Array(6).fill("");
  // formes des accords
  const shapes = chords.map((c) => {
    const resolved = resolveChordForDiagram(c);
    return resolved ? getChordShape(resolved.note, resolved.quality).frets : null;
  });
  for (let r = 0; r < 6; r++) {
    const stringIdx = ROW_ORDER[r];
    let line = "";
    for (let s = 0; s < layout.slots; s++) {
      const chordIdx = layout.strumToChord[s];
      if (chordIdx === undefined || chordIdx >= shapes.length) {
        line += `-${"  "}`; // slot de silence (pas de token)
        continue;
      }
      const shape = shapes[chordIdx];
      const fret = shape ? shape[stringIdx] : -1;
      const content = fret < 0 ? "x" : String(fret).padStart(2, " ");
      line += `-${content}`;
    }
    rows[r] = line;
  }
  return rows;
}

export interface TextToTabResult {
  tab: string;
  measures: number;
  chordsDetected: string[];
  unknown: string[];
}

// Convertit un texte en tablature ASCII. Les lignes avec au moins un accord
// reconnu forment une mesure ; les lignes de paroles seules sont ignorées.
// Si la première ligne non vide ne contient aucun accord, elle devient le titre.
export function textToTab(data: string): TextToTabResult {
  const lines = data.split(/\r?\n/);
  const chords: TextChordToken[][] = [];
  const unknown: string[] = [];
  let previous: TextChordToken | null = null;

  // ligne-titre : première ligne non vide sans accord reconnu.
  let title: string | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^Tempo\b/i.test(line)) continue;
    const mTitle = line.match(/^(?:#\s*)?[Tt]itle\s*[=:]\s*(.+)/);
    if (mTitle && mTitle[1].trim().length > 0) {
      title = mTitle[1].trim();
      continue;
    }
    if (title === null && chords.length === 0) {
      const probe = detectChordsInLine(line, previous);
      if (probe.length === 0) {
        title = line;
        continue;
      }
    }
    const detected = detectChordsInLine(line, previous);
    if (detected.length > 0) {
      chords.push(detected.map((c) => c));
      previous = detected[detected.length - 1];
      for (const token of line.trim().split(/\s+/)) {
        if (/^\/+$/.test(token) || /^[A-G][#b]?/.test(token)) continue;
        unknown.push(token);
      }
    }
  }

  const seen = new Set<string>();
  const chordsDetected: string[] = [];
  for (const measure of chords) {
    for (const c of measure) {
      const key = c.label.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        chordsDetected.push(c.label);
      }
    }
  }

  const renderedMeasures: string[][] = [];
  for (const measure of chords) {
    const rendered = renderMeasure(measure.map((c) => c.label));
    if (rendered) renderedMeasures.push(rendered);
  }

  // Portées de 4 mesures maximum, séparées par `|`.
  const staffLines: string[][] = [];
  for (let i = 0; i < renderedMeasures.length; i += 4) {
    const staff: string[] = Array(6).fill("");
    for (let r = 0; r < 6; r++) {
      staff[r] = renderedMeasures.slice(i, i + 4).map((m) => m[r]).join("|");
    }
    staffLines.push(staff);
  }

  const header: string[] = [];
  if (title) header.push(`Title: ${title}`);
  const tab = [...header, ...staffLines.flat()].join("\n");

  const measures = chords.length;
  return { tab: tab.trim(), measures, chordsDetected, unknown };
}