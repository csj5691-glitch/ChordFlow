// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const artist = req.nextUrl.searchParams.get("artist");
  const track = req.nextUrl.searchParams.get("track");

  if (!artist || !track) {
    return Response.json({ error: "artist and track are required" }, { status: 400 });
  }

  const headers = { "User-Agent": "ChordFlow/1.0" };

  // Try LRCLIB first (synced + plain lyrics)
  try {
    const lrclibRes = await fetch(
      `https://lrclib.net/api/search?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(track)}`,
      { headers, next: { revalidate: 3600 } }
    );
    if (lrclibRes.ok) {
      const results = await lrclibRes.json();
      const best = results.find(
        (r: { syncedLyrics?: string; plainLyrics?: string }) =>
          r.syncedLyrics || r.plainLyrics
      );
      if (best) {
        return Response.json({
          source: "lrclib",
          artist: best.artistName,
          track: best.trackName,
          plain: best.plainLyrics || "",
          synced: best.syncedLyrics || "",
        });
      }
    }
  } catch {}

  // Fallback: lyrics.ovh
  try {
    const ovhRes = await fetch(
      `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(track)}`,
      { next: { revalidate: 3600 } }
    );
    if (ovhRes.ok) {
      const data = await ovhRes.json();
      return Response.json({
        source: "lyrics.ovh",
        artist,
        track,
        plain: data.lyrics || "",
        synced: "",
      });
    }
  } catch {}

  return Response.json({ error: "Lyrics not found" }, { status: 404 });
}
