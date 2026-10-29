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
  //    On lit les deux champs pour compatibilité.
  const tracks: { id: string; title: string; artist: string; uri: string }[] = [];

  // Premier appel : /playlists/{id} sans fields pour avoir la structure complète.
  const firstRes = await fetch(
    `https://api.spotify.com/v1/playlists/${playlistId}`,
    { headers, cache: "no-store" }
  );
  if (!firstRes.ok) {
    const text = await firstRes.text().catch(() => "");
    return NextResponse.json(
      { error: `details: ${firstRes.status} ${text.slice(0, 200)}` },
      { status: firstRes.status }
    );
  }
  const firstData = (await firstRes.json()) as {
    items?: { track?: SpotifyTrack | null; item?: SpotifyTrack | null }[] | { items?: { track?: SpotifyTrack | null; item?: SpotifyTrack | null }[]; total?: number; next?: string | null };
    tracks?: {
      items?: { track: SpotifyTrack | null }[];
      total?: number;
      next?: string | null;
    };
    total?: number;
  };
  // Spotify (fin 2024) a renommé `tracks` → `items`, et `items` est maintenant
  // un objet paginé { items, total, next } (plus un tableau direct).
  let rawItems: { track?: SpotifyTrack | null; item?: SpotifyTrack | null }[] = [];
  if (Array.isArray(firstData.items)) {
    rawItems = firstData.items;
  } else if (firstData.items && Array.isArray((firstData.items as { items?: unknown[] }).items)) {
    rawItems = (firstData.items as { items: { track?: SpotifyTrack | null; item?: SpotifyTrack | null }[] }).items;
  } else if (Array.isArray(firstData.tracks?.items)) {
    rawItems = firstData.tracks!.items as { track?: SpotifyTrack | null; item?: SpotifyTrack | null }[];
  }
  const firstItems = rawItems;
  const total =
    (firstData.items && !Array.isArray(firstData.items)
      ? (firstData.items as { total?: number }).total
      : undefined) ??
    firstData.tracks?.total ??
    firstItems.length;

  // Debug si aucune piste détectée.
  if (firstItems.length === 0) {
    return NextResponse.json(
      {
        error: `0 piste détectée. total=${total}, keys=${Object.keys(firstData).join(",")}, itemsLen=${firstItems.length}`,
        playlistId,
        name,
        count: 0,
        tracks: [],
      },
      { status: 200 }
    );
  }

  for (const it of firstItems) {
    const t = (it.track ?? it.item ?? (it as unknown as SpotifyTrack)) as SpotifyTrack | null;
    if (!t || !t.id || !t.name) continue;
    if (tracks.some((x) => x.id === t.id && x.uri === t.uri)) continue;
    tracks.push({
      id: t.id,
      title: t.name,
      artist: (t.artists ?? []).map((a) => a.name).join(", "),
      uri: t.uri,
    });
  }

  // Pagination : on tente /playlists/{id} avec offset (peut ne pas marcher).
  // Si ça échoue, on garde ce qu'on a.
  let offset = firstItems.length;
  while (tracks.length < total && offset < total && firstItems.length >= 100) {
    const res = await fetch(
      `https://api.spotify.com/v1/playlists/${playlistId}?limit=100&offset=${offset}`,
      { headers, cache: "no-store" }
    );
    if (!res.ok) break;
    const data = (await res.json()) as {
      items?: { track?: SpotifyTrack | null; item?: SpotifyTrack | null }[] | { items?: { track?: SpotifyTrack | null; item?: SpotifyTrack | null }[]; total?: number };
      tracks?: { items?: { track: SpotifyTrack | null }[]; total?: number };
    };
    let items: { track?: SpotifyTrack | null; item?: SpotifyTrack | null }[] = [];
    if (Array.isArray(data.items)) {
      items = data.items;
    } else if (data.items && Array.isArray((data.items as { items?: unknown[] }).items)) {
      items = (data.items as { items: { track?: SpotifyTrack | null; item?: SpotifyTrack | null }[] }).items;
    } else if (Array.isArray(data.tracks?.items)) {
      items = data.tracks!.items as { track?: SpotifyTrack | null; item?: SpotifyTrack | null }[];
    }
    if (items.length === 0) break;
    for (const it of items) {
      const t = (it.track ?? it.item ?? (it as unknown as SpotifyTrack)) as SpotifyTrack | null;
      if (!t || !t.id || !t.name) continue;
      if (tracks.some((x) => x.id === t.id && x.uri === t.uri)) continue;
      tracks.push({
        id: t.id,
        title: t.name,
        artist: (t.artists ?? []).map((a) => a.name).join(", "),
        uri: t.uri,
      });
    }
    offset += items.length;
    if (items.length < 100) break;
  }

  return NextResponse.json({ playlistId, name, count: tracks.length, tracks });
}