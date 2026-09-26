// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { SavedChordShape, SongTab } from "./types";

const STORAGE_KEY = "chordflow-custom-songs";

export class StorageQuotaError extends Error {
  constructor() {
    super(
      "Espace de stockage du navigateur saturé : la chanson est trop grosse pour être sauvegardée localement. Supprimez des chansons existantes ou importez un morceau plus court."
    );
    this.name = "StorageQuotaError";
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    if (
      err instanceof DOMException &&
      (err.name === "QuotaExceededError" || err.name === "NS_ERROR_DOM_QUOTA_REACHED")
    ) {
      throw new StorageQuotaError();
    }
    throw err;
  }
}

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
  if (changed) {
    try {
      writeStorage(STORAGE_KEY, JSON.stringify(migrated));
    } catch {
      // Best effort: a full store should not break reads.
    }
  }
  return migrated;
}

export function getCustomSong(id: string): SongTab | null {
  return getCustomSongs().find((s) => s.id === id) || null;
}

function songSize(song: SongTab): number {
  return JSON.stringify(song).length;
}

// localStorage is a hard cap. When it fills up, drop the largest existing
// songs (which mirror the shared server list) to make room for the song being
// written. Returns the titles of the songs dropped from the local device.
function persistSongsList(songs: SongTab[], protectId?: string): string[] {
  const drops: string[] = [];
  let next = songs;
  for (;;) {
    try {
      writeStorage(STORAGE_KEY, JSON.stringify(next));
      return drops;
    } catch (err) {
      if (!(err instanceof StorageQuotaError)) throw err;
      let largestIdx = -1;
      let largestSize = -1;
      for (let i = 0; i < next.length; i++) {
        const s = next[i];
        if (s.id === protectId) continue;
        const size = songSize(s);
        if (size > largestSize) {
          largestSize = size;
          largestIdx = i;
        }
      }
      if (largestIdx < 0) throw new StorageQuotaError();
      const dropped = next[largestIdx];
      drops.push(dropped.title || dropped.id);
      next = next.filter((_, i) => i !== largestIdx);
    }
  }
}

export function saveCustomSong(song: SongTab): string[] {
  const songs = getCustomSongs();
  const idx = songs.findIndex((s) => s.id === song.id);
  const next = idx >= 0 ? songs.map((s, i) => (i === idx ? song : s)) : [...songs, song];
  return persistSongsList(next, song.id);
}

export function deleteCustomSong(id: string): void {
  const songs = getCustomSongs().filter((s) => s.id !== id);
  writeStorage(STORAGE_KEY, JSON.stringify(songs));
}

export function updateCustomSong(id: string, patch: Partial<SongTab>): string[] {
  const songs = getCustomSongs();
  let protectedId: string | undefined;
  const next = songs.map((s) => {
    if (s.id !== id) return s;
    protectedId = id;
    return { ...s, ...patch };
  });
  return persistSongsList(next, protectedId);
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
  writeStorage(CHORDS_KEY, JSON.stringify(all));
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
  writeStorage(SPACERS_KEY, JSON.stringify(all));
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
  writeStorage(EXTRA_LINES_KEY, JSON.stringify(all));
}
