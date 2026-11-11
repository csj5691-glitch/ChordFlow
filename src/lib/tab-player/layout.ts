// Copyright (c) 2026 Claude St-Jean. All rights reserved.

// Geometrie du lecteur de tablature.
//
// Le layout est calcule une seule fois par morceau : il ne depend que du
// morceau et du nombre de mesures par systeme, jamais de l'horloge. Le rendu se
// contente ensuite de deplacer le curseur (un transform) et de basculer l'etat
// des notes, ce qui evite tout recalcul par image.

import type { PlayerTrackMeta, TabPlayerSong, TabTechnique } from "./types";
import { createTiming, type Timing } from "./timing";

export const SYSTEM_WIDTH = 960;
export const SYSTEM_PAD = 18;
const SYSTEM_TOP = 30;
const TRACK_GAP = 14;

export interface TrackGeo {
  /** Ordonnee de la corde 0 (la plus aigue). */
  top: number;
  gap: number;
  staffTop: number;
  staffBot: number;
}

export interface LayoutBar {
  index: number;
  system: number;
  x: number;
  w: number;
  startBeat: number;
  endBeat: number;
  beats: number;
  time: string;
  section?: string;
  t: number;
  tEnd: number;
}

export interface LayoutNote {
  id: string;
  system: number;
  bar: LayoutBar;
  barIndex: number;
  trackIndex: number;
  trackId: string;
  /** 0 = corde la plus aigue. */
  string: number;
  fret: number;
  midi: number;
  technique: TabTechnique;
  /** La note est une prolongation (pas d'attaque). */
  tie: boolean;
  /** Note source quand `tie` est vrai et que la hauteur correspond. */
  tieFrom: LayoutNote | null;
  /** La note est prolongee par une liaison. */
  tied?: boolean;
  /** Note precedente sur la meme corde (pour H/P/glisse). */
  prev: LayoutNote | null;
  startBeat: number;
  endBeat: number;
  t: number;
  tEnd: number;
  x: number;
  y: number;
}

export interface LayoutBeat {
  index: number;
  globalBeat: number;
  localBeat: number;
  duration: number;
  x: number;
  t: number;
  tEnd: number;
  notes: LayoutNote[];
}

export interface LayoutMeasure {
  beats: LayoutBeat[];
}

export interface LayoutTrack {
  index: number;
  meta: PlayerTrackMeta;
  geo: TrackGeo;
  measures: LayoutMeasure[];
  notes: LayoutNote[];
}

export interface LayoutSystem {
  index: number;
  /** Mesures du systeme, de gauche a droite. */
  bars: LayoutBar[];
}

export interface Layout {
  song: TabPlayerSong;
  systemWidth: number;
  systemHeight: number;
  systemCount: number;
  measuresPerSystem: number;
  bars: LayoutBar[];
  systems: LayoutSystem[];
  tracks: LayoutTrack[];
  notesBySystem: LayoutNote[][];
  timing: Timing;
  barAtBeat(beat: number): LayoutBar;
  barAtTime(time: number): LayoutBar;
}

export interface LayoutOptions {
  measuresPerSystem?: number;
  systemWidth?: number;
  /** Largeur d'une mesure en unites du viewBox (prioritaire sur systemWidth). */
  measureWidth?: number;
}

