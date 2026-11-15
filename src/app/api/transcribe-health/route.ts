import { NextResponse } from "next/server";

const TRANSCRIBE_SERVICE = process.env.TRANSCRIBE_SERVICE_URL ?? "http://127.0.0.1:8766";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await fetch(`${TRANSCRIBE_SERVICE}/health`, {
      signal: AbortSignal.timeout(2_500),
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `service transcribe : health ${res.status}` },
        { status: 503 },
      );
    }
    const data = await res.json();
    return NextResponse.json({ ok: true, ...data });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "service transcribe injoignable — lance start-transcribe.bat puis utilise localhost:3000",
      },
      { status: 503 },
    );
  }
}