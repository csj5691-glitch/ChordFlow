// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  getSupabase,
  loadSharedSongs,
  saveSharedSong,
  deleteSharedSong,
  importAllLocalSongs,
} from "./supabase";
import { SongTab } from "./types";
import { loadLocalSongs } from "./custom-songs";

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Délai dépassé")), ms);
    p.then((v) => {
      clearTimeout(timer);
      resolve(v);
    }).catch((e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

export function useSharedSongs() {
  const [songs, setSongs] = useState<SongTab[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const loadFromAnywhere = useCallback(async (): Promise<SongTab[]> => {
    try {
      return await withTimeout(loadSharedSongs(), 8000);
    } catch {
      return loadLocalSongs();
    }
  }, []);

  const refresh = useCallback(async () => {
    const list = await loadFromAnywhere();
    setSongs((prev) => (JSON.stringify(prev) === JSON.stringify(list) ? prev : list));
    setSyncing(false);
  }, [loadFromAnywhere]);

  useEffect(() => {
    let active = true;
    let channel: RealtimeChannel | null = null;

    loadFromAnywhere()
      .then((list) => {
        if (!active) return;
        setSongs((prev) =>
          JSON.stringify(prev) === JSON.stringify(list) ? prev : list
        );
        setLoaded(true);
        setSyncing(false);
      })
      .catch(() => {
        if (!active) return;
        setLoaded(true);
        setSyncing(false);
      });

    const sb = getSupabase();
    // Les changements arrivent en rafale (fusion, import) : on regroupe les
    // rechargements pour éviter des dizaines de listes complètes d'affilée.
    let realtimeTimer: ReturnType<typeof setTimeout> | null = null;
    if (sb) {
      channel = sb
        .channel("shared-songs")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "songs" },
          () => {
            if (realtimeTimer) clearTimeout(realtimeTimer);
            realtimeTimer = setTimeout(() => {
              realtimeTimer = null;
              void loadSharedSongs()
                .then((list) => {
                  if (!active) return;
                  setSongs((prev) =>
                    JSON.stringify(prev) === JSON.stringify(list) ? prev : list
                  );
                })
                .catch(() => {
                  /* réseau indisponible : on garde la liste affichée */
                });
            }, 2500);
          }
        )
        .subscribe();
    }

    return () => {
      active = false;
      if (realtimeTimer) clearTimeout(realtimeTimer);
      if (channel) {
        try {
          channel.unsubscribe();
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  const upsertSong = useCallback(
    async (song: SongTab): Promise<boolean> => {
      setSongs((prev) => {
        const idx = prev.findIndex((s) => s.id === song.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = song;
          return next;
        }
        return [song, ...prev];
      });
      try {
        // Un enregistrement qui n'aboutit pas (réseau coupé, Supabase en
        // veille) ne doit pas bloquer l'appelant indéfiniment.
        await withTimeout(saveSharedSong(song), 25000);
        return true;
      } catch {
        return false;
      }
    },
    []
  );

  const removeSong = useCallback(async (id: string): Promise<boolean> => {
    setSongs((prev) => prev.filter((s) => s.id !== id));
    try {
      await withTimeout(deleteSharedSong(id), 20000);
      return true;
    } catch {
      return false;
    }
  }, []);

  const importLocal = useCallback(async () => {
    setImporting(true);
    setImportError(null);
    try {
      const count = await withTimeout(importAllLocalSongs(), 20000);
      await withTimeout(refresh(), 20000);
      return count;
    } catch (e) {
      setImportError(
        e instanceof Error && e.message === "Délai dépassé"
          ? "Import trop lent pour joindre Supabase. Réessayez."
          : "Erreur pendant l'import."
      );
      return 0;
    } finally {
      setImporting(false);
    }
  }, [refresh]);

  return useMemo(
    () => ({ songs, loaded, syncing, importing, importError, upsertSong, removeSong, importLocal }),
    [songs, loaded, syncing, importing, importError, upsertSong, removeSong, importLocal]
  );
}
