// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { SongTab } from "./types";

const STORAGE_KEY = "chordflow-custom-songs";

export function getCustomSongs(): SongTab[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
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
