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

  // 2. Récupérer toutes les pistes (parcours paginé).
  // On tente d'abord le nouvel endpoint /items, puis /tracks en repli
  // (Spotify a restreint /tracks sur certains comptes/playlists).
  const tracks: { id: string; title: string; artist: string; uri: string }[] = [];
  const endpoints = [
    (offset: number) =>
      `https://api.spotify.com/v1/playlists/${playlistId}/items?limit=100&offset=${offset}`,
    (offset: number) =>
      `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100&offset=${offset}&fields=items(track(id,name,artists(name),uri)),next`,
  ];
  let useItems = true;
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const url = useItems
      ? endpoints[0](offset)
      : endpoints[1](offset);
    const res = await fetch(url, { headers, cache: "no-store" });
    if (!res.ok) {
      // Si /items échoue en 403, basculer sur /tracks une seule fois.
      if (useItems && res.status === 403) {
        useItems = false;
        offset = 0;
        tracks.length = 0;
        continue;
      }
      // Diagnostic : lire les détails de la playlist et le profil pour
      // comprendre le 403 (propriétaire, marché, scopes effectifs).
      const text = await res.text().catch(() => "");
      let diag = `tracks: ${res.status} ${text.slice(0, 200)}`;
      try {
        const detRes = await fetch(
          `https://api.spotify.com/v1/playlists/${playlistId}`,
          { headers, cache: "no-store" }
        );
        const detText = await detRes.text().catch(() => "");
        diag += ` | playlist: ${detRes.status} ${detText.slice(0, 300)}`;
      } catch (e) {
        diag += ` | playlist err: ${e instanceof Error ? e.message : String(e)}`;
      }
      try {
        const meRes = await fetch("https://api.spotify.com/v1/me", { headers, cache: "no-store" });
        const meText = await meRes.text().catch(() => "");
        diag += ` | me: ${meRes.status} ${meText.slice(0, 200)}`;
      } catch (e) {
        diag += ` | me err: ${e instanceof Error ? e.message : String(e)}`;
      }
      return NextResponse.json({ error: diag }, { status: res.status });
    }
    const data = (await res.json()) as {
      items: { track?: SpotifyTrack | null; item?: SpotifyTrack | null }[];
      next: string | null;
    };
    const items = data.items ?? [];
    if (items.length === 0) {
      hasMore = false;
      break;
    }
    for (const it of items) {
      const t = (it.track ?? it.item) as SpotifyTrack | null;
      if (!t || !t.id) continue;
      tracks.push({
        id: t.id,
        title: t.name,
        artist: (t.artists ?? []).map((a) => a.name).join(", "),
        uri: t.uri,
      });
    }
    offset += items.length;
    hasMore = !!data.next && items.length > 0;
  }

  return NextResponse.json({ playlistId, name, count: tracks.length, tracks });
}