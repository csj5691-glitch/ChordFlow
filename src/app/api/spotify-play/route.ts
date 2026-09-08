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

  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function getKnownDevices(): Promise<{
    ok: boolean;
    ids: string[];
    names: string[];
  }> {
    const res = await fetch("https://api.spotify.com/v1/me/player/devices", {
      headers,
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, ids: [], names: [] };
    try {
      const json = await res.json();
      const devices = (json?.devices ?? []) as {
        id?: string;
        name?: string;
      }[];
      return {
        ok: true,
        ids: devices.map((d) => d.id ?? ""),
        names: devices.map((d) => d.name ?? ""),
      };
    } catch {
      return { ok: false, ids: [], names: [] };
    }
  }

  const playBody =
    parsedUri?.type === "track"
      ? JSON.stringify({ uris: [uri] })
      : JSON.stringify({
          context_uri: uri,
          offset: { position: 0 },
        });

  const attemptTransfer = () =>
    fetch("https://api.spotify.com/v1/me/player", {
      method: "PUT",
      headers,
      body: JSON.stringify({ device_ids: [deviceId], play: false }),
      cache: "no-store",
    });

  const isTransferOk = (r: Response) =>
    r.status === 204 || r.status === 200;

  async function ensureDeviceRegistered(): Promise<boolean> {
    const deadline = Date.now() + 6_000;
    for (;;) {
      const known = await getKnownDevices();
      if (known.ok && known.ids.includes(deviceId)) return true;
      if (Date.now() >= deadline) return false;
      await wait(1000);
    }
  }

  let transfer: Response | null = null;

  if (await ensureDeviceRegistered()) {
    transfer = await attemptTransfer();
  } else {
    console.log(
      `[spotify-play] device ${deviceId} absent de la liste → transfert direct comme déclencheur d'enregistrement`
    );
    transfer = await attemptTransfer();
    if (!isTransferOk(transfer)) {
      await wait(1500);
      transfer = await attemptTransfer();
    }
  }

  if (transfer && !isTransferOk(transfer)) {
    const fTransfer = transfer;
    const txt = await fTransfer.text();
    console.error(
      `[spotify-play] transfer ${fTransfer.status} -> ${txt.slice(0, 200)}`
    );
    const known = await getKnownDevices();
    const detail = known.ok
      ? known.ids.join(", ") || "(liste vide)"
      : "(indisponible)";
    return Response.json(
      {
        ok: false,
        status: fTransfer.status,
        error:
          fTransfer.status === 404
            ? `DEVICE_NOT_ON_ACCOUNT devices=[${detail}]`
            : txt.slice(0, 200),
      },
      { status: fTransfer.status }
    );
  }
  console.log(`[spotify-play] transfer OK (${transfer?.status}) device=${deviceId}`);

  await wait(300);
  let play = await fetch(
    `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`,
    {
      method: "PUT",
      headers,
      body: playBody,
      cache: "no-store",
    }
  );

  if (play.status === 404) {
    for (let i = 0; i < 10; i++) {
      await wait(1000);
      const next = await getKnownDevices();
      if (!next.ok) break;
      if (!next.ids.includes(deviceId)) continue;
      play = await fetch(
        `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`,
        {
          method: "PUT",
          headers,
          body: playBody,
          cache: "no-store",
        }
      );
      if (play.status === 204 || play.status === 200) break;
    }
  }

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
  console.log(`[spotify-play] play OK (${play.status}) uri=${uri}`);

  return Response.json({ ok: true });
}