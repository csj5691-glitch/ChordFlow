// Copyright (c) 2026 Claude St-Jean. All rights reserved.

export interface PlaylistsUiState {
  expanded: string | null;
  createOpen: boolean;
  newName: string;
  renameId: string | null;
  renameValue: string;
  query: string;
  selectedId: string | null;
  scrollY: number;
  resultsScrollTop: number;
}

export function defaultPlaylistsUiState(): PlaylistsUiState {
  return {
    expanded: null,
    createOpen: false,
    newName: "",
    renameId: null,
    renameValue: "",
    query: "",
    selectedId: null,
    scrollY: 0,
    resultsScrollTop: 0,
  };
}

// État en mémoire seulement : remis à zéro au rechargement de l'onglet.
let saved: PlaylistsUiState | null = null;

export function savePlaylistsUiState(state: PlaylistsUiState): void {
  saved = { ...state };
}

export function loadPlaylistsUiState(): PlaylistsUiState | null {
  return saved ? { ...saved } : null;
}
