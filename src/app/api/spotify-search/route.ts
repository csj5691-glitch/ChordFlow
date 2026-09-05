// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  let body: { token?: unknown; q?: unknown };
  try {
    body = await req.json();
  } catch {
    console.error("[spotify-search] corps invalide (JSON non lisible)");
    return Response.json({ error: "corps invalide" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token : "";
  const q = typeof body.q === "string" ? body.q.trim() : "";

  if (!token || !q) {
    console.error(
      `[spotify-search] params manquants token=${token.length} q="${q}"`
    );
    return Response.json({ error: "token et q requis" }, { status: 400 });
  }

  const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=10`;
  const upstream = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "ChordFlow/1.0",
    },
    cache: "no-store",
  });

  const text = await upstream.text();
  if (!upstream.ok) {
    console.error(
      `[spotify-search] upstream ${upstream.status} q="${q}" -> ${text.slice(0, 200)}`
    );
  }
  return new Response(text, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}