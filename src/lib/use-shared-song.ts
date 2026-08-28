// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { useCallback, useEffect, useMemo, useState } from "react";
import { SongTab } from "./types";
import { loadSharedSongs, saveSharedSong } from "./supabase";
import { getCustomSong, saveCustomSong } from "./custom-songs";

export function useSharedSong(id: string) {
  const [current, setCurrent] = useState<SongTab | null>(() => getCustomSong(id));

  useEffect(() => {
    let active = true;
    loadSharedSongs()
      .then((list) => {
        if (!active) return;
        const found = list.find((s) => s.id === id) ?? null;
        setCurrent(found ?? getCustomSong(id));
      })
      .catch(() => {
        if (!active) return;
        setCurrent(getCustomSong(id));
      });
    return () => {
      active = false;
    };
  }, [id]);

  const upsert = useCallback((song: SongTab) => {
    setCurrent(song);
    saveCustomSong(song);
    return saveSharedSong(song);
  }, []);

  return useMemo(() => ({ current, upsert }), [current, upsert]);
}
