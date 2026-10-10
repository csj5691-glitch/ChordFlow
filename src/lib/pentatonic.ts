// Copyright (c) 2026 Claude St-Jean. All rights reserved.

// Pentatonique majeure / mineure : 5 notes par octave, sans demi-tons.
// Deux gammes relatives : la mineure relative d'un accord majeur est une
// tierce mineure (3 cases) plus bas ; les 5 positions du manche sont les mêmes,
// seule la tonique change.

import type { NoteName } from "./chord-data";
import { CAGED_FORMS, FORM_ROOT_PC, type CagedForm } from "./caged";

const PC: Record<string, number> = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11,
};

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// index 0 = corde grave (mi grave). Même convention que tailored elsewhere.
const STRING_PC = [40, 45, 50, 55, 59, 64]; // mod 12 → E A D G B e

export const PENT_MAJOR = [0, 2, 4, 7, 9] as const;
export const PENT_MINOR = [0, 3, 5, 7, 10] as const;

export const MAJOR_DEGREES = ["1", "2", "3", "5", "6"];
export const MINOR_DEGREES = ["1", "♭3", "4", "5", "♭7"];

function pcOf(note: NoteName): number {
  return PC[note.split("/")[0]] ?? 0;
}

export function pitchClassName(pc: number): string {
  return NAMES[((pc % 12) + 12) % 12];
}

// Note relative : tonic décalé de `offset` demi-tons (classe de hauteur).
function relativeOf(note: NoteName, offset: number): string {
  return pitchClassName(pcOf(note) + offset);
}

// La mineure relative est 3 cases plus bas ; la majeure relative 3 cases plus haut.
export function relativeMinorOf(note: NoteName): string {
  return relativeOf(note, -3);
}

export function relativeMajorOf(note: NoteName): string {
  return relativeOf(note, 3);
}

export interface PentBoxPosition {
  string: number; // 0 = mi grave … 5 = mi aigu
  fret: number;
  pc: number;
  isRoot: boolean;
}

export interface PentBox {
  fretStart: number;
  // Forme CAGED (C, A, G, E, D) que recouvre cette position : la pentatonique
  // n'est que les 5 formes d'accords CAGED appliquées aux mêmes 5 notes.
  cagedForm: CagedForm;
  positions: PentBoxPosition[];
}

// Forme CAGED dont la forme d'accord ouverte se pose juste sous la case donnée.
function cagedFormFor(tonicPc: number, fretStart: number): CagedForm {
  let best: CagedForm = CAGED_FORMS[0];
  let bestDist = Infinity;
  for (const form of CAGED_FORMS) {
    const capo = (((tonicPc - FORM_ROOT_PC[form]) % 12) + 12) % 12;
    const dist = (((fretStart - capo) % 12) + 12) % 12;
    if (dist < bestDist) {
      bestDist = dist;
      best = form;
    }
  }
  return best;
}

// Les 5 positions du manche : une fenêtre de 5 cases commençant sur chacune des
// notes de la gamme posée sur la corde de mi grave. Ex. pentatonique majeure de
// C → cases de départ 8, 10, 12, 15, 17.
export function pentBoxes(tonic: NoteName, intervals: readonly number[]): PentBox[] {
  const tonicPc = pcOf(tonic);
  const scalePcs = new Set<number>(
    intervals.map((i) => (((tonicPc + i) % 12) + 12) % 12)
  );
  const baseFret = ((tonicPc - 4) + 12) % 12; // case de la tonique sur mi grave
  return intervals.map((interval) => {
    const fretStart = baseFret + interval;
    const positions: PentBoxPosition[] = [];
    for (let s = 0; s < 6; s++) {
      for (let f = fretStart; f <= fretStart + 4; f++) {
        const pc = (((STRING_PC[s] + f) % 12) + 12) % 12;
        if (scalePcs.has(pc)) {
          positions.push({ string: s, fret: f, pc, isRoot: pc === tonicPc });
        }
      }
    }
    return { fretStart, cagedForm: cagedFormFor(tonicPc, fretStart), positions };
  });
}

// Notes de la gamme (noms), dans l'ordre des degrés. Ex. C maj → C D E G A.
export function pentNotes(tonic: NoteName, intervals: readonly number[]): string[] {
  const tonicPc = pcOf(tonic);
  return intervals.map((i) => pitchClassName(tonicPc + i));
}