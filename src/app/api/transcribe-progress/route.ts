// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { NextRequest, NextResponse } from "next/server";
import {
  getTranscribeProgress,
  touchTranscribeProgress,
} from "@/lib/transcribe-progress";

const TRANSCRIBE_SERVICE =
  process.env.TRANSCRIBE_SERVICE_URL ?? "http://127.0.0.1:8766";
const TOKEN_RE = /^[A-Za-z0-9_-]{8,64}$/;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Fusionne la progression locale (telechargement / conversion) et celle du
// service Python (analyse des notes ou des accords).
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")?.trim() ?? "";
  if (!TOKEN_RE.test(token)) {
    return NextResponse.json({ error: "token invalide" }, { status: 400 });
  }
  touchTranscribeProgress(token);
  const local = getTranscribeProgress(token);

  if (local && (local.phase === "download" || local.phase === "convert")) {
    return NextResponse.json(
      { state: "running", phase: local.phase, percent: local.percent, line: local.line },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const res = await fetch(
      `${TRANSCRIBE_SERVICE}/progress?token=${encodeURIComponent(token)}`,
      { cache: "no-store", signal: AbortSignal.timeout(2000) }
    );
    if (res.ok) {
      const data = (await res.json()) as {
        state?: string;
        percent?: number;
        line?: string;
      };
      return NextResponse.json(
        {
          state: data.state ?? "running",
          phase: local?.phase ?? "notes",
          percent: typeof data.percent === "number" ? data.percent : 0,
          line: data.line ?? "analyse en cours…",
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
  } catch {
    // service injoignable : on garde la derniere progression connue
  }

  return NextResponse.json(
    {
      state: "running",
      phase: local?.phase ?? "notes",
      percent: local?.percent ?? 0,
      line: local?.line ?? "analyse en cours…",
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
