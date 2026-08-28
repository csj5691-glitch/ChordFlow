"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.


import { useMemo } from "react";

interface SpotifyPlayerProps {
  trackUrl: string;
}

function extractSpotifyUri(url: string): { type: string; id: string } | null {
  const trimmed = url.trim();

  const spotifyComMatch = trimmed.match(/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(track|album|playlist|episode|show)\/([a-zA-Z0-9]+)/);
  if (spotifyComMatch) {
    return { type: spotifyComMatch[1], id: spotifyComMatch[2] };
  }

  const uriMatch = trimmed.match(/spotify:(track|album|playlist|episode|show):([a-zA-Z0-9]+)/);
  if (uriMatch) {
    return { type: uriMatch[1], id: uriMatch[2] };
  }

  return null;
}

export default function SpotifyPlayer({ trackUrl }: SpotifyPlayerProps) {
  const openUrl = useMemo(() => {
    const parsed = extractSpotifyUri(trackUrl);
    if (!parsed) return null;
    return `https://open.spotify.com/${parsed.type}/${parsed.id}`;
  }, [trackUrl]);

  if (!openUrl) {
    return (
      <div className="p-4 bg-zinc-800/50 rounded-xl border border-zinc-700/50 text-center text-zinc-500 text-sm">
        URL Spotify invalide
      </div>
    );
  }

  return (
    <div className="rounded-xl overflow-hidden border border-zinc-700/50">
      <a
        href={openUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-3 p-4 bg-zinc-800/80 hover:bg-zinc-800 transition-colors"
      >
        <svg className="w-10 h-10 flex-shrink-0 text-green-500" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
        </svg>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white">Écouter sur Spotify</p>
          <p className="text-xs text-zinc-400 truncate">Le lecteur s&apos;ouvre dans Spotify</p>
        </div>
        <svg className="w-4 h-4 text-zinc-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      </a>
    </div>
  );
}
