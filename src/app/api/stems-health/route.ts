import { NextResponse } from "next/server";

const STEMS_SERVICE = process.env.STEMS_SERVICE_URL ?? "http://127.0.0.1:8765";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await fetch(`${STEMS_SERVICE}/health`, {
      signal: AbortSignal.timeout(2_500),
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `service stems : health ${res.status}` },
        { status: 503 },
      );
    }
    const data = await res.json();
    return NextResponse.json({ ok: true, ...data });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "service stems injoignable — lance start-stems.bat puis utilise localhost:3000",
      },
      { status: 503 },
    );
  }
}