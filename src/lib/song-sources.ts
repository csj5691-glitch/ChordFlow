// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { useEffect, useState } from "react";
import { SongTab } from "@/lib/types";
import { loadYouTubeId } from "@/lib/youtube-store";
import { loadSpotifyId } from "@/lib/spotify-store";
import { hasAudioStems } from "@/lib/audio-store";
import { loadStems } from "@/lib/stems-db";

export function songHasYoutube(song: SongTab): boolean {
  return !!(song.youtubeId || loadYouTubeId(song.id));
}

export function songHasSpotify(song: SongTab): boolean {
  return !!(song.spotifyId || loadSpotifyId(song.id));
}

export function usePersistedUploads(idList: string[]) {
  const [uploads, setUploads] = useState<Set<string>>(new Set());
  useEffect(() => {
    let active = true;
    const check = async () => {
      const withStems = new Set<string>();
      // Traitement par lots : 900 lectures IndexedDB en serie prenaient
      // plusieurs secondes (badges absents au premier affichage).
      const BATCH = 24;
      for (let i = 0; i < idList.length; i += BATCH) {
        const batch = idList.slice(i, i + BATCH);
        const found = await Promise.all(
          batch.map(async (id) => {
            try {
              // Presence seulement (count) : charger les blobs de 900
              // chansons saturerait la memoire.
              if (await hasAudioStems(id)) return id;
              if ((await loadStems(id)).length > 0) return id;
            } catch {
              // ignorer (IndexedDB indisponible)
            }
            return null;
          })
        );
        if (!active) return;
        for (const id of found) if (id) withStems.add(id);
        if (withStems.size > 0) setUploads(new Set(withStems));
      }
      if (active) setUploads(new Set(withStems));
    };
    check();
    return () => {
      active = false;
    };
  }, [idList]);
  return uploads;
}