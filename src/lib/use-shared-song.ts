// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { useCallback, useEffect, useMemo, useState } from "react";
import { SongTab } from "./types";
import { loadSharedSongs, saveSharedSong } from "./supabase";
import { loadLocalSong } from "./custom-songs";

export function useSharedSong(id: string) {
  const [current, setCurrent] = useState<SongTab | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let cachedLocal: SongTab | null = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    void loadLocalSong(id).then((local) => {
      cachedLocal = local;
      if (!active) return;
      setCurrent((prev) => prev ?? local);
    });
    loadSharedSongs()
      .then((list) => {
        if (!active) return;
        setCurrent(list.find((s) => s.id === id) ?? cachedLocal);
      })
      .catch(() => {
        if (!active) return;
        setCurrent(cachedLocal);
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id]);

  const upsert = useCallback((song: SongTab) => {
    setCurrent(song);
    return saveSharedSong(song);
  }, []);

  return useMemo(() => ({ current, loading, upsert }), [current, loading, upsert]);
}