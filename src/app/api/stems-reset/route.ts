import { NextResponse } from "next/server";

// Libère les sessions ONNX et la mémoire du service local de stems.
// Utilisé entre deux chansons d'une rafale : sinon la mémoire du service
// gonfle jusqu'à faire échouer la séparation (« Unable to allocate … MiB »).
const STEMS_SERVICE = process.env.STEMS_SERVICE_URL ?? "http://127.0.0.1:8765";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const res = await fetch(`${STEMS_SERVICE}/reset`, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, error: `service stems : reset ${res.status}` },
        { status: 503 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { ok: false, error: "service stems injoignable" },
      { status: 503 }
    );
  }
}
