// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  let body: {
    token?: unknown;
    deviceId?: unknown;
    uri?: unknown;
    parsedUri?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "corps invalide" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token : "";
  const deviceId = typeof body.deviceId === "string" ? body.deviceId : "";
  const uri = typeof body.uri === "string" ? body.uri : "";
  const parsedUri = body.parsedUri as { type?: string } | null | undefined;

  if (!token || !deviceId || !uri) {
    return Response.json({ error: "params manquants" }, { status: 400 });
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "ChordFlow/1.0",
  };

  const playBody =
    parsedUri?.type === "track"
      ? JSON.stringify({ uris: [uri] })
      : JSON.stringify({
          context_uri: uri,
          offset: { position: 0 },
        });

  const transfer = await fetch("https://api.spotify.com/v1/me/player", {
    method: "PUT",
    headers,
    body: JSON.stringify({ device_ids: [deviceId], play: false }),
    cache: "no-store",
  });

  if (transfer.status !== 204 && transfer.status !== 200) {
    const txt = await transfer.text();
    console.error(
      `[spotify-play] transfer ${transfer.status} -> ${txt.slice(0, 200)}`
    );
  } else {
    await new Promise((r) => setTimeout(r, 300));
    const play = await fetch(
      `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`,
      {
        method: "PUT",
        headers,
        body: playBody,
        cache: "no-store",
      }
    );
    if (play.status !== 204 && play.status !== 200) {
      const txt = await play.text();
      console.error(
        `[spotify-play] play ${play.status} -> ${txt.slice(0, 200)}`
      );
      return Response.json(
        { ok: false, status: play.status, error: txt.slice(0, 200) },
        { status: play.status }
      );
    }
  }

  return Response.json({ ok: true });
}