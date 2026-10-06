import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STEMS_SERVICE = process.env.STEMS_SERVICE_URL ?? "http://127.0.0.1:8765";
const TOKEN_RE = /^[A-Za-z0-9_-]{8,64}$/;

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token")?.trim() ?? "";
  if (!TOKEN_RE.test(token)) {
    return NextResponse.json({ error: "token invalide" }, { status: 400 });
  }
  let res: Response;
  try {
    res = await fetch(`${STEMS_SERVICE}/progress?token=${encodeURIComponent(token)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    return NextResponse.json(
      { state: "error", line: "service stems injoignable", percent: 0, current: 0, total: 0 },
      { status: 502 }
    );
  }
  if (!res.ok) {
    if (res.status === 404) {
      return NextResponse.json(
        { state: "waiting", line: "téléchargement de la vidéo…", percent: 0, current: 0, total: 0 },
        { status: 200 }
      );
    }
    return NextResponse.json(
      { state: "error", line: "statut indisponible", percent: 0, current: 0, total: 0 },
      { status: 502 }
    );
  }
  const data = await res.json();
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}