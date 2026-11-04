// Copyright (c) 2026 Claude St-Jean. All rights reserved.

// Evenements de notes d'un morceau, dans l'ordre du temps.
//
// Le layout sert au dessin ; ce module sert au son. Les deux partent du meme
// modele et de la meme carte de tempo, donc une note s'entend exactement quand
// son curseur passe dessus.
//
// Une liaison n'est pas une attaque : elle prolonge l'evenement precedent de la
// meme corde et de la meme hauteur.

import { createTiming } from "./timing";
import type { TabPlayerSong } from "./types";

export interface NoteEvent {
  /** Secondes depuis le debut du morceau. */
  t: number;
  /** Duree audible en secondes (liaisons comprises). */
  duration: number;
  midi: number;
  trackIndex: number;
  /** 0..1 : nuance de la note (les etouffees sont plus faibles). */
  velocity: number;
}

export function collectNoteEvents(song: TabPlayerSong): NoteEvent[] {
  const barStarts: number[] = [];
  let totalBeats = 0;
  for (const bar of song.bars) {
    barStarts.push(totalBeats);
    totalBeats += bar.beats;
  }

  const timing = createTiming(song.tempo, totalBeats);
  const events: NoteEvent[] = [];

  song.tracks.forEach((track, trackIndex) => {
    const lastByString = new Map<number, NoteEvent>();

    track.measures.forEach((measure, barIndex) => {
      const barStart = barStarts[barIndex];
      if (barStart === undefined) return;

      let offset = 0;
      for (const beat of measure.beats) {
        const startBeat = barStart + offset;
        const t = timing.beatToTime(startBeat);
        const tEnd = timing.beatToTime(startBeat + beat.duration);

        for (const note of beat.notes) {
          const midi = (track.meta.tuning[note.string] ?? 0) + note.fret;
          const previous = lastByString.get(note.string);

          // Liaison : on etire l'attaque precedente si la hauteur correspond.
          if (note.tie && previous && previous.midi === midi) {
            previous.duration = Math.max(previous.duration, tEnd - previous.t);
            continue;
          }

          const event: NoteEvent = {
            t,
            duration: Math.max(0.02, tEnd - t),
            midi,
            trackIndex,
            velocity: note.technique === "dead" ? 0.45 : 0.9,
          };
          lastByString.set(note.string, event);
          events.push(event);
        }

        offset += beat.duration;
      }
    });
  });

  events.sort((a, b) => a.t - b.t || a.midi - b.midi);
  return events;
}
