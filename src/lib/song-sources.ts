// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { useEffect, useState } from "react";
import { SongTab } from "@/lib/types";
import { loadYouTubeId } from "@/lib/youtube-store";
import { loadSpotifyId } from "@/lib/spotify-store";
import { listAudioStemSongIds } from "@/lib/audio-store";
import { listStemSongIds } from "@/lib/stems-db";

export function songHasYoutube(song: SongTab): boolean {
  return !!(song.youtubeId || loadYouTubeId(song.id));
}

export function songHasSpotify(song: SongTab): boolean {
  return !!(song.spotifyId || loadSpotifyId(song.id));
}

// Ids des chansons qui ont de l'audio local (stems separes ou stems importes).
// Deux lectures d'index seulement : interroger chaque chanson une par une
// (900 requetes) retardait l'affichage des badges de plusieurs secondes.
export function usePersistedUploads(idList: string[]) {
  const [uploads, setUploads] = useState<Set<string>>(new Set());
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [audioIds, stemIds] = await Promise.all([
          listAudioStemSongIds(),
          listStemSongIds(),
        ]);
        if (!active) return;
        const present = new Set<string>([...audioIds, ...stemIds]);
        const withStems = new Set(idList.filter((id) => present.has(id)));
        setUploads(withStems);
        console.log(
          `[ChordFlow] stems: ${present.size} id(s) audio local, ${withStems.size} dans le repertoire`
        );
      } catch {
        if (active) setUploads(new Set());
      }
    })();
    return () => {
      active = false;
    };
  }, [idList]);
  return uploads;
}
