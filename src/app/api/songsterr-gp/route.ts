// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { NextRequest } from "next/server";

const UA_HEADERS = { "User-Agent": "ChordFlow/1.0" };

interface SearchEntry {
  songId: number;
  artist?: string;
  title?: string;
  tracks?: unknown[];
}

interface RevisionMeta {
  revisionId: number;
}

interface RevisionDetail {
  artist?: string;
  title?: string;
  source?: string;
}

const PROBE_DELAY_MS = 120;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function search(pattern: string) {
  try {
    const res = await fetch(
      `https://www.songsterr.com/api/songs?pattern=${encodeURIComponent(pattern)}`,
      { headers: UA_HEADERS, next: { revalidate: 86400 } }
    );
    if (!res.ok) {
      return Response.json({ error: "Songsterr inaccessible" }, { status: 502 });
    }
    const data: SearchEntry[] = await res.json();
    if (!Array.isArray(data)) {
      return Response.json({ error: "Réponse Songsterr invalide" }, { status: 502 });
    }
    const results = data.slice(0, 8).map((s) => ({
      songId: s.songId,
      artist: s.artist ?? "",
      title: s.title ?? "",
      tracksCount: Array.isArray(s.tracks) ? s.tracks.length : 0,
    }));
    return Response.json({ results });
  } catch {
    return Response.json({ error: "Songsterr inaccessible" }, { status: 502 });
  }
}

async function downloadGp(songId: number) {
  try {
    const revRes = await fetch(
      `https://www.songsterr.com/api/meta/${songId}/revisions`,
      { headers: UA_HEADERS, cache: "no-store" }
    );
    if (!revRes.ok) {
      return Response.json({ error: "Tablature introuvable sur Songsterr" }, { status: 404 });
    }
    const revisions: RevisionMeta[] = await revRes.json();
    if (!Array.isArray(revisions)) {
      return Response.json({ error: "Réponse Songsterr invalide" }, { status: 502 });
    }

    // Songsterr stopped exposing GP source links for revisions created after
    // March 2026, and the list runs newest → oldest: binary-search the newest
    // revision that still carries a source (~log2 probes instead of hundreds,
    // which would trip Songsterr's connection limits). Blocked/deleted flags
    // only reflect moderation, not file availability, so never skip on them.
    // A failed probe counts as "no source here", not as a fatal error.
    const probe = async (index: number): Promise<RevisionDetail | null> => {
      try {
        const rRes = await fetch(
          `https://www.songsterr.com/api/revision/${revisions[index].revisionId}`,
          { headers: UA_HEADERS, cache: "no-store" }
        );
        if (!rRes.ok) return null;
        return (await rRes.json()) as RevisionDetail;
      } catch {
        return null;
      }
    };

    let lo = 0;
    let hi = revisions.length - 1;
    let best: RevisionDetail | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      await sleep(PROBE_DELAY_MS);
      const detail = await probe(mid);
      if (detail?.source) {
        best = detail;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }

    const source = best?.source ?? "";
    const artist = typeof best?.artist === "string" ? best.artist : "";
    const title = typeof best?.title === "string" ? best.title : "";

    if (!source) {
      return Response.json(
        {
          error:
            "Aucun fichier Guitar Pro disponible pour cette tab (aucune révision exportable). Essaie un autre résultat de recherche.",
        },
        { status: 404 }
      );
    }

    const fileRes = await fetch(source, { headers: UA_HEADERS, redirect: "follow" });
    if (!fileRes.ok) {
      return Response.json({ error: `Téléchargement impossible (${fileRes.status})` }, { status: 502 });
    }
    const buf = await fileRes.arrayBuffer();
    const base = `${artist || "songsterr"} - ${title || String(songId)}`.replace(/[\\/:*?"<>|]/g, "-");
    return new Response(buf, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${base}.gp"`,
        "Content-Length": String(buf.byteLength),
      },
    });
  } catch {
    return Response.json({ error: "Songsterr inaccessible" }, { status: 502 });
  }
}

export async function GET(req: NextRequest) {
  const songIdRaw = req.nextUrl.searchParams.get("songId");
  if (songIdRaw !== null) {
    const songId = Number(songIdRaw);
    if (!Number.isInteger(songId) || songId <= 0) {
      return Response.json({ error: "songId invalide" }, { status: 400 });
    }
    return downloadGp(songId);
  }

  const pattern = req.nextUrl.searchParams.get("pattern");
  if (!pattern || !pattern.trim()) {
    return Response.json({ error: "pattern requis" }, { status: 400 });
  }
  return search(pattern.trim());
}
