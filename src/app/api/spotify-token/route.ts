// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { NextRequest } from "next/server";

const UPSTREAM = "https://accounts.spotify.com/api/token";
const RETRIES = 2;
const BACKOFF_MS = 300;

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "corps JSON invalide" }, { status: 400 });
  }

  const grantType =
    typeof body.grant_type === "string" ? body.grant_type : "";
  if (
    grantType !== "authorization_code" &&
    grantType !== "refresh_token"
  ) {
    return Response.json({ error: "grant_type invalide" }, { status: 400 });
  }

  const form = new URLSearchParams({
    grant_type: grantType,
    client_id: typeof body.client_id === "string" ? body.client_id : "",
  });

  if (grantType === "authorization_code") {
    form.set("code", typeof body.code === "string" ? body.code : "");
    form.set("redirect_uri", typeof body.redirect_uri === "string" ? body.redirect_uri : "");
    form.set("code_verifier", typeof body.code_verifier === "string" ? body.code_verifier : "");
  } else {
    form.set("refresh_token", typeof body.refresh_token === "string" ? body.refresh_token : "");
  }

  let upstream: Response | null = null;
  let networkError: unknown = null;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    try {
      upstream = await fetch(UPSTREAM, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "ChordFlow/1.0",
        },
        body: form.toString(),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      networkError = null;
      if (upstream.status < 500) break;
    } catch (err) {
      networkError = err;
      upstream = null;
    }
    if (attempt < RETRIES - 1) {
      await new Promise((r) => setTimeout(r, BACKOFF_MS));
    }
  }

  if (!upstream) {
    return Response.json(
      {
        error: "spotify_injoignable",
        detail: networkError ? String(networkError) : "upstream_injoignable",
      },
      { status: 502 },
    );
  }

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}