// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json();

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
    client_id: body.client_id ?? "",
  });

  if (grantType === "authorization_code") {
    form.set("code", body.code ?? "");
    form.set("redirect_uri", body.redirect_uri ?? "");
    form.set("code_verifier", body.code_verifier ?? "");
  } else {
    form.set("refresh_token", body.refresh_token ?? "");
  }

  const upstream = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "ChordFlow/1.0",
    },
    body: form.toString(),
    cache: "no-store",
  });

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}