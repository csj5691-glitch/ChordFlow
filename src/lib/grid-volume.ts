// Copyright (c) 2026 Claude St-Jean. All rights reserved.

// Volume de la grille synthétisée du Studio (sons MIDI). Réglage global et
// persistant : les sons synthétisés sont vifs par nature, et un volume par
// défaut modéré évite d'agresser des haut-parleurs d'ordinateur.
const STORAGE_KEY = "chordflow-grid-volume";

export const DEFAULT_GRID_VOLUME = 0.6;

export function loadGridVolume(): number {
  if (typeof window === "undefined") return DEFAULT_GRID_VOLUME;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_GRID_VOLUME;
    const value = parseFloat(raw);
    if (!Number.isFinite(value)) return DEFAULT_GRID_VOLUME;
    return Math.min(1, Math.max(0, value));
  } catch {
    return DEFAULT_GRID_VOLUME;
  }
}

export function saveGridVolume(volume: number): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, String(Math.min(1, Math.max(0, volume))));
  } catch {
    /* stockage indisponible : la valeur reste en mémoire pour la session */
  }
}
