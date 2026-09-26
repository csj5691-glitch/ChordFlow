// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import type { SavedChordShape, SongTab } from "./types";
import { importer, model } from "@coderline/alphatab";

const STRING_COUNT = 6;

// Monotonic counter guarantees unique ids even when many shapes are
// generated in the same millisecond (imports run in tight loops).
let gpIdCounter = 0;
function gpId(prefix: string): string {
  gpIdCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${gpIdCounter.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export interface GpImportResult {
  song: SongTab;
  diagrams: SavedChordShape[];
  warnings: string[];
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

export async function importGuitarProFile(file: File): Promise<GpImportResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const score: model.Score = importer.ScoreLoader.loadScoreFromBytes(bytes);

  const warnings: string[] = [];
  const title = score.title || file.name.replace(/\.(gp\d?|gpx|gtp)$/i, "");
  const artist = score.artist || "";

  const firstSignature = score.masterBars[0];
  const timeSignature = {
    top: firstSignature?.timeSignatureNumerator ?? 4,
    bottom: Math.max(2, firstSignature?.timeSignatureDenominator ?? 4) as 2 | 4 | 8,
  };

  // Pick first 6-string non-percussion track
  let track = null as model.Score["tracks"][number] | null;
  for (const t of score.tracks) {
    const staff = t.staves[0];
    if (!staff || staff.isPercussion) continue;
    if (staff.tuning.length !== 6) {
      warnings.push(`Piste « ${t.name || "?"} » : ${staff.tuning.length} cordes ignorée (on attend 6).`);
      continue;
    }
    track = t;
    break;
  }
  if (!track) {
    throw new Error("Aucune piste guitare à 6 cordes trouvée dans la tablature.");
  }
  const staff = track.staves[0];

  const diagrams: SavedChordShape[] = [];
  // AlphaTab numbers strings 1..n where 1 = the lowest string (bottom line /
  // low E on a 6-string guitar). ChordFlow uses index 0 (leftmost) = low E.
  // Map: flowString = nStrings - gpString.
  const nStrings = staff.tuning.length;
  const STRING_INDEX = new Map<number, number>();
  for (let i = 1; i <= nStrings; i++) STRING_INDEX.set(i, nStrings - i);

  for (let mbIdx = 0; mbIdx < score.masterBars.length; mbIdx++) {
    const bar = staff.bars[mbIdx];
    if (!bar) continue;
    const masterBar = score.masterBars[mbIdx];

    // Repeat / section marks at bar level
    if (masterBar.isRepeatStart) {
      diagrams.push(barShape("beginRepeat"));
    }
    const section = masterBar.section;
    if (section?.marker) {
      diagrams.push(sectionShape(section.marker));
    }

    for (const voice of bar.voices) {
      if (voice.beats.length === 0 && !voice.isEmpty) continue;
      for (const beat of voice.beats) {
        if (beat.isRest || beat.isEmpty) {
          if (beat.isRest) diagrams.push(restShape());
          continue;
        }
        if (beat.notes.length === 0) continue;

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

        if (fingers.length === 0 && !mutedOn.some(Boolean)) continue;

        diagrams.push(
          chordShape(
            fingers,
            mutedOn,
            legatoTo,
            durationToBeats(beat.duration, beat.dots, beat.tupletNumerator, beat.tupletDenominator),
            beat.text || undefined
          )
        );
      }
    }

    if (masterBar.isRepeatEnd) {
      diagrams.push(barShape("endRepeat"));
    }
  }

  if (diagrams.length === 0) {
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
    diagrams,
  };

  return { song, diagrams, warnings };
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

function restShape(): SavedChordShape {
  return {
    id: gpId("gp-rest"),
    label: "Pause",
    fingers: [],
    barreOn: false,
    barreCount: 0,
    muted: [],
    baseFret: 1,
    capo: 0,
    duration: 1,
    silence: true,
  };
}

function chordShape(
  raw: { string: number; fret: number; finger: number }[],
  muted: boolean[],
  legatoTo: number[],
  duration: number,
  chordName?: string
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

  const baseFret = barreOn ? barreFret : 1;
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