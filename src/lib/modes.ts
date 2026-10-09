// Copyright (c) 2026 Claude St-Jean. All rights reserved.

// Théorie des modes de la gamme majeure (approche relative : mêmes 7 notes,
// tonique déplacée sur chacun des degrés). Pour chaque mode : formule
// parallèle (intervalles depuis sa tonique), altérations par rapport à la
// gamme majeure, note caractéristique, couleur, accord tonique et exemple.

import { formatChordName, type ChordQuality, type NoteName } from "./chord-data";

export interface ModeInfo {
  name: string;
  degree: number;
  roman: string;
  intervals: string; // formule depuis la tonique du mode
  parallel: string; // altération vs gamme majeure
  charNote: string; // note caractéristique
  charHelp: string;
  tonality: "Majeur" | "Mineur" | "Diminué";
  tonicQuality: ChordQuality;
  mood: string;
  example: string;
}

export const MODES: ModeInfo[] = [
  {
    name: "Ionien",
    degree: 1,
    roman: "I",
    intervals: "1 2 3 4 5 6 7",
    parallel: "— (gamme majeure)",
    charNote: "—",
    charHelp: "La gamme majeure de référence.",
    tonality: "Majeur",
    tonicQuality: "Maj",
    mood: "clair, ouvert, positif",
    example: "Cliffs of Dover — Eric Johnson",
  },
  {
    name: "Dorien",
    degree: 2,
    roman: "II",
    intervals: "1 2 ♭3 4 5 6 ♭7",
    parallel: "♭3 ♭7",
    charNote: "6 (sixte majeure)",
    charHelp: "La 6 naturelle éclaircit le mineur.",
    tonality: "Mineur",
    tonicQuality: "Min",
    mood: "mystérieux mais ouvert",
    example: "Mad World — Tears for Fears",
  },
  {
    name: "Phrygien",
    degree: 3,
    roman: "III",
    intervals: "1 ♭2 ♭3 4 5 ♭6 ♭7",
    parallel: "♭2 ♭3 ♭6 ♭7",
    charNote: "♭2",
    charHelp: "Seconde mineure : sombre, exotique.",
    tonality: "Mineur",
    tonicQuality: "Min",
    mood: "très sombre, oriental",
    example: "Wherever I May Roam — Metallica",
  },
  {
    name: "Lydien",
    degree: 4,
    roman: "IV",
    intervals: "1 2 3 #4 5 6 7",
    parallel: "#4",
    charNote: "#4",
    charHelp: "Quarte augmentée : rêveur, surnaturel.",
    tonality: "Majeur",
    tonicQuality: "Maj",
    mood: "onirique, magique",
    example: "musique de film 80's (Retour vers le futur, Les Simpson)",
  },
  {
    name: "Mixolydien",
    degree: 5,
    roman: "V",
    intervals: "1 2 3 4 5 6 ♭7",
    parallel: "♭7",
    charNote: "♭7",
    charHelp: "Septième mineure : majeur adouci, plus rock.",
    tonality: "Majeur",
    tonicQuality: "Dom7",
    mood: "majeur moins naïf",
    example: "Clocks — Coldplay",
  },
  {
    name: "Éolien",
    degree: 6,
    roman: "VI",
    intervals: "1 2 ♭3 4 5 ♭6 ♭7",
    parallel: "♭3 ♭6 ♭7",
    charNote: "—",
    charHelp: "Le mineur naturel.",
    tonality: "Mineur",
    tonicQuality: "Min",
    mood: "mélancolique",
    example: "Crazy Train — Ozzy Osbourne",
  },
  {
    name: "Locrien",
    degree: 7,
    roman: "VII",
    intervals: "1 ♭2 ♭3 4 ♭5 ♭6 ♭7",
    parallel: "♭2 ♭3 ♭5 ♭6 ♭7",
    charNote: "♭5",
    charHelp: "Quinte diminuée : tension, instable.",
    tonality: "Diminué",
    tonicQuality: "dim",
    mood: "instable, dissonant",
    example: "Left Behind — Slipknot",
  },
];

// Notes de la gamme majeure en partant de C.
const CHROMATIC: NoteName[] = [
  "C",
  "C#/Db",
  "D",
  "D#/Eb",
  "E",
  "F",
  "F#/Gb",
  "G",
  "G#/Ab",
  "A",
  "A#/Bb",
  "B",
];

const ROOT_PC: Record<string, number> = {
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

// Note de départ de chacun des 7 modes (dans l'ordre des degrés) pour une
// gamme majeure parente donnée. Ex. parent C → C D E F G A B.
export function modeRoots(parent: NoteName): NoteName[] {
  const pc = ROOT_PC[parent.split("/")[0]] ?? 0;
  return [0, 2, 4, 5, 7, 9, 11].map((step) => CHROMATIC[(pc + step) % 12]);
}

// Nom de l'accord tonique du mode (fondamentale + qualité triadique/dominante).
export function modeTonicChord(mode: ModeInfo, root: NoteName): string {
  return formatChordName(root, mode.tonicQuality);
}
