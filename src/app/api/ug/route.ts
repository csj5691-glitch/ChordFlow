// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { NextRequest } from "next/server";
import { searchUg, fetchUgTab, isDefaultTuning } from "@/lib/ug-scraper";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("query")?.trim();
  if (!query) {
    return Response.json({ error: "query is required" }, { status: 400 });
  }

  try {
    const results = await searchUg(query);
    if (results.length === 0) {
      return Response.json({ error: "No matching tabs found" }, { status: 404 });
    }

    const pick =
      results.find((r) => r.type === "Chords") ||
      results.find((r) => r.type === "Ukulele Chords") ||
      results[0];

    const tab = await fetchUgTab(pick.tabUrl);

    return Response.json({
      artist: tab.artist || pick.artistName,
      title: tab.title || pick.songName,
      content: tab.content,
      key: tab.tonality,
      tuning: tab.tuningLabel && !isDefaultTuning(tab.tuningLabel) ? tab.tuningLabel : undefined,
      capo: tab.capo,
      type: tab.type,
      url: tab.url,
      source: "ultimate-guitar",
    });
  } catch {
    return Response.json({ error: "Ultimate Guitar unavailable" }, { status: 502 });
  }
}
