// Copyright (c) 2026 Claude St-Jean. All rights reserved.

export interface PlaylistEntry {
  id: string;
  title: string;
  artist: string;
}

export interface Playlist {
  id: string;
  name: string;
  entries: PlaylistEntry[];
  createdAt: number;
}

export interface SetlistSession {
  playlistId: string;
  index: number;
  shuffle?: boolean;
}

const PLAYLISTS_KEY = "chordflow-playlists";
const SESSION_KEY = "chordflow-setlist-session";

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `pl-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  }
}

export function loadPlaylists(): Playlist[] {
  try {
    const raw = window.localStorage.getItem(PLAYLISTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Playlist[]) : [];
  } catch {
    return [];
  }
}

function savePlaylists(list: Playlist[]) {
  try {
    window.localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(list));
  } catch {
    // ignorer
  }
}

export function createPlaylist(name: string): Playlist {
  const list = loadPlaylists();
  const playlist: Playlist = {
    id: newId(),
    name: name.trim() || "Nouvelle playlist",
    entries: [],
    createdAt: Date.now(),
  };
  savePlaylists([...list, playlist]);
  return playlist;
}

export function renamePlaylist(id: string, name: string) {
  const list = loadPlaylists().map((p) =>
    p.id === id ? { ...p, name: name.trim() || p.name } : p
  );
  savePlaylists(list);
}

export function deletePlaylist(id: string) {
  savePlaylists(loadPlaylists().filter((p) => p.id !== id));
  const session = loadSession();
  if (session && session.playlistId === id) {
    clearSession();
  }
}

export function addToPlaylist(id: string, entry: PlaylistEntry) {
  const list = loadPlaylists().map((p) => {
    if (p.id !== id) return p;
    if (p.entries.some((e) => e.id === entry.id)) return p;
    return { ...p, entries: [...p.entries, entry] };
  });
  savePlaylists(list);
}

export function removeFromPlaylist(id: string, songId: string) {
  const list = loadPlaylists().map((p) =>
    p.id === id ? { ...p, entries: p.entries.filter((e) => e.id !== songId) } : p
  );
  savePlaylists(list);
}

export function movePlaylistEntry(id: string, songId: string, dir: -1 | 1) {
  const list = loadPlaylists().map((p) => {
    if (p.id !== id) return p;
    const idx = p.entries.findIndex((e) => e.id === songId);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= p.entries.length) return p;
    const entries = [...p.entries];
    const [moved] = entries.splice(idx, 1);
    entries.splice(target, 0, moved);
    return { ...p, entries };
  });
  savePlaylists(list);
}

export function loadSession(): SetlistSession | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SetlistSession;
    if (typeof parsed?.playlistId !== "string" || typeof parsed.index !== "number") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(session: SetlistSession) {
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // ignorer
  }
}

export function clearSession() {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignorer
  }
}