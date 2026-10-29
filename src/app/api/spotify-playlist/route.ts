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

  // 2. Récupérer les pistes via /playlists/{id} (champ `tracks` inclus).
  //    Premier appel sans filtre fields pour voir la structure réelle.
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
    tracks?: {
      items?: { track: SpotifyTrack | null }[];
      total?: number;
      next?: string | null;
    };
  };
  const firstItems = firstData.tracks?.items ?? [];
  const total = firstData.tracks?.total ?? 0;

  // Debug si aucune piste détectée.
  if (firstItems.length === 0) {
    return NextResponse.json(
      {
        error: `0 piste détectée. total=${total}, next=${firstData.tracks?.next ?? "null"}, keys=${Object.keys(firstData).join(",")}, trackKeys=${firstItems.length > 0 ? Object.keys(firstItems[0]).join(",") : "n/a"}`,
        playlistId,
        name,
        count: 0,
        tracks: [],
      },
      { status: 200 }
    );
  }

  const tracks: { id: string; title: string; artist: string; uri: string }[] = [];
  for (const it of firstItems) {
    const t = it.track;
    if (!t || !t.id) continue;
    if (tracks.some((x) => x.id === t.id && x.uri === t.uri)) continue;
    tracks.push({
      id: t.id,
      title: t.name,
      artist: (t.artists ?? []).map((a) => a.name).join(", "),
      uri: t.uri,
    });
  }

  // Pagination : si next pointe vers /tracks (403), on ne le suit pas.
  // On tente /playlists/{id} avec offset à la place.
  let offset = firstItems.length;
  while (tracks.length < total && offset < total) {
    const res = await fetch(
      `https://api.spotify.com/v1/playlists/${playlistId}?fields=tracks.items(track(id,name,artists(name),uri)),tracks.total&limit=100&offset=${offset}`,
      { headers, cache: "no-store" }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // On garde ce qu'on a.
      break;
    }
    const data = (await res.json()) as {
      tracks?: { items?: { track: SpotifyTrack | null }[]; total?: number };
    };
    const items = data.tracks?.items ?? [];
    if (items.length === 0) break;
    for (const it of items) {
      const t = it.track;
      if (!t || !t.id) continue;
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