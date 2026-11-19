// Inventaire des stems persistés sur le disque H (via le service stems).
// Une seule lecture au chargement : la rafale interroge des centaines de
// chansons, inutile de refetcher l'index à chaque fois.

export type PersistedStemEntry = { song_id: string; stems: string[] };

let indexCache: Promise<Map<string, Set<string>>> | null = null;

async function fetchIndex(): Promise<Map<string, Set<string>>> {
  try {
    const res = await fetch("/api/stems/persisted", { cache: "no-store" });
    if (!res.ok) return new Map();
    const data = (await res.json()) as { songs?: PersistedStemEntry[] };
    const map = new Map<string, Set<string>>();
    for (const entry of data.songs ?? []) {
      if (entry?.song_id) map.set(entry.song_id, new Set(entry.stems ?? []));
    }
    return map;
  } catch {
    // Service arrêté : l'app continue avec IndexedDB seul.
    return new Map();
  }
}

export function loadPersistedStemsIndex(refresh = false): Promise<Map<string, Set<string>>> {
  if (refresh || !indexCache) indexCache = fetchIndex();
  return indexCache;
}

export async function persistedStemsFor(songId: string): Promise<Set<string>> {
  const index = await loadPersistedStemsIndex();
  return index.get(songId) ?? new Set<string>();
}
