// Copyright (c) 2026 Claude St-Jean. All rights reserved.

// Adaptateur alphaTab -> modele du lecteur de tablature.
//
// alphaTab fournit un Score complet (mesures communes, voix, techniques,
// accordages, automations de tempo). Ce module le projette sur le modele
// minimal de `types.ts`, sans rien persister : le morceau reste en memoire.
//
// Regles de conversion :
// - 1 beat = 1 noire, une mesure 4/4 vaut 4 beats.
// - La duree d'un beat vient de sa valeur, de ses points et de son tuplet.
// - alphaTab numerote les cordes depuis la plus grave (1) ; le lecteur depuis
//   la plus aigue (0) : `index = nombreDeCordes - note.string`.
// - Une seule voix par mesure est lue (la premiere non vide), comme le fait
//   deja l'import GP de ChordFlow.

import { model } from "@coderline/alphatab";
import type {
  PlayerBar,
  PlayerBeat,
  PlayerMeasure,
  PlayerNote,
  PlayerTrack,
  TabPlayerSong,
  TabTechnique,
  TempoPoint,
} from "./types";
import { createTiming } from "./timing";

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

export interface AdapterStats {
  tracks: number;
  skippedTracks: number;
  measures: number;
  notes: number;
  ties: number;
  dead: number;
  paddedMeasures: number;
  overflowMeasures: number;
  graceSkipped: number;
  tempoPoints: number;
  totalBeats: number;
  duration: number;
}

export interface AdaptedSong {
  song: TabPlayerSong;
  stats: AdapterStats;
  warnings: string[];
}

function beatDuration(beat: model.Beat): number {
  let beats = DURATION_TO_BEATS[beat.duration] ?? 1;
  if (beat.dots > 0) beats *= 2 - 1 / 2 ** beat.dots;
  if (beat.tupletNumerator > 0 && beat.tupletDenominator > 0) {
    beats *= beat.tupletDenominator / beat.tupletNumerator;
  }
  return Math.max(0, +beats.toFixed(6));
}

function techniqueOf(note: model.Note, beat: model.Beat): TabTechnique {
  if (note.isDead) return "dead";
  if (note.hasBend) return "bend";
  if (note.vibrato !== model.VibratoType.None || beat.vibrato !== model.VibratoType.None) {
    return "vibrato";
  }
  if (note.isHammerPullDestination) {
    const origin = note.hammerPullOrigin;
    if (!origin) return "hammer";
    return note.fret > origin.fret ? "hammer" : "pull";
  }
  if (
    note.slideOutType !== model.SlideOutType.None ||
    note.slideInType !== model.SlideInType.None
  ) {
    return "slide";
  }
  return null;
}

function trackHasTab(track: model.Track): boolean {
  const staff = track.staves[0];
  if (!staff || staff.isPercussion || staff.tuning.length === 0) return false;
  for (const bar of staff.bars) {
    for (const voice of bar.voices) {
      for (const beat of voice.beats) {
        for (const note of beat.notes) {
          if (note.isStringed && note.fret >= 0 && !note.isTieDestination) return true;
        }
      }
    }
  }
  return false;
}

function tuningLabels(tuning: number[]): string[] {
  return tuning.map((pitch) => {
    try {
      return model.Tuning.getTextForTuning(pitch, false);
    } catch {
      return "?";
    }
  });
}

function readMeasure(
  staff: model.Staff | undefined,
  barIndex: number,
  barBeats: number,
  stringCount: number,
  stats: AdapterStats
): PlayerMeasure {
  const beats: PlayerBeat[] = [];
  const bar = staff?.bars[barIndex];
  const voices = bar?.voices ?? [];
  const voice = voices.find((candidate) => candidate.beats.length > 0);
  let sum = 0;

  for (const beat of voice?.beats ?? []) {
    // Les ornements (grace notes) n'occupent pas de temps : le modele ne les
    // represente pas encore, on les ignore en le signalant.
    if (beat.graceType !== model.GraceType.None) {
      stats.graceSkipped += 1;
      continue;
    }
    const duration = beatDuration(beat);
    if (duration <= 0) continue;

    const notes: PlayerNote[] = [];
    for (const note of beat.notes) {
      if (!note.isStringed || note.fret < 0) continue;
      const string = stringCount - note.string;
      if (string < 0 || string >= stringCount) continue;
      notes.push({
        string,
        fret: note.fret,
        technique: techniqueOf(note, beat),
        tie: note.isTieDestination,
      });
      stats.notes += 1;
      if (note.isTieDestination) stats.ties += 1;
      if (note.isDead) stats.dead += 1;
    }

    beats.push({ duration, notes });
    sum += duration;
  }

  const missing = barBeats - sum;
  if (missing > 1e-6) {
    beats.push({ duration: +missing.toFixed(6), notes: [] });
    stats.paddedMeasures += 1;
  } else if (missing < -1e-6) {
    stats.overflowMeasures += 1;
  }

  return { beats };
}

