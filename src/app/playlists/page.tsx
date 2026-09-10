"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.


import { useMemo } from "react";
import { useSharedSongs } from "@/lib/use-shared-songs";
import { usePersistedUploads } from "@/lib/song-sources";
import PlaylistsPanel from "@/components/PlaylistsPanel";
import { ListMusic } from "lucide-react";

export default function PlaylistsPage() {
  const { songs } = useSharedSongs();
  const songIds = useMemo(() => songs.map((s) => s.id), [songs]);
  const uploads = usePersistedUploads(songIds);

  return (
    <div className="flex flex-col items-center min-h-screen">
      <header className="w-full pt-12 pb-6">
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <ListMusic className="w-5 h-5 text-amber-400" />
            Mes playlists
          </h1>
          <p className="text-zinc-500 text-sm">
            Jouez vos chansons en continu
          </p>
        </div>
      </header>

      <main className="flex-1 w-full flex flex-col items-center px-4 pb-16">
        <PlaylistsPanel songs={songs} uploads={uploads} />
      </main>
    </div>
  );
}