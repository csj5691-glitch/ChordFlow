// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import type { SavedChordShape, SongTab } from "./types";
import { importer, model } from "@coderline/alphatab";

const STRING_COUNT = 6;
// How many cases the chord diagram grid shows per shape (ChordShapeView).
const FRET_FLOOR = 5;

// alphaTab has no instrument kind on a staff: a guitar is detected structurally
// (6-string tablature, not percussion) and by excluding the bass family
// programs explicitly (5/6-string basses would pass the 6-string check).
const BASS_PROGRAMS_SUFFIX = 32;
const BASS_PROGRAMS_END = 39;
const DOUBLE_BASS_PROGRAM = 43;

function isGuitarTrack(
  track: model.Track,
  staff: model.Staff | undefined
): boolean {
  if (!staff || staff.isPercussion) return false;
  if (staff.tuning.length !== STRING_COUNT) return false;
  if (!staff.showTablature) return false;
  const program = track.playbackInfo?.program ?? 0;
  if (program >= BASS_PROGRAMS_SUFFIX && program <= BASS_PROGRAMS_END) return false;
  if (program === DOUBLE_BASS_PROGRAM) return false;
  return true;
}

// Monotonic counter guarantees unique ids even when many shapes are
// generated in the same millisecond (imports run in tight loops).
let gpIdCounter = 0;
function gpId(prefix: string): string {
  gpIdCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${gpIdCounter.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export interface GpTrackInfo {
  index: number;
  name: string;
  stringCount: number;
  isPercussion: boolean;
  isGuitar: boolean;
  noteCount: number;
  chordCount: number;
}

export interface GpImportResult {
  song: SongTab;
  diagrams: SavedChordShape[];
  warnings: string[];
}

export interface GpAnalysis {
  score: model.Score;
  tracks: GpTrackInfo[];
}

const DURATION_TO_BEATS: Partial<Record<model.Duration, number>> = {
  [model.Duration.QuadrupleWhole]: 16,
  [model.Duration.DoubleWhole]: 8,
  [model.Duration.Whole]: 4,
  [model.Duration.Half]: 2,
  [model.Duration.Quarter]: 1,
  [model.Duration.Eighth]: 0.5,
  [model.Duration.Sixteenth]: 0.25,
  [model.Duration.ThirtySecond]: 0.125,
  [model.Duration.SixtyFourth]: 0.0625,
  [model.Duration.OneHundredTwentyEighth]: 0.03125,
};

function durationToBeats(duration: model.Duration, dots: number, tupletNumerator: number, tupletDenominator: number): number {
  let beats = DURATION_TO_BEATS[duration] ?? 1;
  for (let i = 0; i < dots; i++) beats += beats * 0.5;
  if (tupletNumerator > 0 && tupletDenominator > 0) {
    beats = beats * ((3 * tupletDenominator) / tupletNumerator);
  }
  return +beats.toFixed(4);
}

async function loadScore(file: File): Promise<model.Score> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return importer.ScoreLoader.loadScoreFromBytes(bytes);
}

function listTracks(score: model.Score): GpTrackInfo[] {
  return score.tracks.map((t, index) => {
    const staff = t.staves[0];
    let noteCount = 0;
    let chordCount = 0;
    for (const bar of staff?.bars ?? []) {
      for (const voice of bar.voices) {
        for (const beat of voice.beats) {
          if (beat.chord) chordCount += 1;
          noteCount += beat.notes.length;
        }
      }
    }
    return {
      index,
      name: t.name || `Piste ${index + 1}`,
      stringCount: staff?.tuning.length ?? 0,
      isPercussion: staff?.isPercussion ?? false,
      isGuitar: isGuitarTrack(t, staff),
      noteCount,
      chordCount,
    };
  });
}

export async function analyzeGuitarProFile(file: File): Promise<GpTrackInfo[]> {
  const score = await loadScore(file);
  const tracks = listTracks(score).filter((t) => t.isGuitar);
  if (tracks.length === 0) {
    throw new Error("Aucune piste de guitare (6 cordes) trouvée dans la tablature.");
  }
  return tracks;
}

export async function importGuitarProTrack(file: File, trackIndex: number): Promise<GpImportResult> {
  const score = await loadScore(file);
  const warnings: string[] = [];
  const title = score.title || file.name.replace(/\.(gp\d?|gpx|gtp)$/i, "");
  const artist = score.artist || "";

  const firstSignature = score.masterBars[0];
  const timeSignature = {
    top: firstSignature?.timeSignatureNumerator ?? 4,
    bottom: Math.max(2, firstSignature?.timeSignatureDenominator ?? 4) as 2 | 4 | 8,
  };

  const track = score.tracks[trackIndex];
  if (!track) {
    throw new Error("Piste introuvable dans la tablature.");
  }
  const staff = track.staves[0];
  if (!isGuitarTrack(track, staff)) {
    throw new Error(`La piste « ${track.name || "?"} » n'est pas une guitare (6 cordes, tablature).`);
  }

  const diagrams: SavedChordShape[] = [];
  // AlphaTab numbers strings 1..n where 1 = the lowest string (bottom line /
  // low E on a 6-string guitar). ChordFlow uses index 0 (leftmost) = low E.
  // Map: flowString = nStrings - gpString.
  const nStrings = staff.tuning.length;
  const STRING_INDEX = new Map<number, number>();
  for (let i = 1; i <= nStrings; i++) STRING_INDEX.set(i, nStrings - i);

  const EPS = 1e-6;
  const beatDuration = (beat: model.Beat) =>
    durationToBeats(beat.duration, beat.dots, beat.tupletNumerator, beat.tupletDenominator);

  // Rests from several voices must not be summed: a Guitar Pro bar usually
  // carries one content voice plus empty/ghost voices. Use the busiest voice.
  function pickMainVoice(bar: model.Bar): model.Voice | null {
    let best: model.Voice | null = null;
    let bestScore = -1;
    for (const voice of bar.voices) {
      if (voice.beats.length === 0) continue;
      let content = 0;
      for (const b of voice.beats) {
        if (!b.isRest && !b.isEmpty && b.notes.length > 0) content += 1;
      }
      const score = content * 1000 + voice.beats.length;
      if (score > bestScore) {
        bestScore = score;
        best = voice;
      }
    }
    return best;
  }

  function absorbTailRest(barChords: SavedChordShape[], restBeats: number): void {
    const last = barChords[barChords.length - 1];
    if (!last || last.bar || last.silence) return;
    const current = (last.duration ?? 1) * (last.dotted ? 1.5 : 1);
    last.duration = +(current + restBeats).toFixed(4);
  }

  for (let mbIdx = 0; mbIdx < score.masterBars.length; mbIdx++) {
    const bar = staff.bars[mbIdx];
    if (!bar) continue;
    const masterBar = score.masterBars[mbIdx];

    if (masterBar.isRepeatStart) {
      diagrams.push(barShape("beginRepeat"));
    }
    const section = masterBar.section;
    if (section?.marker) {
      diagrams.push(sectionShape(section.marker));
    }

    const barChords: SavedChordShape[] = [];
    const voice = pickMainVoice(bar);

    if (voice) {
      let barBeats = 0;
      for (const beat of voice.beats) barBeats += beatDuration(beat);

      let pos = 0;
      let restStart = -1;

      // Reaching the end of a measure on a rest that merely completes the bar
      // (with the next bar playing) is strumming padding: fold it into the
      // previous chord so the pause goes away while total duration stays exact.
      const closeRestRun = (): void => {
        if (restStart < 0) return;
        const restBeats = pos - restStart;
        restStart = -1;
        if (Math.abs(restBeats - barBeats) < EPS) {
          barChords.push(restShape(restBeats));
          return;
        }
        if (pos >= barBeats - EPS) {
          absorbTailRest(barChords, restBeats);
          return;
        }
        barChords.push(restShape(restBeats));
      };

      for (const beat of voice.beats) {
        const duration = beatDuration(beat);
        if (beat.isRest || beat.isEmpty || beat.notes.length === 0) {
          if (restStart < 0) restStart = pos;
          pos += duration;
          continue;
        }

        closeRestRun();

        const text = beat.text || undefined;

        // Prefer the named chord diagram stored in the file (Guitar Pro / GPIF)
        // when present: it carries the exact frets and the known name.
        const gpChord = beat.chord;
        if (gpChord && gpChord.strings.length === nStrings && gpChord.showDiagram) {
          const chord = chordShapeFromGp(gpChord, duration, text);
          if (chord) barChords.push(chord);
          pos += duration;
          continue;
        }

        const fingers: { string: number; fret: number; finger: number }[] = [];
        const mutedOn = Array(6).fill(false);
        const legatoTo: number[] = [];

        for (const note of beat.notes) {
          if (!note.isStringed || note.fret === undefined || note.fret === null) continue;
          const s = STRING_INDEX.get(note.string);
          if (s === undefined || s < 0 || s > 5) continue;
          if (note.isDead) {
            mutedOn[s] = true;
            continue;
          }
          if (note.isGhost) continue;
          if (note.fret < 0) continue;
          fingers.push({ string: s, fret: note.fret, finger: 0 });
          if (note.isHammerPullOrigin) legatoTo.push(s);
        }

        if (fingers.length === 0 && !mutedOn.some(Boolean)) {
          pos += duration;
          continue;
        }

        barChords.push(chordShape(fingers, mutedOn, legatoTo, duration, text));
        pos += duration;
      }

      closeRestRun();
    }

    if (masterBar.isRepeatEnd) {
      diagrams.push(barShape("endRepeat"));
    }

    // Flush bar-level chords after repeat marks so measure flow reads clearly.
    if (barChords.length > 0) {
      diagrams.push(...barChords);
    }
  }

  const merged = mergeIdenticalChords(diagrams);

  if (merged.length === 0) {
    throw new Error("Aucune note convertible trouvée dans la tablature.");
  }

  const song: SongTab = {
    id: gpId("gp"),
    title,
    artist,
    type: "cover",
    content: "",
    bpm: score.tempo || 90,
    timeSignature,
    diagrams: merged,
  };

  return { song, diagrams: merged, warnings };
}

// Kept for backward compatibility: uses the first usable guitar track.
export async function importGuitarProFile(file: File): Promise<GpImportResult> {
  const score = await loadScore(file);
  const tracks = listTracks(score).filter((t) => t.isGuitar && t.noteCount > 0);
  const usable = tracks[0];
  if (!usable) {
    throw new Error("Aucune piste de guitare à 6 cordes trouvée dans la tablature.");
  }
  const result = await importGuitarProTrack(file, usable.index);
  if (result.diagrams.length === 0) {
    throw new Error("Aucune note convertible trouvée dans la tablature.");
  }
  return result;
}

function barShape(kind: "beginRepeat" | "endRepeat"): SavedChordShape {
  return {
    id: gpId("gp-bar"),
    label: kind === "beginRepeat" ? "Répétition début" : "Répétition fin",
    fingers: [],
    barreOn: false,
    barreCount: 0,
    muted: [],
    baseFret: 1,
    capo: 0,
    bar: true,
    barKind: kind,
    repeats: 1,
  };
}

function sectionShape(marker: string): SavedChordShape {
  return {
    id: gpId("gp-section"),
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

function restShape(duration = 1): SavedChordShape {
  return {
    id: gpId("gp-rest"),
    label: "Pause",
    fingers: [],
    barreOn: false,
    barreCount: 0,
    muted: [],
    baseFret: 1,
    capo: 0,
    duration,
    silence: true,
  };
}

function shapeKey(d: SavedChordShape): string {
  return JSON.stringify([
    d.label,
    d.fingers.map((f) => [f.string, f.fret, f.finger]),
    d.muted,
    d.barreOn,
    d.barreCount,
    d.baseFret,
    d.capo,
  ]);
}

// Consecutive identical chord strokes collapse into a single held chord:
// keeps the sequence compact (and under the browser storage quota) while
// keeping the exact same total duration for playback and the measure grid.
function mergeIdenticalChords(diagrams: SavedChordShape[]): SavedChordShape[] {
  const out: SavedChordShape[] = [];
  const beats = (d: SavedChordShape) => (d.duration ?? 1) * (d.dotted ? 1.5 : 1);
  for (const d of diagrams) {
    const prev = out[out.length - 1];
    const mergeable =
      prev &&
      !prev.bar &&
      !prev.silence &&
      !prev.navKind &&
      !prev.legatoTo &&
      !d.bar &&
      !d.silence &&
      !d.navKind &&
      !d.legatoTo &&
      prev.ending === undefined &&
      d.ending === undefined &&
      shapeKey(prev) === shapeKey(d);
    if (mergeable) {
      out[out.length - 1] = { ...prev, duration: +(beats(prev) + beats(d)).toFixed(4) };
    } else {
      out.push(d);
    }
  }
  return out;
}

function chordShapeFromGp(gpChord: model.Chord, duration: number, text?: string): SavedChordShape | null {
  // gpChord.strings[i]: fret per string, i = highest string first, -1 = not played.
  // Frets are ABSOLUTE (GPIF stores baseFret + relative fret). ChordFlow's
  // `fingers[].fret` is absolute too; `baseFret` is the top fret of the diagram.
  const fingers: { string: number; fret: number; finger: number }[] = [];
  const muted = Array(6).fill(false);
  const n = gpChord.strings.length;

  for (let i = 0; i < n; i++) {
    const fret = gpChord.strings[i];
    const flowString = n - 1 - i;
    if (fret < 0) {
      muted[flowString] = true;
      continue;
    }
    if (fret === 0) continue;
    fingers.push({ string: flowString, fret, finger: 0 });
  }

  if (fingers.length === 0 && !muted.some(Boolean)) return null;

  return chordShape(fingers, muted, [], duration, gpChord.name || text || "", gpChord.firstFret);
}

function chordShape(
  raw: { string: number; fret: number; finger: number }[],
  muted: boolean[],
  legatoTo: number[],
  duration: number,
  chordName?: string,
  baseFretHint?: number
): SavedChordShape {
  // Barre detection: >=3 fretted strings sharing the same fret = barre
  let barreOn = false;
  let barreCount = 0;
  const played = raw.filter((f) => f.fret > 0);
  const byFret = new Map<number, number>();
  for (const f of played) byFret.set(f.fret, (byFret.get(f.fret) ?? 0) + 1);
  const barreFret = [...byFret.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0];

  const fingers = raw.map((f) => ({ ...f }));
  if (barreFret !== undefined) {
    barreOn = true;
    const barreStrings = played.filter((f) => f.fret === barreFret).map((f) => f.string);
    // ChordFlow covers the highest strings: barreCount = count from the aiguë side.
    barreCount = STRING_COUNT - Math.min(...barreStrings);
    for (const f of fingers) {
      if (f.fret === barreFret) f.finger = 1;
    }
  }

  // Assign finger numbers by distinct fret: barre fret -> 1 (index),
  // then ascending frets -> 2,3,4 (auriculaire); beyond stays 4.
  const sorted = [...fingers].sort((a, b) => a.fret - b.fret || a.string - b.string);
  {
    let finger = barreOn ? 2 : 1;
    const used = new Set<number>();
    for (const f of sorted) {
      if (f.finger !== 0) continue;
      const k = f.fret;
      if (used.has(k)) {
        f.finger = barreOn && k === barreFret ? 1 : Math.max(2, finger - 1);
      } else {
        f.finger = finger;
        used.add(k);
        finger = finger < 4 ? finger + 1 : 4;
      }
    }
  }

  let baseFret = barreOn ? barreFret : (baseFretHint ?? 1);
  if (!barreOn && baseFret < 1) baseFret = 1;
  if (!barreOn && played.length > 0) {
    // Keep diagrams readable when frets sit high on the neck without a barre:
    // draw the grid from the lowest fretted fret instead of fret 1.
    // (Muted-only chords have no fretted fret to anchor the grid to.)
    const minFret = played.reduce((acc, f) => Math.min(acc, f.fret), Infinity);
    if (minFret > baseFret + FRET_FLOOR - 1) baseFret = minFret;
  }
  return {
    id: gpId("gp-chord"),
    label: chordName || "",
    fingers,
    barreOn,
    barreCount,
    muted,
    baseFret,
    capo: 0,
    duration,
    legatoTo: legatoTo.length ? legatoTo : undefined,
  };
}