export function buildLayout(song: TabPlayerSong, options: LayoutOptions = {}): Layout {
  const measuresPerSystem = Math.max(1, Math.floor(options.measuresPerSystem ?? 4));
  // Une seule ligne de tablature : on garde des mesures lisibles et on elargit
  // le systeme (defilement horizontal) au lieu de compresser tout le morceau.
  const measureWidth =
    options.measureWidth ??
    ((options.systemWidth ?? SYSTEM_WIDTH) - SYSTEM_PAD * 2) / measuresPerSystem;
  const systemWidth = SYSTEM_PAD * 2 + measureWidth * measuresPerSystem;

  const totalBeats = song.bars.reduce((sum, bar) => sum + bar.beats, 0);
  const timing = createTiming(song.tempo, totalBeats);

  /* ---------- mesures : systeme et position horizontale ---------- */

  const bars: LayoutBar[] = [];
  let beatAcc = 0;
  song.bars.forEach((bar, index) => {
    bars.push({
      index,
      system: Math.floor(index / measuresPerSystem),
      x: SYSTEM_PAD + (index % measuresPerSystem) * measureWidth,
      w: measureWidth,
      startBeat: beatAcc,
      endBeat: beatAcc + bar.beats,
      beats: bar.beats,
      time: bar.time,
      section: bar.section,
      t: timing.beatToTime(beatAcc),
      tEnd: timing.beatToTime(beatAcc + bar.beats),
    });
    beatAcc += bar.beats;
  });

  const systemCount = Math.ceil(bars.length / measuresPerSystem);
  const systems: LayoutSystem[] = Array.from({ length: systemCount }, (_, index) => ({
    index,
    bars: bars.filter((bar) => bar.system === index),
  }));

  /* ---------- portees empilees, une par piste ---------- */

  const geos: TrackGeo[] = [];
  let cursorY = SYSTEM_TOP;
  for (const track of song.tracks) {
    const strings = Math.max(1, track.meta.tuning.length);
    const gap = strings >= 6 ? 11 : 13;
    const staffTop = cursorY;
    const top = cursorY + 9;
    const staffBot = top + gap * (strings - 1) + 9;
    geos.push({ top, gap, staffTop, staffBot });
    cursorY = staffBot + TRACK_GAP;
  }
  const systemHeight = (geos[geos.length - 1]?.staffBot ?? 96) + 12;

  /* ---------- notes : coordonnees, liaisons, techniques ---------- */

  const tracks: LayoutTrack[] = song.tracks.map((track, trackIndex) => {
    const geo = geos[trackIndex] ?? { top: 39, gap: 11, staffTop: 30, staffBot: 96 };
    const measures: LayoutMeasure[] = [];
    const notes: LayoutNote[] = [];
    const prevByString = new Map<number, LayoutNote>();

    track.measures.forEach((measure, barIndex) => {
      const bar = bars[barIndex];
      if (!bar) return;

      let offset = 0;
      const beats: LayoutBeat[] = [];

      for (const source of measure.beats) {
        const duration = Math.max(0, source.duration);
        const globalBeat = bar.startBeat + offset;
        const t = timing.beatToTime(globalBeat);
        const tEnd = timing.beatToTime(globalBeat + duration);
        const x = bar.x + (offset / bar.beats) * bar.w;
        const beatNotes: LayoutNote[] = [];

        for (const sourceNote of source.notes) {
          const string = Math.round(sourceNote.string);
          if (string < 0 || string >= track.meta.tuning.length) continue;
          const note: LayoutNote = {
            id: `${trackIndex}-${barIndex}-${offset.toFixed(4)}-${string}`,
            system: bar.system,
            bar,
            barIndex,
            trackIndex,
            trackId: track.meta.id,
            string,
            fret: sourceNote.fret,
            midi: (track.meta.tuning[string] ?? 0) + sourceNote.fret,
            technique: sourceNote.technique,
            tie: sourceNote.tie,
            tieFrom: null,
            prev: prevByString.get(string) ?? null,
            startBeat: globalBeat,
            endBeat: globalBeat + duration,
            t,
            tEnd,
            x,
            y: geo.top + string * geo.gap,
          };
          prevByString.set(string, note);
          beatNotes.push(note);
          notes.push(note);
        }

        beats.push({
          index: beats.length,
          globalBeat,
          localBeat: offset,
          duration,
          x,
          t,
          tEnd,
          notes: beatNotes,
        });
        offset += duration;
      }

      measures.push({ beats });
    });

    // Une liaison prolonge la note source : on remonte la chaine des liaisons
    // pour retrouver l'attaque, puis on etire sa duree jusqu'a la fin.
    for (const note of notes) {
      if (!note.tie) continue;
      let source = note.prev;
      while (source && source.tie) source = source.prev;
      if (source && source.midi === note.midi) {
        note.tieFrom = source;
        source.tEnd = Math.max(source.tEnd, note.tEnd);
        source.tied = true;
      }
    }

    return { index: trackIndex, meta: track.meta, geo, measures, notes };
  });

  const notesBySystem: LayoutNote[][] = Array.from({ length: systemCount }, () => []);
  for (const track of tracks) {
    for (const note of track.notes) {
      notesBySystem[note.system]?.push(note);
    }
  }

  function barAtBeat(beat: number): LayoutBar {
    if (bars.length === 0) {
      throw new Error("Layout sans mesure");
    }
    const b = Math.max(0, Math.min(timing.totalBeats, beat));
    let lo = 0;
    let hi = bars.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (bars[mid].startBeat <= b) lo = mid;
      else hi = mid - 1;
    }
    return bars[lo];
  }

  return {
    song,
    systemWidth,
    systemHeight,
    systemCount,
    measuresPerSystem,
    bars,
    systems,
    tracks,
    notesBySystem,
    timing,
    barAtBeat,
    barAtTime: (time: number) => barAtBeat(timing.timeToBeat(time)),
  };
}
