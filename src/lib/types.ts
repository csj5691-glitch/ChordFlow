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

export interface SongTab {
  id: string;
  title: string;
  artist: string;
  type: string;
  content: string;
  sections?: ChordSection[];
  diagrams?: SavedChordShape[];
  bpm?: number;
  timeSignature?: { top: number; bottom: 2 | 4 | 8 };
  key?: string;
  capo?: number;
  tuning?: string;
  officialPlain?: string;
  officialSynced?: string;
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
  repeats?: number;
  sectionLabel?: string;
  legatoTo?: number[];
}

export interface AnalyzedSong {
  song: SongTab;
  timestamps: ChordTimestamp[];
  duration: number;
}
