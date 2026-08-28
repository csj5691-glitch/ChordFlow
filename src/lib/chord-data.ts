// Copyright (c) 2026 Claude St-Jean. All rights reserved.

export type ChordQuality =
  | "Maj"
  | "Min"
  | "Aug"
  | "dim"
  | "Dom7"
  | "Min7"
  | "Maj7"
  | "Dim7"
  | "m7b5"
  | "MinMaj7"
  | "Aug7";

export type NoteName =
  | "C"
  | "C#/Db"
  | "D"
  | "D#/Eb"
  | "E"
  | "F"
  | "F#/Gb"
  | "G"
  | "G#/Ab"
  | "A"
  | "A#/Bb"
  | "B";

export const NOTES: NoteName[] = [
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

export const QUALITIES: ChordQuality[] = [
  "Maj",
  "Min",
  "Aug",
  "dim",
  "Dom7",
  "Min7",
  "Maj7",
  "Dim7",
  "m7b5",
  "MinMaj7",
  "Aug7",
];

export interface ChordShape {
  frets: number[];
  fingers: number[];
  baseFret: number;
  label: string;
}

const SHAPES: Record<NoteName, Record<ChordQuality, ChordShape>> = {
  C: {
    Maj: { frets: [-1, 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0], baseFret: 1, label: "C" },
    Min: { frets: [-1, 3, 5, 5, 4, 3], fingers: [0, 1, 3, 4, 2, 1], baseFret: 3, label: "Cm" },
    Aug: { frets: [-1, 3, 2, 1, 1, 0], fingers: [0, 3, 2, 1, 1, 0], baseFret: 1, label: "C+" },
    dim: { frets: [-1, 3, 1, -1, 2, 1], fingers: [0, 3, 1, 0, 2, 1], baseFret: 1, label: "Cdim" },
    Dom7: { frets: [-1, 3, 2, 3, 1, 0], fingers: [0, 3, 2, 4, 1, 0], baseFret: 1, label: "C7" },
    Min7: { frets: [-1, 3, 1, 3, 4, 3], fingers: [0, 2, 1, 3, 4, 3], baseFret: 3, label: "Cm7" },
    Maj7: { frets: [-1, 3, 2, 0, 0, 0], fingers: [0, 3, 2, 0, 0, 0], baseFret: 1, label: "Cmaj7" },
    Dim7: { frets: [-1, 3, 1, 2, 1, 2], fingers: [0, 3, 1, 2, 1, 2], baseFret: 1, label: "Cdim7" },
    m7b5: { frets: [-1, 3, 4, 3, 4, 3], fingers: [0, 1, 2, 1, 3, 1], baseFret: 3, label: "Cm7b5" },
    MinMaj7: { frets: [-1, 3, 1, 0, 0, 0], fingers: [0, 3, 1, 0, 0, 0], baseFret: 1, label: "CmMaj7" },
    Aug7: { frets: [-1, 3, 2, 3, 0, 1], fingers: [0, 3, 2, 4, 0, 1], baseFret: 1, label: "C+7" },
  },
  "C#/Db": {
    Maj: { frets: [-1, 4, 3, 1, 2, 1], fingers: [0, 3, 2, 1, 1, 1], baseFret: 1, label: "C#" },
    Min: { frets: [-1, 4, 6, 6, 5, 4], fingers: [0, 1, 3, 4, 2, 1], baseFret: 4, label: "C#m" },
    Aug: { frets: [-1, 4, 3, 2, 2, 1], fingers: [0, 4, 3, 1, 1, 1], baseFret: 1, label: "C#+" },
    dim: { frets: [-1, 4, 2, -1, 3, 2], fingers: [0, 3, 1, 0, 2, 1], baseFret: 1, label: "C#dim" },
    Dom7: { frets: [-1, 4, 3, 4, 2, 1], fingers: [0, 3, 2, 4, 1, 1], baseFret: 1, label: "C#7" },
    Min7: { frets: [-1, 4, 2, 4, 5, 4], fingers: [0, 2, 1, 3, 4, 3], baseFret: 4, label: "C#m7" },
    Maj7: { frets: [-1, 4, 3, 1, 1, 1], fingers: [0, 3, 2, 1, 1, 1], baseFret: 1, label: "C#maj7" },
    Dim7: { frets: [-1, 4, 2, 3, 2, 3], fingers: [0, 3, 1, 2, 1, 2], baseFret: 1, label: "C#dim7" },
    m7b5: { frets: [-1, 4, 5, 4, 5, 4], fingers: [0, 1, 2, 1, 3, 1], baseFret: 4, label: "C#m7b5" },
    MinMaj7: { frets: [-1, 4, 2, 1, 1, 1], fingers: [0, 3, 2, 1, 1, 1], baseFret: 1, label: "C#mMaj7" },
    Aug7: { frets: [-1, 4, 3, 4, 1, 2], fingers: [0, 3, 2, 4, 1, 1], baseFret: 1, label: "C#+7" },
  },
  D: {
    Maj: { frets: [-1, -1, 0, 2, 3, 2], fingers: [0, 0, 0, 1, 3, 2], baseFret: 1, label: "D" },
    Min: { frets: [-1, -1, 0, 2, 3, 1], fingers: [0, 0, 0, 2, 3, 1], baseFret: 1, label: "Dm" },
    Aug: { frets: [-1, -1, 0, 3, 3, 2], fingers: [0, 0, 0, 2, 3, 1], baseFret: 1, label: "D+" },
    dim: { frets: [-1, -1, 0, 1, 3, 1], fingers: [0, 0, 0, 1, 3, 1], baseFret: 1, label: "Ddim" },
    Dom7: { frets: [-1, -1, 0, 2, 1, 2], fingers: [0, 0, 0, 2, 1, 3], baseFret: 1, label: "D7" },
    Min7: { frets: [-1, -1, 0, 2, 1, 1], fingers: [0, 0, 0, 3, 1, 1], baseFret: 1, label: "Dm7" },
    Maj7: { frets: [-1, -1, 0, 2, 2, 2], fingers: [0, 0, 0, 1, 1, 1], baseFret: 1, label: "Dmaj7" },
    Dim7: { frets: [-1, -1, 0, 1, 0, 1], fingers: [0, 0, 0, 1, 0, 2], baseFret: 1, label: "Ddim7" },
    m7b5: { frets: [-1, -1, 0, 1, 1, 1], fingers: [0, 0, 0, 1, 1, 1], baseFret: 1, label: "Dm7b5" },
    MinMaj7: { frets: [-1, -1, 0, 2, 2, 1], fingers: [0, 0, 0, 2, 3, 1], baseFret: 1, label: "DmMaj7" },
    Aug7: { frets: [-1, -1, 0, 3, 2, 2], fingers: [0, 0, 0, 3, 1, 1], baseFret: 1, label: "D+7" },
  },
  "D#/Eb": {
    Maj: { frets: [-1, -1, 1, 3, 4, 3], fingers: [0, 0, 1, 2, 4, 3], baseFret: 1, label: "D#" },
    Min: { frets: [-1, -1, 1, 3, 4, 2], fingers: [0, 0, 1, 3, 4, 1], baseFret: 1, label: "D#m" },
    Aug: { frets: [-1, -1, 1, 4, 4, 3], fingers: [0, 0, 1, 3, 4, 2], baseFret: 1, label: "D#+" },
    dim: { frets: [-1, -1, 1, 2, 4, 2], fingers: [0, 0, 1, 2, 4, 2], baseFret: 1, label: "D#dim" },
    Dom7: { frets: [-1, -1, 1, 3, 2, 3], fingers: [0, 0, 1, 3, 2, 4], baseFret: 1, label: "D#7" },
    Min7: { frets: [-1, -1, 1, 3, 2, 2], fingers: [0, 0, 1, 3, 2, 2], baseFret: 1, label: "D#m7" },
    Maj7: { frets: [-1, -1, 1, 3, 3, 3], fingers: [0, 0, 1, 1, 1, 1], baseFret: 1, label: "D#maj7" },
    Dim7: { frets: [-1, -1, 1, 2, 1, 2], fingers: [0, 0, 1, 2, 1, 3], baseFret: 1, label: "D#dim7" },
    m7b5: { frets: [-1, -1, 1, 2, 2, 2], fingers: [0, 0, 1, 1, 1, 1], baseFret: 1, label: "D#m7b5" },
    MinMaj7: { frets: [-1, -1, 1, 3, 3, 2], fingers: [0, 0, 1, 3, 4, 2], baseFret: 1, label: "D#mMaj7" },
    Aug7: { frets: [-1, -1, 1, 4, 3, 3], fingers: [0, 0, 1, 4, 2, 2], baseFret: 1, label: "D#+7" },
  },
  E: {
    Maj: { frets: [0, 2, 2, 1, 0, 0], fingers: [0, 2, 3, 1, 0, 0], baseFret: 1, label: "E" },
    Min: { frets: [0, 2, 2, 0, 0, 0], fingers: [0, 2, 3, 0, 0, 0], baseFret: 1, label: "Em" },
    Aug: { frets: [0, 3, 2, 1, 1, 0], fingers: [0, 3, 2, 1, 1, 0], baseFret: 1, label: "E+" },
    dim: { frets: [0, 1, 2, 0, -1, -1], fingers: [0, 1, 2, 0, 0, 0], baseFret: 1, label: "Edim" },
    Dom7: { frets: [0, 2, 0, 1, 0, 0], fingers: [0, 2, 0, 1, 0, 0], baseFret: 1, label: "E7" },
    Min7: { frets: [0, 2, 0, 0, 0, 0], fingers: [0, 2, 0, 0, 0, 0], baseFret: 1, label: "Em7" },
    Maj7: { frets: [0, 2, 1, 1, 0, 0], fingers: [0, 3, 1, 2, 0, 0], baseFret: 1, label: "Emaj7" },
    Dim7: { frets: [0, 1, 2, 0, -1, -1], fingers: [0, 1, 2, 0, 0, 0], baseFret: 1, label: "Edim7" },
    m7b5: { frets: [0, 2, 0, 0, -1, -1], fingers: [0, 2, 0, 0, 0, 0], baseFret: 1, label: "Em7b5" },
    MinMaj7: { frets: [0, 2, 1, 0, 0, 0], fingers: [0, 3, 1, 0, 0, 0], baseFret: 1, label: "EmMaj7" },
    Aug7: { frets: [0, 3, 0, 1, 1, 0], fingers: [0, 3, 0, 1, 1, 0], baseFret: 1, label: "E+7" },
  },
  F: {
    Maj: { frets: [1, 3, 3, 2, 1, 1], fingers: [1, 3, 4, 2, 1, 1], baseFret: 1, label: "F" },
    Min: { frets: [1, 3, 3, 1, 1, 1], fingers: [1, 3, 4, 1, 1, 1], baseFret: 1, label: "Fm" },
    Aug: { frets: [1, -1, 3, 2, 2, 1], fingers: [1, 0, 4, 2, 3, 1], baseFret: 1, label: "F+" },
    dim: { frets: [-1, -1, 3, 1, -1, 1], fingers: [0, 0, 3, 1, 0, 2], baseFret: 1, label: "Fdim" },
    Dom7: { frets: [1, -1, 1, 2, 1, 1], fingers: [1, 0, 2, 3, 1, 1], baseFret: 1, label: "F7" },
    Min7: { frets: [1, -1, 1, 1, 1, 1], fingers: [1, 0, 1, 1, 1, 1], baseFret: 1, label: "Fm7" },
    Maj7: { frets: [-1, -1, 3, 2, 1, 0], fingers: [0, 0, 3, 2, 1, 0], baseFret: 1, label: "Fmaj7" },
    Dim7: { frets: [-1, -1, 3, 4, 3, 4], fingers: [0, 0, 1, 3, 2, 4], baseFret: 3, label: "Fdim7" },
    m7b5: { frets: [1, -1, 1, 1, 0, 1], fingers: [2, 0, 3, 4, 0, 1], baseFret: 1, label: "Fm7b5" },
    MinMaj7: { frets: [-1, -1, 3, 1, 1, 0], fingers: [0, 0, 3, 1, 1, 0], baseFret: 1, label: "FmMaj7" },
    Aug7: { frets: [1, -1, 1, 2, 2, 1], fingers: [1, 0, 2, 3, 4, 1], baseFret: 1, label: "F+7" },
  },
  "F#/Gb": {
    Maj: { frets: [2, 4, 4, 3, 2, 2], fingers: [1, 3, 4, 2, 1, 1], baseFret: 1, label: "F#" },
    Min: { frets: [2, 4, 4, 2, 2, 2], fingers: [1, 3, 4, 1, 1, 1], baseFret: 1, label: "F#m" },
    Aug: { frets: [2, -1, 4, 3, 3, 2], fingers: [1, 0, 4, 2, 3, 1], baseFret: 1, label: "F#+" },
    dim: { frets: [-1, -1, 4, 2, -1, 2], fingers: [0, 0, 3, 1, 0, 2], baseFret: 1, label: "F#dim" },
    Dom7: { frets: [2, -1, 2, 3, 2, 2], fingers: [1, 0, 2, 3, 1, 1], baseFret: 1, label: "F#7" },
    Min7: { frets: [2, -1, 2, 2, 2, 2], fingers: [1, 0, 1, 1, 1, 1], baseFret: 1, label: "F#m7" },
    Maj7: { frets: [-1, -1, 4, 3, 2, 1], fingers: [0, 0, 4, 3, 2, 1], baseFret: 1, label: "F#maj7" },
    Dim7: { frets: [-1, -1, 4, 5, 4, 5], fingers: [0, 0, 1, 3, 2, 4], baseFret: 4, label: "F#dim7" },
    m7b5: { frets: [2, -1, 2, 2, 1, 2], fingers: [2, 0, 3, 4, 1, 1], baseFret: 1, label: "F#m7b5" },
    MinMaj7: { frets: [-1, -1, 4, 2, 2, 1], fingers: [0, 0, 4, 2, 3, 1], baseFret: 1, label: "F#mMaj7" },
    Aug7: { frets: [2, -1, 2, 3, 3, 2], fingers: [1, 0, 2, 3, 4, 1], baseFret: 1, label: "F#+7" },
  },
  G: {
    Maj: { frets: [3, 2, 0, 0, 0, 3], fingers: [2, 1, 0, 0, 0, 3], baseFret: 1, label: "G" },
    Min: { frets: [3, 5, 5, 3, 3, 3], fingers: [1, 3, 4, 1, 1, 1], baseFret: 3, label: "Gm" },
    Aug: { frets: [3, -1, 0, 0, 1, 2], fingers: [2, 0, 0, 0, 1, 3], baseFret: 1, label: "G+" },
    dim: { frets: [-1, -1, 0, -1, -1, 3], fingers: [0, 0, 0, 0, 0, 1], baseFret: 1, label: "Gdim" },
    Dom7: { frets: [3, 2, 0, 0, 0, 1], fingers: [3, 2, 0, 0, 0, 1], baseFret: 1, label: "G7" },
    Min7: { frets: [3, 1, 0, 0, 3, 3], fingers: [2, 1, 0, 0, 3, 4], baseFret: 1, label: "Gm7" },
    Maj7: { frets: [3, 2, 0, 0, 0, 2], fingers: [3, 2, 0, 0, 0, 1], baseFret: 1, label: "Gmaj7" },
    Dim7: { frets: [-1, -1, 0, -1, -1, 2], fingers: [0, 0, 0, 0, 0, 1], baseFret: 1, label: "Gdim7" },
    m7b5: { frets: [-1, -1, 0, -1, -1, 1], fingers: [0, 0, 0, 0, 0, 1], baseFret: 1, label: "Gm7b5" },
    MinMaj7: { frets: [3, 1, 0, 0, 0, 2], fingers: [3, 1, 0, 0, 0, 2], baseFret: 1, label: "GmMaj7" },
    Aug7: { frets: [3, -1, 0, 0, 1, 1], fingers: [3, 0, 0, 0, 1, 1], baseFret: 1, label: "G+7" },
  },
  "G#/Ab": {
    Maj: { frets: [4, 3, 1, 1, 1, 4], fingers: [2, 1, 1, 1, 1, 3], baseFret: 1, label: "G#" },
    Min: { frets: [4, 6, 6, 4, 4, 4], fingers: [1, 3, 4, 1, 1, 1], baseFret: 4, label: "G#m" },
    Aug: { frets: [4, -1, 1, 1, 2, 3], fingers: [3, 0, 1, 1, 2, 4], baseFret: 1, label: "G#+" },
    dim: { frets: [-1, -1, 1, -1, -1, 4], fingers: [0, 0, 0, 0, 0, 1], baseFret: 1, label: "G#dim" },
    Dom7: { frets: [4, 3, 1, 1, 1, 2], fingers: [3, 2, 1, 1, 1, 1], baseFret: 1, label: "G#7" },
    Min7: { frets: [4, 2, 1, 1, 4, 4], fingers: [3, 2, 1, 1, 4, 4], baseFret: 1, label: "G#m7" },
    Maj7: { frets: [4, 3, 1, 1, 1, 3], fingers: [3, 2, 1, 1, 1, 1], baseFret: 1, label: "G#maj7" },
    Dim7: { frets: [-1, -1, 1, -1, -1, 3], fingers: [0, 0, 0, 0, 0, 1], baseFret: 1, label: "G#dim7" },
    m7b5: { frets: [-1, -1, 1, -1, -1, 2], fingers: [0, 0, 0, 0, 0, 1], baseFret: 1, label: "G#m7b5" },
    MinMaj7: { frets: [4, 2, 1, 1, 1, 3], fingers: [3, 2, 1, 1, 1, 1], baseFret: 1, label: "G#mMaj7" },
    Aug7: { frets: [4, -1, 1, 1, 2, 2], fingers: [4, 0, 1, 1, 2, 2], baseFret: 1, label: "G#+7" },
  },
  A: {
    Maj: { frets: [-1, 0, 2, 2, 2, 0], fingers: [0, 0, 1, 1, 1, 0], baseFret: 1, label: "A" },
    Min: { frets: [-1, 0, 2, 2, 1, 0], fingers: [0, 0, 2, 3, 1, 0], baseFret: 1, label: "Am" },
    Aug: { frets: [-1, 0, 3, 2, 2, 1], fingers: [0, 0, 3, 2, 1, 1], baseFret: 1, label: "A+" },
    dim: { frets: [-1, 0, 1, 2, 1, -1], fingers: [0, 0, 1, 3, 2, 0], baseFret: 1, label: "Adim" },
    Dom7: { frets: [-1, 0, 2, 0, 2, 0], fingers: [0, 0, 2, 0, 3, 0], baseFret: 1, label: "A7" },
    Min7: { frets: [-1, 0, 2, 0, 1, 0], fingers: [0, 0, 2, 0, 1, 0], baseFret: 1, label: "Am7" },
    Maj7: { frets: [-1, 0, 2, 2, 2, -1], fingers: [0, 0, 1, 1, 1, 0], baseFret: 1, label: "Amaj7" },
    Dim7: { frets: [-1, 0, 1, 2, 1, 2], fingers: [0, 0, 1, 3, 2, 4], baseFret: 1, label: "Adim7" },
    m7b5: { frets: [-1, 0, 1, 0, 1, 0], fingers: [0, 0, 1, 0, 2, 0], baseFret: 1, label: "Am7b5" },
    MinMaj7: { frets: [-1, 0, 2, 2, 1, -1], fingers: [0, 0, 2, 3, 1, 0], baseFret: 1, label: "AmMaj7" },
    Aug7: { frets: [-1, 0, 3, 0, 2, 1], fingers: [0, 0, 3, 0, 2, 1], baseFret: 1, label: "A+7" },
  },
  "A#/Bb": {
    Maj: { frets: [-1, 1, 3, 3, 3, 1], fingers: [0, 1, 3, 3, 3, 1], baseFret: 1, label: "A#" },
    Min: { frets: [-1, 1, 3, 3, 2, 1], fingers: [0, 1, 3, 4, 2, 1], baseFret: 1, label: "A#m" },
    Aug: { frets: [-1, 1, 4, 3, 3, 2], fingers: [0, 1, 4, 2, 3, 1], baseFret: 1, label: "A#+" },
    dim: { frets: [-1, 1, 2, 3, 2, -1], fingers: [0, 1, 2, 4, 3, 0], baseFret: 1, label: "A#dim" },
    Dom7: { frets: [-1, 1, 3, 1, 3, 1], fingers: [0, 1, 3, 1, 4, 1], baseFret: 1, label: "A#7" },
    Min7: { frets: [-1, 1, 3, 1, 2, 1], fingers: [0, 1, 3, 1, 2, 1], baseFret: 1, label: "A#m7" },
    Maj7: { frets: [-1, 1, 3, 3, 3, -1], fingers: [0, 1, 1, 1, 1, 0], baseFret: 1, label: "A#maj7" },
    Dim7: { frets: [-1, 1, 2, 3, 2, 3], fingers: [0, 1, 2, 4, 3, 4], baseFret: 1, label: "A#dim7" },
    m7b5: { frets: [-1, 1, 2, 1, 2, 1], fingers: [0, 1, 2, 1, 3, 1], baseFret: 1, label: "A#m7b5" },
    MinMaj7: { frets: [-1, 1, 3, 3, 2, -1], fingers: [0, 1, 3, 4, 2, 0], baseFret: 1, label: "A#mMaj7" },
    Aug7: { frets: [-1, 1, 4, 1, 3, 2], fingers: [0, 1, 4, 1, 3, 2], baseFret: 1, label: "A#+7" },
  },
  B: {
    Maj: { frets: [-1, 2, 4, 4, 4, 2], fingers: [0, 1, 3, 3, 3, 1], baseFret: 1, label: "B" },
    Min: { frets: [-1, 2, 4, 4, 3, 2], fingers: [0, 1, 3, 4, 2, 1], baseFret: 1, label: "Bm" },
    Aug: { frets: [-1, 2, -1, 4, 3, 3], fingers: [0, 1, 0, 4, 2, 3], baseFret: 1, label: "B+" },
    dim: { frets: [-1, 2, 3, 4, 3, -1], fingers: [0, 1, 2, 4, 3, 0], baseFret: 1, label: "Bdim" },
    Dom7: { frets: [-1, 2, 1, 2, 0, 2], fingers: [0, 2, 1, 3, 0, 4], baseFret: 1, label: "B7" },
    Min7: { frets: [-1, 2, 0, 2, 0, 2], fingers: [0, 1, 0, 2, 0, 3], baseFret: 1, label: "Bm7" },
    Maj7: { frets: [-1, 2, 4, 3, 4, 2], fingers: [0, 1, 3, 2, 4, 1], baseFret: 1, label: "Bmaj7" },
    Dim7: { frets: [-1, 2, 3, 4, 3, 4], fingers: [0, 1, 2, 4, 3, 4], baseFret: 1, label: "Bdim7" },
    m7b5: { frets: [-1, 2, 3, 2, 3, 2], fingers: [0, 1, 2, 1, 3, 1], baseFret: 1, label: "Bm7b5" },
    MinMaj7: { frets: [-1, 2, 0, 3, 0, 2], fingers: [0, 1, 0, 3, 0, 2], baseFret: 1, label: "BmMaj7" },
    Aug7: { frets: [-1, 2, 1, 2, 0, 3], fingers: [0, 2, 1, 3, 0, 4], baseFret: 1, label: "B+7" },
  },
};

export function getChordShape(note: NoteName, quality: ChordQuality): ChordShape {
  return SHAPES[note][quality];
}

export function formatChordName(note: NoteName, quality: ChordQuality): string {
  const baseNote = note.split("/")[0].replace("#", "#").replace("b", "b");
  const qualityMap: Record<ChordQuality, string> = {
    Maj: "",
    Min: "m",
    Aug: "+",
    dim: "dim",
    Dom7: "7",
    Min7: "m7",
    Maj7: "maj7",
    Dim7: "dim7",
    m7b5: "m7b5",
    MinMaj7: "mMaj7",
    Aug7: "+7",
  };
  return baseNote + qualityMap[quality];
}
