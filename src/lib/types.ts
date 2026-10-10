// Copyright (c) 2026 Claude St-Jean. All rights reserved.

export interface SongResult {
  id: string;
  title: string;
  artist: string;
  type: "Chords" | "Tab" | "Ukulele" | "Bass";
  rating: number;
  url: string;
  difficulty?: string;
}

export interface ChordSection {
  label?: string;
  lines: ChordLine[];
}

export interface ChordLine {
  chords: string[];
  lyrics: string;
  rawChord: string;
}

// One imported Guitar Pro track = one named diagram sequence.
export interface GpTrackData {
  index: number;
  name: string;
  program: number | null;
  isPercussion: boolean;
  diagrams: SavedChordShape[];
}

export interface SongTab {
  id: string;
  title: string;
  artist: string;
  type: string;
  content: string;
  sections?: ChordSection[];
  diagrams?: SavedChordShape[];
  // Original working sequence, kept when GP tracks are added so it can be
  // restored from the "Pistes" submenu.
  mainDiagrams?: SavedChordShape[];
  // Named diagram sequences, one per imported Guitar Pro track.
  gpTracks?: GpTrackData[];
  bpm?: number;
  timeSignature?: { top: number; bottom: 2 | 4 | 8 };
  key?: string;
  capo?: number;
  tuning?: string;
  officialPlain?: string;
  officialSynced?: string;
  // Anchoring of the vocal lyrics on a diagram of the main sequence: the
  // event whose playback position the first sung syllable aligns with.
  lyricAnchorDiagram?: number;
  youtubeId?: string;
  spotifyId?: string;
}

export interface SyncedLyricLine {
  time: number;
  text: string;
}

export interface ChordTimestamp {
  time: number;
  chord: string;
  sectionIndex: number;
  lineIndex: number;
}

export interface SavedChordFinger {
  string: number;
  fret: number;
  finger: number;
  // Note fantôme (import GP) : rendue entre parenthèses dans la tablature.
  ghost?: boolean;
}

export type BarKind =
  | "standard"
  | "double"
  | "end"
  | "beginRepeat"
  | "endRepeat"
  | "bothRepeat";

export const BAR_KINDS: {
  kind: BarKind;
  label: string;
  symbol: string;
}[] = [
  { kind: "standard", label: "Barre simple", symbol: "|" },
  { kind: "double", label: "Barre double", symbol: "||" },
  { kind: "end", label: "Barre finale", symbol: "‖|" },
  { kind: "beginRepeat", label: "Début répétition", symbol: "𝄆||" },
  { kind: "endRepeat", label: "Fin répétition", symbol: "||𝄇" },
  { kind: "bothRepeat", label: "Début + fin répétition", symbol: "𝄆||𝄇" },
];

export type NavKind =
  | "segno"
  | "coda"
  | "fine"
  | "dc"
  | "ds"
  | "dcAlCoda"
  | "dsAlCoda"
  | "dcAlFine"
  | "dsAlFine";

export const NAV_KINDS: {
  kind: NavKind;
  label: string;
  name: string;
}[] = [
  { kind: "segno", label: "Segno", name: "𝄋" },
  { kind: "coda", label: "Coda", name: "𝄌" },
  { kind: "fine", label: "Fine", name: "Fine" },
  { kind: "dc", label: "Da Capo (D.C.)", name: "D.C." },
  { kind: "ds", label: "Dal Segno (D.S.)", name: "D.S." },
  { kind: "dcAlCoda", label: "D.C. al Coda", name: "D.C. al Coda" },
  { kind: "dsAlCoda", label: "D.S. al Coda", name: "D.S. al Coda" },
  { kind: "dcAlFine", label: "D.C. al Fine", name: "D.C. al Fine" },
  { kind: "dsAlFine", label: "D.S. al Fine", name: "D.S. al Fine" },
];

export interface SavedChordShape {
  id: string;
  label: string;
  fingers: SavedChordFinger[];
  barreOn: boolean;
  barreCount: number;
  muted: boolean[];
  baseFret: number;
  capo: number;
  duration?: number;
  dotted?: boolean;
  silence?: boolean;
  bar?: boolean;
  barKind?: BarKind;
  navKind?: NavKind;
  ending?: 1 | 2;
  repeats?: number;
  sectionLabel?: string;
  legatoTo?: number[];
  // Nombre de cordes qui sonnent (cordes à vide incluses) au moment de
  // l'import GP. Sert à distinguer une note isolée (arpège) d'un accord plaqué
  // dans la détection des séquences d'articulation.
  sounding?: number;
  // For pitched non-fretted instruments (piano, keys, winds, strings): the
  // frequencies to play when the shape carries no fretboard fingers.
  pitchFrequencies?: number[];
  // For percussion (batterie): number of drum strokes on this shape. Kept
  // separate so repeated hits are never merged and play with a drum voice.
  drumHits?: number;
}

export interface AnalyzedSong {
  song: SongTab;
  timestamps: ChordTimestamp[];
  duration: number;
}
