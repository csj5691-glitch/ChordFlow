// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { SavedChordShape, SongTab } from "./types";

const STORAGE_KEY = "chordflow-custom-songs";

const SECTION_LABEL_MIGRATION: Record<string, string> = {
  Verset: "Couplet",
  "Pré-verset": "Pré-couplet",
};

function ensureUniqueDiagramIds(diagrams: SavedChordShape[]): SavedChordShape[] {
  const seen = new Set<string>();
  let changed = false;
  const out = diagrams.map((d, i) => {
    if (!d.id) {
      changed = true;
      return { ...d, id: `diag-${Date.now().toString(36)}-${i}` };
    }
    if (seen.has(d.id)) {
      changed = true;
      return { ...d, id: `${d.id}-${i}` };
    }
    seen.add(d.id);
    return d;
  });
  return changed ? out : diagrams;
}

export function migrateSong(song: SongTab): SongTab {
  const original = song.diagrams ?? [];
  const migrated = original.map((d) =>
    d.sectionLabel && SECTION_LABEL_MIGRATION[d.sectionLabel]
      ? { ...d, sectionLabel: SECTION_LABEL_MIGRATION[d.sectionLabel] }
      : d
  );
  const diagrams = ensureUniqueDiagramIds(migrated);
  if (diagrams.every((d, i) => d === original[i])) return song;
  return { ...song, diagrams };
}

export function getCustomSongs(): SongTab[] {
  if (typeof window === "undefined") return [];
  let songs: SongTab[] = [];
  try {
    songs = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
  let changed = false;
  const migrated = songs.map((s) => {
    const m = migrateSong(s);
    if (m !== s) changed = true;
    return m;
  });
  if (changed) localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
  return migrated;
}

export function getCustomSong(id: string): SongTab | null {
  return getCustomSongs().find((s) => s.id === id) || null;
}

export function saveCustomSong(song: SongTab): void {
  const songs = getCustomSongs();
  const idx = songs.findIndex((s) => s.id === song.id);
  if (idx >= 0) {
    songs[idx] = song;
  } else {
    songs.push(song);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(songs));
}

export function deleteCustomSong(id: string): void {
  const songs = getCustomSongs().filter((s) => s.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(songs));
}

export function updateCustomSong(id: string, patch: Partial<SongTab>): void {
  const songs = getCustomSongs().map((s) =>
    s.id === id ? { ...s, ...patch } : s
  );
  localStorage.setItem(STORAGE_KEY, JSON.stringify(songs));
}

export function generateSongId(): string {
  return `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

const CHORDS_KEY = "chordflow-line-chords";

export function loadLineChords(songId: string): Record<number, string[]> {
  if (typeof window === "undefined") return {};
  try {
    const all = JSON.parse(localStorage.getItem(CHORDS_KEY) || "{}");
    return all[songId] || {};
  } catch {
    return {};
  }
}

export function saveLineChords(songId: string, lineIndex: number, chords: string[]): void {
  const all = JSON.parse(localStorage.getItem(CHORDS_KEY) || "{}");
  if (!all[songId]) all[songId] = {};
  all[songId][lineIndex] = chords;
  localStorage.setItem(CHORDS_KEY, JSON.stringify(all));
}

const SPACERS_KEY = "chordflow-line-spacers";

export function loadLineSpacers(songId: string): Record<number, string> {
  if (typeof window === "undefined") return {};
  try {
    const all = JSON.parse(localStorage.getItem(SPACERS_KEY) || "{}");
    return all[songId] || {};
  } catch {
    return {};
  }
}

export function saveLineSpacers(songId: string, lineIndex: number, label: string): void {
  const all = JSON.parse(localStorage.getItem(SPACERS_KEY) || "{}");
  if (!all[songId]) all[songId] = {};
  if (label) {
    all[songId][lineIndex] = label;
  } else {
    delete all[songId][lineIndex];
  }
  localStorage.setItem(SPACERS_KEY, JSON.stringify(all));
}

const EXTRA_LINES_KEY = "chordflow-extra-chord-lines";

export interface ExtraChordLine {
  position: number;
  chords: string[];
  label?: string;
}

export function loadExtraChordLines(songId: string): ExtraChordLine[] {
  if (typeof window === "undefined") return [];
  try {
    const all = JSON.parse(localStorage.getItem(EXTRA_LINES_KEY) || "{}");
    return all[songId] || [];
  } catch {
    return [];
  }
}

export function saveExtraChordLines(songId: string, lines: ExtraChordLine[]): void {
  const all = JSON.parse(localStorage.getItem(EXTRA_LINES_KEY) || "{}");
  all[songId] = lines;
  localStorage.setItem(EXTRA_LINES_KEY, JSON.stringify(all));
}
