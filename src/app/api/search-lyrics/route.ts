// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { NextRequest } from "next/server";

const HEADERS = { "User-Agent": "ChordFlow/1.0" };

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q");
  if (!q) {
    return Response.json({ error: "q is required" }, { status: 400 });
  }

  // Search LRCLIB
  try {
    const res = await fetch(
      `https://lrclib.net/api/search?q=${encodeURIComponent(q)}`,
      { headers: HEADERS, next: { revalidate: 600 } }
    );
    if (res.ok) {
      const results = await res.json();
      const mapped = results.slice(0, 10).map(
        (r: {
          id: number;
          trackName: string;
          artistName: string;
          albumName?: string;
          duration?: number;
          instrumental: boolean;
          syncedLyrics?: string;
          plainLyrics?: string;
        }) => ({
          id: String(r.id),
          title: r.trackName,
          artist: r.artistName,
          album: r.albumName || "",
          duration: r.duration || 0,
          instrumental: r.instrumental,
          hasSynced: !!r.syncedLyrics,
          hasPlain: !!r.plainLyrics,
        })
      );
      return Response.json({ source: "lrclib", results: mapped });
    }
  } catch {}

  return Response.json({ source: "lrclib", results: [] });
}
