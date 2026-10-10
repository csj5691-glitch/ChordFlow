// Copyright (c) 2026 Claude St-Jean. All rights reserved.

// Système CAGED (avec capo). Chaque accord se joue avec l'une des 5 formes
// ouvertes (C, A, G, E, D) en plaçant un capo sur la case qui amène la
// fondamentale de la forme sur la fondamentale visée. Les formes mineures et
// 7 sont dérivées des formes majeures/dominante (tierce baissée), ce qui donne
// des positions ouvertes jouables au capo.
//
// Ex. Do majeur : forme C capo 0, A capo 3, G capo 5, E capo 8, D capo 10.

import type { ChordQuality, ChordShape, NoteName } from "./chord-data";

export type CagedForm = "C" | "A" | "G" | "E" | "D";

export const CAGED_FORMS: CagedForm[] = ["C", "A", "G", "E", "D"];

// Classe de hauteur de la fondamentale de chaque forme ouverte (C=0 … B=11).
export const FORM_ROOT_PC: Record<CagedForm, number> = { C: 0, A: 9, G: 7, E: 4, D: 2 };

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
  return NOTE_PC[note.split("/")[0]] ?? 0;
}

// Formes ouvertes (cordes grave→aiguë, -1 = étouffée, 0 = à vide) par qualité.
// Maj / Dom7 / Maj7 : formes ouvertes usuelles. Min = Maj tierce baissée ;
// Min7 = Dom7 tierce baissée.
type Templates = Record<CagedForm, number[]>;

const MAJOR: Templates = {
  C: [-1, 3, 2, 0, 1, 0],
  A: [-1, 0, 2, 2, 2, 0],
  G: [3, 2, 0, 0, 0, 3],
  E: [0, 2, 2, 1, 0, 0],
  D: [-1, -1, 0, 2, 3, 2],
};

const TEMPLATES: Partial<Record<ChordQuality, Templates>> = {
  Maj: MAJOR,
  Min: {
    C: [-1, 3, 1, 0, 1, 0],
    A: [-1, 0, 2, 2, 1, 0],
    G: [3, 1, 0, 0, -1, 3],
    E: [0, 2, 2, 0, 0, 0],
    D: [-1, -1, 0, 2, 3, 1],
  },
  Dom7: {
    C: [-1, 3, 2, 3, 1, 0],
    A: [-1, 0, 2, 0, 2, 0],
    G: [3, 2, 0, 0, 0, 1],
    E: [0, 2, 0, 1, 0, 0],
    D: [-1, -1, 0, 2, 1, 2],
  },
  Min7: {
    C: [-1, 3, 1, 3, 1, -1],
    A: [-1, 0, 2, 0, 1, 0],
    G: [3, 1, 0, 0, -1, 1],
    E: [0, 2, 0, 0, 0, 0],
    D: [-1, -1, 0, 2, 1, 1],
  },
  Maj7: {
    C: [-1, 3, 2, 0, 0, 0],
    A: [-1, 0, 2, 1, 2, 0],
    G: [3, 2, 0, 0, 0, 2],
    E: [0, 2, 1, 1, 0, 0],
    D: [-1, -1, 0, 2, 2, 2],
  },
};

export const CAGED_QUALITIES: ChordQuality[] = ["Maj", "Min", "Dom7", "Min7", "Maj7"];

export function supportsCaged(quality: ChordQuality): boolean {
  return TEMPLATES[quality] !== undefined;
}

// Doigtés par cases : barré (>=3 cordes même case) = index, puis cases
// croissantes = majeur, annulaire, auriculaire (max 4).
function assignFingers(frets: number[]): number[] {
  const fingers = frets.map(() => 0);
  const played = frets.map((f, s) => ({ f, s })).filter((x) => x.f > 0);

  const byFret = new Map<number, number>();
  for (const { f } of played) byFret.set(f, (byFret.get(f) ?? 0) + 1);
  let barreFret: number | undefined;
  let barreCount = 0;
  for (const [f, c] of byFret) {
    if (c >= 3 && c > barreCount) {
      barreFret = f;
      barreCount = c;
    }
  }
  if (barreFret !== undefined) {
    for (let s = 0; s < frets.length; s++) {
      if (frets[s] === barreFret) fingers[s] = 1;
    }
  }

  const sorted = [...played].sort((a, b) => a.f - b.f || a.s - b.s);
  let finger = barreFret !== undefined ? 2 : 1;
  const used = new Set<number>();
  for (const { f, s } of sorted) {
    if (fingers[s] !== 0) continue;
    if (used.has(f)) {
      fingers[s] = Math.max(2, finger - 1);
      continue;
    }
    fingers[s] = finger;
    used.add(f);
    finger = finger < 4 ? finger + 1 : 4;
  }
  return fingers;
}

export interface CagedVoicing {
  form: CagedForm;
  capo: number;
  // Forme transposée en cases ABSOLUES (capo inclus) pour l'affichage.
  shape: ChordShape;
}

export function cagedVoicings(note: NoteName, quality: ChordQuality): CagedVoicing[] {
  const templates = TEMPLATES[quality];
  if (!templates) return [];
  const targetPc = rootPc(note);
  return CAGED_FORMS.map((form) => {
    const capo = ((targetPc - FORM_ROOT_PC[form]) + 12) % 12;
    const base = templates[form];
    const frets = base.map((f) => (f === -1 ? -1 : f + capo));
    const baseFret = capo > 0 ? capo : 1;
    return {
      form,
      capo,
      shape: {
        frets,
        fingers: assignFingers(frets),
        baseFret,
        label: "",
      },
    };
  });
}
