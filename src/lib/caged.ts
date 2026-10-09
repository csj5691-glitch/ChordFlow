// Copyright (c) 2026 Claude St-Jean. All rights reserved.

// Système CAGED (avec capo) pour les accords majeurs : chaque accord majeur
// peut se jouer avec l'une des 5 formes ouvertes (C, A, G, E, D) à condition
// de placer un capo sur la case qui amène la fondamentale de la forme sur la
// fondamentale visée. Ex. Do majeur : forme C capo 0, forme A capo 3, forme G
// capo 5, forme E capo 8, forme D capo 10.

import { getChordShape, type ChordShape, type NoteName } from "./chord-data";

export type CagedForm = "C" | "A" | "G" | "E" | "D";

export const CAGED_FORMS: CagedForm[] = ["C", "A", "G", "E", "D"];

// Note ouverte du dictionnaire qui fournit la forme.
const FORM_NOTE: Record<CagedForm, NoteName> = {
  C: "C",
  A: "A",
  G: "G",
  E: "E",
  D: "D",
};

// Classe de hauteur de la fondamentale de chaque forme ouverte (C=0 … B=11).
const FORM_ROOT_PC: Record<CagedForm, number> = { C: 0, A: 9, G: 7, E: 4, D: 2 };

const NOTE_PC: Record<string, number> = {
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

function rootPc(note: NoteName): number {
  const first = note.split("/")[0];
  return NOTE_PC[first] ?? 0;
}

export interface CagedVoicing {
  form: CagedForm;
  capo: number;
  // Forme transposée en cases ABSOLUES (capo inclus) pour l'affichage.
  shape: ChordShape;
}

// CAGED avec capo : le capo joue le rôle des cordes à vide de la forme ouverte.
// On décale la forme ouverte de `capo` cases ; les cordes ouvertes (case 0)
// deviennent la case du capo. Uniquement valable pour la qualité « Maj » (les
// autres qualités n'ont pas 5 formes ouvertes distinctes).
export function cagedVoicings(note: NoteName): CagedVoicing[] {
  return CAGED_FORMS.map((form) => {
    const open = getChordShape(FORM_NOTE[form], "Maj");
    const capo = ((rootPc(note) - FORM_ROOT_PC[form]) + 12) % 12;
    const frets = open.frets.map((f) => (f === -1 ? -1 : f + capo));
    const lowest = frets.filter((f) => f > 0).reduce((m, f) => Math.min(m, f), Infinity);
    const baseFret = capo > 0 ? capo : Number.isFinite(lowest) && lowest > 1 ? lowest : 1;
    return {
      form,
      capo,
      shape: { frets, fingers: open.fingers, baseFret, label: "" },
    };
  });
}
