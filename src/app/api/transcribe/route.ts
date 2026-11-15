import { NextRequest, NextResponse } from "next/server";

const TRANSCRIBE_SERVICE = process.env.TRANSCRIBE_SERVICE_URL ?? "http://127.0.0.1:8766";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: "fichier manquant" }, { status: 400 });
    }
    const upstream = new FormData();
    upstream.append("file", file, (file as File).name || "audio.mp3");

    const res = await fetch(`${TRANSCRIBE_SERVICE}/transcribe`, {
      method: "POST",
      body: upstream,
      signal: AbortSignal.timeout(300_000), // 5 min max
      cache: "no-store",
    });
    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "service transcribe injoignable",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 503 },
    );
  }
}