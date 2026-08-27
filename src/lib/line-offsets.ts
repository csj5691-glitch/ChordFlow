const STORAGE_KEY = "chordflow-line-offsets";

export type LineOffsets = Record<number, number>;

function getAll(): Record<string, LineOffsets> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

export function loadLineOffsets(songId: string): LineOffsets {
  return getAll()[songId] || {};
}

export function saveLineOffset(songId: string, lineIndex: number, offset: number): void {
  const all = getAll();
  if (!all[songId]) all[songId] = {};
  all[songId][lineIndex] = offset;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function clearLineOffsets(songId: string): void {
  const all = getAll();
  delete all[songId];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

const GLOBAL_OFFSET_KEY = "chordflow-global-offset";

function getAllGlobal(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(GLOBAL_OFFSET_KEY) || "{}");
  } catch {
    return {};
  }
}

export function loadGlobalOffset(songId: string): number {
  return getAllGlobal()[songId] || 0;
}

export function saveGlobalOffset(songId: string, offset: number): void {
  const all = getAllGlobal();
  if (offset === 0) {
    delete all[songId];
  } else {
    all[songId] = offset;
  }
  localStorage.setItem(GLOBAL_OFFSET_KEY, JSON.stringify(all));
}
