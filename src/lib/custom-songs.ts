// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { SavedChordShape, SongTab } from "./types";

// Songs are stored in IndexedDB (one record per song) instead of localStorage:
// localStorage is capped at ~5 MB for the whole origin and shared with the
// audio stems / SoundFont stores, which forced the app to evict the largest
// local songs to make room. IndexedDB quota is far larger, so the local
// playlist survives. The old localStorage list is migrated on first read.

const DB_NAME = "chordflow-songs";
const DB_VERSION = 1;
const STORE_NAME = "songs";
const LEGACY_STORAGE_KEY = "chordflow-custom-songs";

export class StorageQuotaError extends Error {
  constructor() {
    super(
      "Espace de stockage du navigateur saturé : la chanson est trop grosse pour être sauvegardée localement. Supprimez des chansons existantes ou importez un morceau plus court."
    );
    this.name = "StorageQuotaError";
  }
}

function isQuotaError(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === "QuotaExceededError" || err.name === "NS_ERROR_DOM_QUOTA_REACHED")
  );
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("ChordFlow : base de chansons bloquée"));
  });
}

function getAllSongs(db: IDBDatabase): Promise<SongTab[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve((req.result as SongTab[]) ?? []);
    req.onerror = () => reject(req.error);
  });
}

function putSong(db: IDBDatabase, song: SongTab): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(song);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Échec d'écriture"));
  });
}

function deleteSongRecord(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Échec de suppression"));
  });
}

// ----------------------------------------- migration -------------------------
let migrationPromise: Promise<void> | null = null;

// One-time move of the legacy localStorage playlist into IndexedDB, then request
// persistent storage so the browser is less eager to evict the origin's data.
function migrateLegacyLocalSongs(): Promise<void> {
  if (migrationPromise) return migrationPromise;
  migrationPromise = (async () => {
    if (typeof indexedDB === "undefined" || typeof localStorage === "undefined") return;
    try {
      if (navigator.storage?.persist) {
        void navigator.storage.persist().catch(() => {});
      }
      const db = await openDB();
      const existing = await getAllSongs(db);
      if (existing.length > 0) return;
      let legacy: SongTab[] = [];
      try {
        legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || "[]");
      } catch {
        legacy = [];
      }
      if (legacy.length === 0) return;
      for (const s of legacy) {
        if (!s || typeof s.id !== "string") continue;
        try {
          await putSong(db, s);
        } catch {
          // best effort: skip songs that do not fit
        }
      }
      try {
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      } catch {
        // ignore
      }
    } catch {
      // IndexedDB unavailable: the app still works from the server.
    }
  })();
  return migrationPromise;
}

// ------------------------------------------ public API -----------------------
// Returns the songs cached on this device (offline copy of the shared list).
export async function loadLocalSongs(): Promise<SongTab[]> {
  if (typeof indexedDB === "undefined") return [];
  await migrateLegacyLocalSongs();
  try {
    const db = await openDB();
    const all = await getAllSongs(db);
    return all.map(migrateSong);
  } catch {
    return [];
  }
}

export async function loadLocalSong(id: string): Promise<SongTab | null> {
  const all = await loadLocalSongs();
  return all.find((s) => s.id === id) ?? null;
}

// Saves/deletes one song locally. When the store is full, the largest OTHER
// song is dropped to make room (mirror of the old localStorage behaviour) and
// its title is reported so the UI can warn the user.
export async function saveLocalSong(song: SongTab): Promise<string[]> {
  if (typeof indexedDB === "undefined") return [];
  const db = await openDB();
  const drops: string[] = [];
  for (;;) {
    try {
      await putSong(db, migrateSong(song));
      return drops;
    } catch (err) {
      if (!isQuotaError(err)) throw err;
      const others = (await getAllSongs(db)).filter((s) => s.id !== song.id);
      let largest: SongTab | null = null;
      for (const s of others) {
        if (!largest || songSize(s) > songSize(largest)) largest = s;
      }
      if (!largest) throw new StorageQuotaError();
      await deleteSongRecord(db, largest.id);
      drops.push(largest.title || largest.id);
    }
  }
}

export async function deleteLocalSong(id: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDB();
    await deleteSongRecord(db, id);
  } catch {
    // nothing to delete
  }
}

export async function updateLocalSong(id: string, patch: Partial<SongTab>): Promise<string[]> {
  const current = await loadLocalSong(id);
  return saveLocalSong(current ? { ...current, ...patch } : ({ id, ...patch } as SongTab));
}

// ---------------------------------------- pure helpers -----------------------
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

// Old imports could store Infinity (muted-only chords had no fretted fret to
// anchor the grid): clamp non-finite numbers to safe values.
function sanitizeDiagrams(diagrams: SavedChordShape[]): SavedChordShape[] {
  let changed = false;
  const out = diagrams.map((d) => {
    let fixed = d;
    if (typeof d.baseFret === "number" && !Number.isFinite(d.baseFret)) {
      changed = true;
      fixed = { ...fixed, baseFret: 1 };
    }
    if (typeof d.barreCount === "number" && !Number.isFinite(d.barreCount)) {
      changed = true;
      fixed = { ...fixed, barreCount: 0 };
    }
    if (typeof d.duration === "number" && !Number.isFinite(d.duration)) {
      changed = true;
      fixed = { ...fixed, duration: 1 };
    }
    if (typeof d.capo === "number" && !Number.isFinite(d.capo)) {
      changed = true;
      fixed = { ...fixed, capo: 0 };
    }
    return fixed;
  });
  return changed ? out : diagrams;
}

export function migrateSong(song: SongTab): SongTab {
  const original = song.diagrams ?? [];
  const migrated = sanitizeDiagrams(
    original.map((d) =>
      d.sectionLabel && SECTION_LABEL_MIGRATION[d.sectionLabel]
        ? { ...d, sectionLabel: SECTION_LABEL_MIGRATION[d.sectionLabel] }
        : d
    )
  );
  const diagrams = ensureUniqueDiagramIds(migrated);
  if (diagrams.every((d, i) => d === original[i])) return song;
  return { ...song, diagrams };
}

function songSize(song: SongTab): number {
  return JSON.stringify(song).length;
}

export function generateSongId(): string {
  return `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// -------------------------------------- per-line annotations -----------------
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

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (err) {
    if (isQuotaError(err)) {
      throw new StorageQuotaError();
    }
    throw err;
  }
}