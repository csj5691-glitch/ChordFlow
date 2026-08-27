"use client";

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
  const embedUrl = useMemo(() => {
    const parsed = extractSpotifyUri(trackUrl);
    if (!parsed) return null;
    return `https://open.spotify.com/embed/${parsed.type}/${parsed.id}?utm_source=generator&theme=0`;
  }, [trackUrl]);

  if (!embedUrl) {
    return (
      <div className="p-4 bg-zinc-800/50 rounded-xl border border-zinc-700/50 text-center text-zinc-500 text-sm">
        URL Spotify invalide
      </div>
    );
  }

  return (
    <div className="rounded-xl overflow-hidden border border-zinc-700/50">
      <iframe
        src={embedUrl}
        width="100%"
        height="152"
        frameBorder="0"
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        loading="lazy"
        className="w-full"
      />
    </div>
  );
}
