// Copyright (c) 2026 Claude St-Jean. All rights reserved.

const STORAGE_KEY = "chordflow-spotify-ids";

function getAll(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

export function loadSpotifyId(songId: string): string | null {
  return getAll()[songId] || null;
}

export function saveSpotifyId(songId: string, trackUrl: string): void {
  const all = getAll();
  all[songId] = trackUrl;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}
