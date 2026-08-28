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

export function useSharedSongs() {
  const [songs, setSongs] = useState<SongTab[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [syncing, setSyncing] = useState(true);
  const [importing, setImporting] = useState(false);

  const refresh = useCallback(async () => {
    const list = await loadSharedSongs();
    setSongs((prev) => (JSON.stringify(prev) === JSON.stringify(list) ? prev : list));
    setSyncing(false);
  }, []);

  useEffect(() => {
    let active = true;
    let channel: RealtimeChannel | null = null;

    loadSharedSongs()
      .then((list) => {
        if (!active) return;
        setSongs(list);
        setLoaded(true);
        setSyncing(false);
      })
      .catch(() => {
        if (!active) return;
        setLoaded(true);
        setSyncing(false);
      });

    const sb = getSupabase();
    if (sb) {
      channel = sb
        .channel("shared-songs")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "songs" },
          async () => {
            const list = await loadSharedSongs();
            if (!active) return;
            setSongs((prev) =>
              JSON.stringify(prev) === JSON.stringify(list) ? prev : list
            );
          }
        )
        .subscribe();
    }

    return () => {
      active = false;
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
    async (song: SongTab) => {
      setSongs((prev) => {
        const idx = prev.findIndex((s) => s.id === song.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = song;
          return next;
        }
        return [song, ...prev];
      });
      await saveSharedSong(song);
    },
    []
  );

  const removeSong = useCallback(async (id: string) => {
    setSongs((prev) => prev.filter((s) => s.id !== id));
    await deleteSharedSong(id);
  }, []);

  const importLocal = useCallback(async () => {
    setImporting(true);
    try {
      const count = await importAllLocalSongs();
      await refresh();
      return count;
    } finally {
      setImporting(false);
    }
  }, [refresh]);

  return useMemo(
    () => ({ songs, loaded, syncing, importing, upsertSong, removeSong, importLocal }),
    [songs, loaded, syncing, importing, upsertSong, removeSong, importLocal]
  );
}
