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

export interface AnalyzedSong {
  song: SongTab;
  timestamps: ChordTimestamp[];
  duration: number;
}