export function fromAlphaTabScore(score: model.Score): AdaptedSong {
  const warnings: string[] = [];
  const stats: AdapterStats = {
    tracks: 0,
    skippedTracks: 0,
    measures: 0,
    notes: 0,
    ties: 0,
    dead: 0,
    paddedMeasures: 0,
    overflowMeasures: 0,
    graceSkipped: 0,
    tempoPoints: 0,
    totalBeats: 0,
    duration: 0,
  };

  /* ---------- mesures communes et tempo ---------- */

  const bars: PlayerBar[] = [];
  const tempo: TempoPoint[] = [];
  let beatAcc = 0;

  for (const masterBar of score.masterBars) {
    const numerator = masterBar.timeSignatureNumerator || 4;
    const denominator = masterBar.timeSignatureDenominator || 4;
    const barBeats = (4 * numerator) / denominator;

    for (const automation of masterBar.tempoAutomations ?? []) {
      if (automation.type !== model.AutomationType.Tempo) continue;
      if (!Number.isFinite(automation.value) || automation.value <= 0) continue;
      const ratio = Math.min(1, Math.max(0, automation.ratioPosition));
      tempo.push({ beat: beatAcc + ratio * barBeats, bpm: automation.value });
    }

    bars.push({
      beats: barBeats,
      time: `${numerator}/${denominator}`,
      section: masterBar.section?.text?.trim() || undefined,
    });
    beatAcc += barBeats;
  }

  // Le tempo global du score ne sert que si aucune automation ne couvre le
  // debut : sinon on obtient deux points identiques au beat 0.
  const hasInitialTempo = tempo.some((point) => point.beat <= 1e-9);
  if (!hasInitialTempo && Number.isFinite(score.tempo) && score.tempo > 0) {
    tempo.unshift({ beat: 0, bpm: score.tempo });
  }
  if (tempo.length === 0) tempo.push({ beat: 0, bpm: 120 });

  /* ---------- pistes ---------- */

  const tracks: PlayerTrack[] = [];

  score.tracks.forEach((track, trackIndex) => {
    const staff = track.staves[0];
    if (!staff || staff.isPercussion || !trackHasTab(track)) {
      stats.skippedTracks += 1;
      return;
    }
    if (track.staves.length > 1) {
      warnings.push(
        `« ${track.name || `Piste ${trackIndex + 1}`} » a ${track.staves.length} portees : seule la premiere est lue.`
      );
    }

    const tuning = staff.tuning.slice();
    const measures = bars.map((bar, barIndex) =>
      readMeasure(staff, barIndex, bar.beats, tuning.length, stats)
    );

    tracks.push({
      meta: {
        id: `t${trackIndex}`,
        name: track.name?.trim() || `Piste ${trackIndex + 1}`,
        short: (track.shortName?.trim() || track.name?.trim() || `P${trackIndex + 1}`)
          .slice(0, 3)
          .toUpperCase(),
        tuning,
        labels: tuningLabels(tuning),
      },
      measures,
    });
  });

  if (tracks.length === 0) {
    warnings.push("Aucune piste de tablature jouable dans ce fichier.");
  }

  /* ---------- morceau ---------- */

  const title = score.title?.trim() || "Sans titre";
  const artist = score.artist?.trim() || undefined;
  const song: TabPlayerSong = {
    title,
    artist,
    source: [artist, title].filter(Boolean).join(" — "),
    bars,
    tempo,
    tracks,
  };

  stats.tracks = tracks.length;
  stats.measures = bars.length;
  stats.tempoPoints = tempo.length;
  stats.totalBeats = beatAcc;
  stats.duration = createTiming(tempo, beatAcc).duration;

  return { song, stats, warnings };
}
