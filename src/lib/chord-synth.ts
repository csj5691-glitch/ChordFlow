// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import type { SavedChordShape } from "./types";

const STRING_BASE_FREQ = [82.4069, 110.0, 146.832, 195.998, 246.942, 329.628];
const STRING_COUNT = 6;

export interface SynthEvent {
  id: string;
  label: string;
  notes: number[];
  start: number;
  duration: number;
  silence: boolean;
  shape: SavedChordShape;
  legato?: LegatoInfo[];
  sectionLabel?: string;
}

export function beatsForShape(d: SavedChordShape): number {
  const base = d.duration ?? 1;
  return d.dotted ? base * 1.5 : base;
}

const STRING_NAMES = ["E", "A", "D", "G", "B", "e"];

export function fretForString(d: SavedChordShape, s: number): number {
  if (d.muted && d.muted[s] === true) return -1;
  let pos = 0;
  const fp = d.fingers.find((f) => f.string === s);
  if (fp) pos = fp.fret;
  if (d.barreOn && s >= STRING_COUNT - (d.barreCount || STRING_COUNT)) {
    pos = Math.max(d.baseFret || 1, pos);
  }
  pos = Math.max(d.capo || 0, pos);
  return pos;
}

export interface LegatoInfo {
  string: number;
  fromFret: number;
  toFret: number;
  kind: "H" | "P" | "=";
  toLabel: string;
}

export function legatoBetween(from: SavedChordShape, to: SavedChordShape): LegatoInfo[] | null {
  const strings = from.legatoTo;
  if (!strings || strings.length === 0) return null;
  const out: LegatoInfo[] = [];
  for (const s of strings) {
    const fromFret = fretForString(from, s);
    const toFret = fretForString(to, s);
    if (fromFret < 0 || toFret < 0) continue;
    const diff = toFret - fromFret;
    const kind: LegatoInfo["kind"] = diff > 0 ? "H" : diff < 0 ? "P" : "=";
    out.push({ string: s, fromFret, toFret, kind, toLabel: to.label });
  }
  return out.length > 0 ? out : null;
}

export const legatoStringName = (s: number) => STRING_NAMES[s] ?? "?";

export interface MeasureInfo {
  beatsPerMeasure: number;
  top: number;
  bottom: 2 | 4 | 8;
}

export function beatUnit(bottom: 2 | 4 | 8): number {
  return 4 / bottom;
}

export function measureInfoFromSignature(
  ts?: { top: number; bottom: 2 | 4 | 8 } | null
): MeasureInfo {
  const top = ts?.top ?? 4;
  const bottom = ts?.bottom ?? 4;
  return { top, bottom, beatsPerMeasure: top * beatUnit(bottom) };
}

export function measureForBeat(beats: number, info: MeasureInfo): number {
  if (info.beatsPerMeasure <= 0) return 0;
  return Math.floor(beats / info.beatsPerMeasure);
}

export function beatInMeasure(beats: number, info: MeasureInfo): number {
  const per = info.beatsPerMeasure;
  const inMsr = beats - Math.floor(beats / per) * per;
  const eps = 1e-6;
  return Math.abs(inMsr - Math.round(inMsr)) < eps ? Math.round(inMsr) : inMsr;
}

export function renderSequence(
  diagrams: SavedChordShape[],
  bpm: number
): SynthEvent[] {
  const beatSec = 60 / bpm;
  const events: SynthEvent[] = [];
  let section: SavedChordShape[] = [];
  let cursor = 0;

  const pushSection = (repeats: number, label?: string) => {
    if (repeats < 0) return;
    const loops = Math.max(1, repeats);
    for (let r = 0; r < loops; r++) {
      let prevShape: SavedChordShape | null = null;
      for (const d of section) {
        const dur = beatsForShape(d) * beatSec;
        const ev: SynthEvent = {
          id: `${d.id}-${r}`,
          label: d.label,
          notes: shapeNotes(d),
          start: cursor,
          duration: dur,
          silence: d.silence === true,
          shape: d,
          sectionLabel: r === 0 ? label : undefined,
        };
        if (prevShape && prevShape.legatoTo && prevShape.legatoTo.length > 0) {
          const lg = legatoBetween(prevShape, d);
          if (lg && lg.length > 0) ev.legato = lg;
        }
        events.push(ev);
        cursor += dur;
        prevShape = d;
      }
    }
    section = [];
  };

  for (const d of diagrams) {
    if (d.bar) {
      pushSection(d.repeats ?? 1, d.sectionLabel);
    } else {
      section.push(d);
    }
  }
  pushSection(1);

  return events;
}

function shapeNotes(d: SavedChordShape): number[] {
  const notes: number[] = [];
  for (let s = 0; s < STRING_COUNT; s++) {
    if (d.muted && d.muted[s] === true) continue;
    let pos = 0;
    const fp = d.fingers.find((f) => f.string === s);
    if (fp) pos = fp.fret;
    if (d.barreOn && s >= STRING_COUNT - (d.barreCount || STRING_COUNT)) {
      pos = Math.max(d.baseFret || 1, pos);
    }
    pos = Math.max(d.capo || 0, pos);
    notes.push(STRING_BASE_FREQ[s] * Math.pow(2, pos / 12));
  }
  return notes.length > 0 ? notes : [0];
}