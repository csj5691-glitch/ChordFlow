// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { resolveChordForDiagram, getChordShape } from "./chord-data";
import { parseChordContent } from "./chord-parser";
import type { SavedChordShape } from "./types";

let seq = 0;

function id(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// Normalize unicode music signs so the chord dictionary and the parser
// recognize "D/F♯", "E♭m", … as their ASCII equivalents.
export function normalizeChordSymbols(text: string): string {
  return text
    .replace(/𝄪/g, "x")
    .replace(/𝄫/g, "bb")
    .replace(/♯/g, "#")
    .replace(/♭/g, "b");
}

export interface ChordsToDiagramsResult {
  diagrams: SavedChordShape[];
  skipped: string[];
}

function sectionBar(marker: string): SavedChordShape {
  return {
    id: id("ch-sec"),
    label: marker,
    fingers: [],
    barreOn: false,
    barreCount: 0,
    muted: [],
    baseFret: 1,
    capo: 0,
    bar: true,
    sectionLabel: marker,
    repeats: 0,
  };
}

function chordToShape(name: string): SavedChordShape | null {
  const resolved = resolveChordForDiagram(name);
  if (!resolved) return null;
  const shape = getChordShape(resolved.note, resolved.quality);

  const muted = shape.frets.map((f) => f === -1);
  const fingers = shape.frets
    .map((fret, stringIndex) => ({ fret, stringIndex, finger: shape.fingers[stringIndex] }))
    .filter(({ fret, finger }) => fret > 0 && finger > 0)
    .map(({ fret, stringIndex, finger }) => ({ string: stringIndex, fret, finger }));

  // Barre: same fret reached with the index finger on at least two strings.
  const barreStringsByFret = new Map<number, number[]>();
  for (let s = 0; s < 6; s++) {
    if (shape.fingers[s] === 1 && shape.frets[s] > 0) {
      const list = barreStringsByFret.get(shape.frets[s]) ?? [];
      list.push(s);
      barreStringsByFret.set(shape.frets[s], list);
    }
  }
  let barreOn = false;
  let barreCount = 0;
  for (const [fret, strings] of barreStringsByFret) {
    if (strings.length >= 2 && fret === shape.baseFret) {
      barreOn = true;
      barreCount = 6 - Math.min(...strings);
      break;
    }
  }

  return {
    id: id("ch"),
    label: name,
    fingers,
    barreOn,
    barreCount,
    muted,
    baseFret: shape.baseFret,
    capo: 0,
  };
}

export function chordsToDiagrams(content: string): ChordsToDiagramsResult {
  const sections = parseChordContent(normalizeChordSymbols(content));
  const diagrams: SavedChordShape[] = [];
  const skipped: string[] = [];
  const skippedSeen = new Set<string>();

  const pushChord = (name: string) => {
    const shape = chordToShape(name);
    if (shape) {
      diagrams.push(shape);
    } else if (!skippedSeen.has(name)) {
      skippedSeen.add(name);
      skipped.push(name);
    }
  };

  for (const section of sections) {
    const hasChords = section.lines.some((line) => line.chords.length > 0);
    if (section.label && hasChords) {
      diagrams.push(sectionBar(section.label));
    }
    for (const line of section.lines) {
      for (const chord of line.chords) {
        pushChord(chord);
      }
    }
  }

  return { diagrams, skipped };
}