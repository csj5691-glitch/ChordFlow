// Copyright (c) 2026 Claude St-Jean. All rights reserved.

const STORAGE_KEY = "chordflow-youtube-ids";

function getAll(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

export function loadYouTubeId(songId: string): string | null {
  return getAll()[songId] || null;
}

export function saveYouTubeId(songId: string, videoId: string): void {
  const all = getAll();
  all[songId] = videoId;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}
