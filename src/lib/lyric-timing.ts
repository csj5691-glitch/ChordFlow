// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { ChordSection } from "./types";

export interface TimedChordLine {
  time: number;
  chord: string;
  sectionIndex: number;
  lineIndex: number;
  matched: boolean;
}

function normalizeText(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordSet(t: string): Set<string> {
  return new Set(normalizeText(t).split(" ").filter(Boolean));
}

function similarity(a: string, b: string): number {
  const wa = wordSet(a);
  const wb = wordSet(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common / Math.max(wa.size, wb.size);
}

const MIN_SCORE = 0.35;
const WINDOW = 6;

export function buildChordLineTimestamps(
  sections: ChordSection[],
  lrc: { time: number; text: string }[]
): TimedChordLine[] {
  const flat: { sectionIndex: number; lineIndex: number; lyrics: string; chord: string }[] = [];
  sections.forEach((section, sIdx) => {
    section.lines.forEach((line, lIdx) => {
      if (!line.lyrics.trim()) return;
      flat.push({
        sectionIndex: sIdx,
        lineIndex: lIdx,
        lyrics: line.lyrics,
        chord: line.chords[0] || "",
      });
    });
  });

  if (lrc.length === 0 || flat.length === 0) return [];

  const result: TimedChordLine[] = [];
  let pointer = 0;
  const matchedIndices: { idx: number; time: number }[] = [];

  for (let i = 0; i < flat.length; i++) {
    const f = flat[i];
    let best = -1;
    let bestScore = 0;
    for (let j = pointer; j < Math.min(pointer + WINDOW, lrc.length); j++) {
      const score = similarity(f.lyrics, lrc[j].text);
      if (score > bestScore) {
        bestScore = score;
        best = j;
      }
    }
    if (best >= 0 && bestScore >= MIN_SCORE) {
      matchedIndices.push({ idx: i, time: lrc[best].time });
      result.push({
        time: lrc[best].time,
        chord: f.chord,
        sectionIndex: f.sectionIndex,
        lineIndex: f.lineIndex,
        matched: true,
      });
      pointer = best + 1;
    } else {
      result.push({
        time: 0,
        chord: f.chord,
        sectionIndex: f.sectionIndex,
        lineIndex: f.lineIndex,
        matched: false,
      });
    }
  }

  if (matchedIndices.length === 0) {
    for (const r of result) {
      r.time = 0;
      r.matched = true;
    }
    return result;
  }

  for (let i = 0; i < result.length; i++) {
    if (result[i].matched) continue;

    const firstMatch = matchedIndices[0];
    if (i < firstMatch.idx) {
      result[i].time = firstMatch.time;
      result[i].matched = true;
      continue;
    }

    let prevIdx = -1;
    let nextIdx = -1;
    for (const m of matchedIndices) {
      if (m.idx < i) prevIdx = m.idx;
      if (m.idx > i && nextIdx === -1) nextIdx = m.idx;
    }

    if (prevIdx !== -1 && nextIdx !== -1) {
      const countBetween = nextIdx - prevIdx - 1;
      const posBetween = i - prevIdx - 1;
      const t0 = matchedIndices.find((m) => m.idx === prevIdx)!.time;
      const t1 = matchedIndices.find((m) => m.idx === nextIdx)!.time;
      result[i].time = t0 + ((t1 - t0) * (posBetween + 1)) / (countBetween + 1);
    } else if (prevIdx !== -1) {
      const t0 = matchedIndices.find((m) => m.idx === prevIdx)!.time;
      const countAfter = i - prevIdx;
      result[i].time = t0 + countAfter * 0.5;
    }

    result[i].matched = true;
  }

  return result;
}