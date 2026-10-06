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

interface RevisionListEntry {
  revisionId?: number;
  artist?: string;
  title?: string;
  tracksCount?: number;
  createdAt?: string;
  isDeleted?: boolean;
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

async function listRevisions(songId: number) {
  try {
    const revRes = await fetch(
      `https://www.songsterr.com/api/meta/${songId}/revisions`,
      { headers: UA_HEADERS, cache: "no-store" }
    );
    if (!revRes.ok) {
      return Response.json({ error: "Songsterr inaccessible" }, { status: 502 });
    }
    const revisions: RevisionListEntry[] = await revRes.json();
    if (!Array.isArray(revisions)) {
      return Response.json({ error: "Réponse Songsterr invalide" }, { status: 502 });
    }

    // Chaque entrée contient déjà tracksCount + createdAt ; on sonde ensuite la
    // source GP (une requête par révision) pour distinguer exportable / web.
    const list = revisions
      .filter((r) => !r.isDeleted)
      .slice(0, 8)
      .map((r) => ({ revisionId: r.revisionId ?? 0, createdAt: r.createdAt ?? "" }));

    const out: {
      revisionId: number;
      artist: string;
      title: string;
      tracksCount: number;
      createdAt: string;
      exportable: boolean;
    }[] = [];

    for (const item of list) {
      let exportable = false;
      try {
        const rRes = await fetch(
          `https://www.songsterr.com/api/revision/${item.revisionId}`,
          { headers: UA_HEADERS, cache: "no-store" }
        );
        if (rRes.ok) {
          const d = (await rRes.json()) as RevisionDetail;
          exportable = Boolean(d.source);
        }
      } catch {
        exportable = false;
      }
      const meta = revisions.find((r) => r.revisionId === item.revisionId);
      out.push({
        revisionId: item.revisionId,
        artist: meta?.artist ?? "",
        title: meta?.title ?? "",
        tracksCount: meta?.tracksCount ?? 0,
        createdAt: item.createdAt,
        exportable,
      });
      await sleep(PROBE_DELAY_MS);
    }

    return Response.json({ revisions: out });
  } catch {
    return Response.json({ error: "Songsterr inaccessible" }, { status: 502 });
  }
}

async function downloadRevision(revisionId: number) {
  try {
    const rRes = await fetch(
      `https://www.songsterr.com/api/revision/${revisionId}`,
      { headers: UA_HEADERS, cache: "no-store" }
    );
    if (!rRes.ok) {
      return Response.json({ error: "Révision introuvable sur Songsterr" }, { status: 404 });
    }
    const detail = (await rRes.json()) as RevisionDetail;
    const source = detail.source ?? "";
    const artist = typeof detail.artist === "string" ? detail.artist : "";
    const title = typeof detail.title === "string" ? detail.title : "";
    if (!source) {
      return Response.json(
        {
          error:
            "Cette révision n'est pas exportable en Guitar Pro (version web uniquement). Choisissez-en une marquée GP dans la liste.",
        },
        { status: 404 }
      );
    }
    const fileRes = await fetch(source, { headers: UA_HEADERS, redirect: "follow" });
    if (!fileRes.ok) {
      return Response.json({ error: `Téléchargement impossible (${fileRes.status})` }, { status: 502 });
    }
    const buf = await fileRes.arrayBuffer();
    const base = `${artist || "songsterr"} - ${title || String(revisionId)}`.replace(/[\\/:*?"<>|]/g, "-");
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
  const revisionIdRaw = req.nextUrl.searchParams.get("revisionId");

  if (revisionIdRaw !== null) {
    const revisionId = Number(revisionIdRaw);
    if (!Number.isInteger(revisionId) || revisionId <= 0) {
      return Response.json({ error: "revisionId invalide" }, { status: 400 });
    }
    return downloadRevision(revisionId);
  }

  if (songIdRaw !== null) {
    const songId = Number(songIdRaw);
    if (!Number.isInteger(songId) || songId <= 0) {
      return Response.json({ error: "songId invalide" }, { status: 400 });
    }
    if (req.nextUrl.searchParams.get("revisions") === "1") {
      return listRevisions(songId);
    }
    return downloadGp(songId);
  }

  const pattern = req.nextUrl.searchParams.get("pattern");
  if (!pattern || !pattern.trim()) {
    return Response.json({ error: "pattern requis" }, { status: 400 });
  }
  return search(pattern.trim());
}
