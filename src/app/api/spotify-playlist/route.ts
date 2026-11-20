// Copyright (c) 2026 Claude St-Jean. All rights reserved.
import { NextRequest, NextResponse } from "next/server";

interface SpotifyTrack {
  id: string | null;
  name: string;
  artists: { name: string }[];
  uri: string;
}

interface SpotifyPlaylistItem {
  id: string;
  name: string;
}

export async function POST(req: NextRequest) {
  try {
    return await handlePost(req);
  } catch (e) {
    const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
    console.error("[spotify-playlist] erreur non gérée:", msg);
    return NextResponse.json({ error: `erreur serveur: ${msg.slice(0, 500)}` }, { status: 500 });
  }
}

async function handlePost(req: NextRequest): Promise<NextResponse> {
  let body: { token?: unknown; name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "corps invalide" }, { status: 400 });
  }
  const token = typeof body.token === "string" ? body.token : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!token || !name) {
    return NextResponse.json({ error: "token et name requis" }, { status: 400 });
  }

  const headers = { Authorization: `Bearer ${token}`, "User-Agent": "ChordFlow/1.0" };

  // 1. Trouver la playlist par nom (parcours paginé).
  let playlistId: string | null = null;
  let url = "https://api.spotify.com/v1/me/playlists?limit=50";
  while (url) {
    const res = await fetch(url, { headers, cache: "no-store" });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `playlists: ${res.status} ${text.slice(0, 200)}` },
        { status: res.status }
      );
    }
    const data = (await res.json()) as {
      items: SpotifyPlaylistItem[];
      next: string | null;
    };
    const found = (data.items ?? []).find(
      (p) => p.name?.toLowerCase() === name.toLowerCase()
    );
    if (found) {
      playlistId = found.id;
      break;
    }
    url = data.next ?? "";
    if (!url) break;
  }
  if (!playlistId) {
    return NextResponse.json(
      { error: `playlist « ${name} » introuvable` },
      { status: 404 }
    );
  }

  // 2. Récupérer les pistes. Spotify a renommé `tracks` → `items` (fin 2024).
  // 2. Récupérer toutes les pistes.
  //    On privilégie l'endpoint /tracks (paginé via next). En cas de refus (403),
  //    repli sur l'objet playlist puis suivi de next pour récupérer ce qui est possible.
  const tracks: { id: string; title: string; artist: string; uri: string }[] = [];
  const seen = new Set<string>();

  const pushItems = (items: { track?: SpotifyTrack | null; item?: SpotifyTrack | null }[]) => {
    for (const it of items) {
      const t = (it.track ?? it.item ?? (it as unknown as SpotifyTrack)) as SpotifyTrack | null;
      if (!t || !t.id || !t.name) continue;
      const key = `${t.id}|${t.uri ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tracks.push({
        id: t.id,
        title: t.name,
        artist: (t.artists ?? []).map((a) => a.name).join(", "),
        uri: t.uri ?? "",
      });
    }
  };

  const fetchPaging = async (startUrl: string): Promise<{ ok: boolean; status?: number; detail?: string }> => {
    let nextUrl: string | null = startUrl;
    while (nextUrl) {
      const res = await fetch(nextUrl, { headers, cache: "no-store" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return { ok: false, status: res.status, detail: text.slice(0, 200) };
      }
      const data = (await res.json()) as any;
      let pageItems: any[] = [];
      let pageNext: string | null = null;
      if (Array.isArray(data?.items) && (data?.next !== undefined || data?.total !== undefined || data?.offset !== undefined || data?.limit !== undefined)) {
        pageItems = data.items;
        pageNext = typeof data.next === "string" ? data.next : null;
      } else if (data?.tracks && Array.isArray(data.tracks.items)) {
        pageItems = data.tracks.items;
        pageNext = typeof data.tracks.next === "string" ? data.tracks.next : null;
      } else if (data?.items && !Array.isArray(data.items) && Array.isArray(data.items.items)) {
        pageItems = data.items.items;
        pageNext = typeof data.items.next === "string" ? data.items.next : null;
      } else if (Array.isArray(data?.items)) {
        pageItems = data.items;
        pageNext = null;
      } else {
        pageItems = [];
        pageNext = null;
      }
      pushItems(pageItems);
      nextUrl = pageNext;
    }
    return { ok: true };
  };

  // Essai 1 : endpoint /tracks (paginé)
  let paging = await fetchPaging(
    `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100&offset=0`
  );

  // Repli : si /tracks est refusé, tenter via l'objet playlist puis next
  if (!paging.ok && tracks.length === 0) {
    paging = await fetchPaging(`https://api.spotify.com/v1/playlists/${playlistId}`);
  }

  if (!paging.ok && tracks.length === 0) {
    return NextResponse.json(
      { error: `tracks: ${paging.status ?? 500} ${paging.detail ?? ""}` },
      { status: paging.status ?? 500 }
    );
  }

  if (!paging.ok && tracks.length > 0) {
    return NextResponse.json({
      playlistId,
      name,
      count: tracks.length,
      tracks,
      warning: `Récupération partielle (${tracks.length} pistes) : ${paging.status ?? "erreur"} ${paging.detail ?? ""}`.trim(),
    });
  }

  return NextResponse.json({ playlistId, name, count: tracks.length, tracks });
}