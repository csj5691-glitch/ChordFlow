// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { useEffect, useState } from "react";
import { SongTab } from "@/lib/types";
import { loadYouTubeId } from "@/lib/youtube-store";
import { loadSpotifyId } from "@/lib/spotify-store";
import { loadAudioStems } from "@/lib/audio-store";

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
      for (const id of idList) {
        try {
          if (await loadAudioStems(id)) withStems.add(id);
        } catch {
          // ignorer (IndexedDB indisponible)
        }
      }
      if (active) setUploads(withStems);
    };
    check();
    return () => {
      active = false;
    };
  }, [idList]);
  return uploads;
}