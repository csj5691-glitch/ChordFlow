// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { parseChordContent } from "./chord-parser";

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const NOTE_INDEX: Record<string, number> = {
  C: 0, "C#": 1, Db: 1,
  D: 2, "D#": 3, Eb: 3,
  E: 4,
  F: 5, "F#": 6, Gb: 6,
  G: 7, "G#": 8, Ab: 8,
  A: 9, "A#": 10, Bb: 10,
  B: 11,
};

interface ParsedChord {
  root: number;
  minor: boolean;
}

function parseChord(chord: string): ParsedChord | null {
  const m = chord.match(/^([A-G][#b]?)(.*)$/);
  if (!m) return null;
  const root = NOTE_INDEX[m[1].toUpperCase()];
  if (root === undefined) return null;
  const rest = m[2];
  const minor = /^(m|min|m7|maj7|m6|m9|m11|madd|m7b5|m6add9)/.test(rest);
  return { root, minor };
}

export function extractChordNames(content: string): string[] {
  const sections = parseChordContent(content);
  const chords: string[] = [];
  for (const section of sections) {
    for (const line of section.lines) {
      for (const chord of line.chords) {
        chords.push(chord);
      }
    }
  }
  return chords;
}

export function detectKeyFromChords(chords: string[]): string | undefined {
  const parsed = chords.map(parseChord).filter(Boolean) as ParsedChord[];
  if (parsed.length === 0) return undefined;

  const profile = new Array(12).fill(0);
  for (const chord of parsed) profile[chord.root]++;

  const first = parsed[0];
  const last = parsed[parsed.length - 1];
  profile[first.root] += 2;

  let bestKey: string | undefined;
  let bestScore = -Infinity;

  for (let k = 0; k < 12; k++) {
    const majorSet = new Set(MAJOR_SCALE.map((d) => (d + k) % 12));
    const minorSet = new Set(MINOR_SCALE.map((d) => (d + k) % 12));

    let majorScore = 0;
    let minorScore = 0;
    for (let pc = 0; pc < 12; pc++) {
      majorScore += majorSet.has(pc) ? profile[pc] : -0.5;
      minorScore += minorSet.has(pc) ? profile[pc] : -0.5;
    }

    if (first.root === k) {
      if (first.minor) minorScore += 2.0;
      else majorScore += 2.0;
    }
    if (last.root === k && parsed.length > 1) {
      if (last.minor) minorScore += 0.8;
      else majorScore += 0.8;
    }

    if (majorScore > bestScore) {
      bestScore = majorScore;
      bestKey = NOTE_NAMES[k];
    }
    if (minorScore > bestScore) {
      bestScore = minorScore;
      bestKey = NOTE_NAMES[k] + "m";
    }
  }

  return bestKey;
}

export function detectKeyFromContent(content: string): string | undefined {
  return detectKeyFromChords(extractChordNames(content));
}
