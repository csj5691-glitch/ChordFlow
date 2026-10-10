// Copyright (c) 2026 Claude St-Jean. All rights reserved.

// Convertit une séquence de diagrammes (SavedChordShape[]) en tablature ASCII
// affichable (TabStaffView) : chaque diagramme devient des évènements de notes
// (hauteur depuis la corde + case, durée depuis `duration`), puis notesToTab
// place/organise le manche et rend la portée. Les marqueurs neutres (barre,
// renvoi, section) ne consomment pas de temps ; un silence en consomme.

import type { SavedChordShape } from "./types";
import { notesToTab, type TabNoteEvent, type TabPosition, type TabRest } from "./notes-to-tab";

// index 0 = corde grave (mi grave 40) → index 5 = mi aigu 64.
const OPEN_NOTES_LOW_FIRST = [40, 45, 50, 55, 59, 64];
const TICKS_PER_BEAT = 480;

function frequencyToPitch(freq: number): number {
  return Math.round(69 + 12 * Math.log2(freq / 440));
}

function beatsOf(shape: SavedChordShape): number {
  return (shape.duration ?? 1) * (shape.dotted ? 1.5 : 1);
}

// Cordes qui sonnent : les doigtés, complétés par les cordes à vide non
// énumérées (imports GP nommés où les cordes à vide ne figurent pas dans
// `fingers`, mais comptées dans `sounding`).
function pitchedStrings(shape: SavedChordShape): Map<number, number> {
  const out = new Map<number, number>();
  for (const f of shape.fingers) {
    if (f.fret >= 0) out.set(f.string, f.fret);
  }
  const strings = shape.muted?.length || 6;
  const sounding =
    typeof shape.sounding === "number"
      ? shape.sounding
      : shape.pitchFrequencies
        ? shape.pitchFrequencies.length
        : out.size;
  let neededOpen = Math.max(0, sounding - out.size);
  for (let s = 0; s < strings && neededOpen > 0; s++) {
    if (out.has(s) || shape.muted?.[s]) continue;
    out.set(s, 0);
    neededOpen -= 1;
  }
  return out;
}

// Fréquences (Hz) des notes réellement jouées par un diagramme, exactement
// comme la tablature : doigtés + cordes à vide seulement si `sounding` en
// demande (un import GP marque `sounding = fingers.length`). Sert à l'aperçu
// sonore pour qu'il joue les MÊMES notes que la portée — et non des cordes à
// vide fantômes pour chaque corde absente du diagramme.
function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export function diagramFrequencies(shape: SavedChordShape): number[] {
  const out: number[] = [];
  for (const [string, fret] of pitchedStrings(shape)) {
    if (string < 0 || string >= OPEN_NOTES_LOW_FIRST.length) continue;
    out.push(midiToFreq(OPEN_NOTES_LOW_FIRST[string] + fret));
  }
  if (out.length === 0 && shape.pitchFrequencies) {
    for (const freq of shape.pitchFrequencies) {
      if (Number.isFinite(freq) && freq > 0) out.push(freq);
    }
  }
  return out;
}

export function diagramsToTab(
  diagrams: SavedChordShape[],
  options: { title?: string; bpm?: number } = {}
): string {
  return diagramsToTabWithPositions(diagrams, options).tab;
}

// Comme `diagramsToTab`, mais renvoie aussi, pour CHAQUE diagramme, la liste des
// cases (mesure/corde/colonne) où ses notes sont rendues dans la portée, ainsi
// que les silences à dessiner. Sert à surligner la note en cours de lecture et à
// afficher les pauses/soupirs issus de l'import GP. `cells[i]` est vide si le
// diagramme ne produit aucune note (marqueur, silence, percussion).
export function diagramsToTabWithPositions(
  diagrams: SavedChordShape[],
  options: { title?: string; bpm?: number } = {}
): { tab: string; cells: TabPosition[][]; rests: TabRest[] } {
  const events: TabNoteEvent[] = [];
  const columnOfDiagram: number[] = [];
  let beats = 0;
  let produced = 0;

  for (const shape of diagrams) {
    // Marqueurs structurels : aucun temps, aucune note.
    if (shape.bar || shape.navKind || shape.sectionLabel !== undefined) {
      columnOfDiagram.push(-1);
      continue;
    }

    const durationBeats = beatsOf(shape);
    const startTick = Math.round(beats * TICKS_PER_BEAT);
    const durationTicks = Math.max(1, Math.round(durationBeats * TICKS_PER_BEAT));
    beats += durationBeats;

    // Silence : pas de note, mais on réserve sa place (mesure + colonne) pour
    // dessiner le symbole de pause approprié.
    if (shape.silence) {
      events.push({ pitch: 0, startTick, durationTicks, rest: true });
      columnOfDiagram.push(produced++);
      continue;
    }
    if (shape.drumHits) {
      columnOfDiagram.push(-1);
      continue;
    }

    const before = events.length;
    const strings = pitchedStrings(shape);
    if (strings.size === 0 && shape.pitchFrequencies) {
      for (const freq of shape.pitchFrequencies) {
        if (Number.isFinite(freq) && freq > 0) {
          events.push({ pitch: frequencyToPitch(freq), startTick, durationTicks });
        }
      }
    } else {
      for (const [string, fret] of strings) {
        if (string < 0 || string >= OPEN_NOTES_LOW_FIRST.length) continue;
        events.push({
          pitch: OPEN_NOTES_LOW_FIRST[string] + fret,
          startTick,
          durationTicks,
        });
      }
    }
    // Chaque diagramme qui produit des notes devient UNE colonne (startTick
    // distinct) ; l'ordre des colonnes suit l'ordre des diagrammes.
    columnOfDiagram.push(events.length > before ? produced++ : -1);
  }

  if (events.length === 0) return { tab: "", cells: diagrams.map(() => []), rests: [] };

  const result = notesToTab(events, { title: options.title, bpm: options.bpm });
  const cells = columnOfDiagram.map((c) => (c >= 0 ? result.positions[c] ?? [] : []));
  return { tab: result.tab, cells, rests: result.rests };
}
