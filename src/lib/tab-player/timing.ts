// Copyright (c) 2026 Claude St-Jean. All rights reserved.

// Carte de tempo integrable et inversible.
//
// Le rendu travaille en beats, l'horloge de ChordFlow en secondes. On decoupe
// donc le morceau en segments a tempo constant et on convertit dans les deux
// sens. `beatToTime` et `timeToBeat` sont inverses l'un de l'autre (a la
// tolerance pres), ce qui garantit que le curseur ne derive pas.

import type { TempoPoint } from "./types";

export interface TempoSegment {
  startBeat: number;
  endBeat: number;
  startTime: number;
  endTime: number;
  bpm: number;
  /** Secondes par beat. */
  spb: number;
}

export interface Timing {
  totalBeats: number;
  duration: number;
  segments: TempoSegment[];
  beatToTime(beat: number): number;
  timeToBeat(time: number): number;
  segmentAtBeat(beat: number): TempoSegment;
  segmentAtTime(time: number): TempoSegment;
}

const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

export function createTiming(points: TempoPoint[], totalBeats: number): Timing {
  const sorted = points
    .filter((p) => Number.isFinite(p.beat) && Number.isFinite(p.bpm) && p.bpm > 0)
    .map((p) => ({ beat: Math.max(0, p.beat), bpm: p.bpm }))
    .sort((a, b) => a.beat - b.beat);

  // Un seul point par beat : le dernier gagne (une automation tardive ecrase
  // la valeur initiale du score au meme endroit).
  const clean: TempoPoint[] = [];
  for (const p of sorted) {
    if (clean.length > 0 && Math.abs(clean[clean.length - 1].beat - p.beat) < 1e-9) {
      clean[clean.length - 1] = p;
    } else {
      clean.push(p);
    }
  }

  const total = Math.max(0, totalBeats);
  if (clean.length === 0) clean.push({ beat: 0, bpm: 120 });
  if (clean[0].beat > 0) clean.unshift({ beat: 0, bpm: clean[0].bpm });

  const segments: TempoSegment[] = [];
  let time = 0;
  for (let i = 0; i < clean.length; i++) {
    if (i > 0) time += ((clean[i].beat - clean[i - 1].beat) * 60) / clean[i - 1].bpm;
    const startBeat = clean[i].beat;
    const endBeat = i + 1 < clean.length ? clean[i + 1].beat : Math.max(total, startBeat);
    const spb = 60 / clean[i].bpm;
    segments.push({
      startBeat,
      endBeat,
      startTime: time,
      endTime: time + (endBeat - startBeat) * spb,
      bpm: clean[i].bpm,
      spb,
    });
  }

  const duration = segments.length > 0 ? beatToTime(total) : 0;

  function segmentAtBeat(beat: number): TempoSegment {
    let lo = 0;
    let hi = segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segments[mid].startBeat <= beat) lo = mid;
      else hi = mid - 1;
    }
    return segments[lo];
  }

  function segmentAtTime(t: number): TempoSegment {
    let lo = 0;
    let hi = segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segments[mid].startTime <= t) lo = mid;
      else hi = mid - 1;
    }
    return segments[lo];
  }

  function beatToTime(beat: number): number {
    const b = clamp(beat, 0, total);
    const s = segmentAtBeat(b);
    return s.startTime + (b - s.startBeat) * s.spb;
  }

  function timeToBeat(t: number): number {
    const time2 = clamp(t, 0, Math.max(duration, 0));
    const s = segmentAtTime(time2);
    return clamp(s.startBeat + (time2 - s.startTime) / s.spb, 0, total);
  }

  return {
    totalBeats: total,
    duration,
    segments,
    beatToTime,
    timeToBeat,
    segmentAtBeat,
    segmentAtTime,
  };
}
