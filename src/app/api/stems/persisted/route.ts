import { NextRequest, NextResponse } from "next/server";

const STEMS_SERVICE = process.env.STEMS_SERVICE_URL ?? "http://127.0.0.1:8765";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const songId = req.nextUrl.searchParams.get("songId")?.trim() ?? "";
  const stem = req.nextUrl.searchParams.get("stem")?.trim() ?? "";
  if (!songId) {
    return NextResponse.json({ error: "songId requis" }, { status: 400 });
  }
  // Liste des stems disponibles si aucun stem precis n'est demande.
  const url = stem
    ? `${STEMS_SERVICE}/stems/${encodeURIComponent(songId)}/${encodeURIComponent(stem)}`
    : `${STEMS_SERVICE}/stems/${encodeURIComponent(songId)}`;
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      return NextResponse.json({ error: "stem indisponible" }, { status: res.status });
    }
    if (stem) {
      const audio = Buffer.from(await res.arrayBuffer());
      return new NextResponse(audio, {
        status: 200,
        headers: { "Content-Type": res.headers.get("content-type") ?? "audio/wav" },
      });
    }
    const data = await res.json().catch(() => null);
    return NextResponse.json(data ?? { stems: [] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "erreur inconnue";
    return NextResponse.json({ error: `service stems injoignable (${STEMS_SERVICE}) — ${msg}` }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest) {
  const songId = req.nextUrl.searchParams.get("songId")?.trim() ?? "";
  if (!songId) {
    return NextResponse.json({ error: "songId requis" }, { status: 400 });
  }
  try {
    const res = await fetch(`${STEMS_SERVICE}/stems/${encodeURIComponent(songId)}`, {
      method: "DELETE",
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: "echec suppression" }, { status: res.status });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "erreur inconnue";
    return NextResponse.json({ error: `service stems injoignable (${STEMS_SERVICE}) — ${msg}` }, { status: 502 });
  }
}