// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { useCallback, useEffect, useMemo, useState } from "react";
import { SongTab } from "./types";
import { loadSharedSong, saveSharedSong } from "./supabase";
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
    loadSharedSong(id)
      .then((shared) => {
        if (!active) return;
        // Fusion champ par champ : le local fait foi pour ce que le serveur
        // n'a pas encore (upsert Supabase en cours ou echoue). Sans cela, une
        // tablature fraichement appliquee pouvait disparaitre de l'ecran au
        // rechargement alors qu'elle etait bien enregistree sur l'appareil.
        if (!shared || !cachedLocal) {
          setCurrent(shared ?? cachedLocal);
          return;
        }
        const merged: SongTab = { ...shared };
        if (!shared.officialSynced && cachedLocal.officialSynced) {
          merged.officialSynced = cachedLocal.officialSynced;
        }
        if (!shared.transcribedTab && cachedLocal.transcribedTab) {
          merged.transcribedTab = cachedLocal.transcribedTab;
        }
        if (!shared.transcribedChords && cachedLocal.transcribedChords) {
          merged.transcribedChords = cachedLocal.transcribedChords;
        }
        console.log("[ChordFlow] useSharedSong load", { id, hasLocal: !!cachedLocal, hasShared: !!shared, tab: merged.transcribedTab?.length ?? null, chords: merged.transcribedChords?.length ?? null });
        setCurrent(merged);
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