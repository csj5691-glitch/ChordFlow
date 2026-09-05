// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  let body: { token?: unknown; id?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "corps invalide" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token : "";
  const id = typeof body.id === "string" ? body.id.trim() : "";

  if (!token || !id) {
    return Response.json({ error: "token et id requis" }, { status: 400 });
  }

  const url = `https://api.spotify.com/v1/tracks/${encodeURIComponent(id)}`;
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
      `[spotify-track] upstream ${upstream.status} id="${id}" -> ${text.slice(0, 200)}`
    );
  }
  return new Response(text, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
