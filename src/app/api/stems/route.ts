import { NextRequest, NextResponse } from "next/server";

const STEMS_SERVICE = process.env.STEMS_SERVICE_URL ?? "http://127.0.0.1:8765";
const STEM_NAMES = ["vocals", "drums", "bass", "guitar", "piano", "other"];

export const runtime = "nodejs";
export const maxDuration = 600;

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "form-data requis" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "fichier audio manquant" }, { status: 400 });
  }
  if (file.size > 200 * 1024 * 1024) {
    return NextResponse.json({ error: "fichier trop gros (max 200 Mo)" }, { status: 413 });
  }

  const upstream = new FormData();
  upstream.set("file", file, file.name || "audio.mp3");

  let res: Response;
  try {
    res = await fetch(`${STEMS_SERVICE}/separate`, {
      method: "POST",
      body: upstream,
      signal: AbortSignal.timeout(590_000),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "erreur inconnue";
    return NextResponse.json(
      { error: `service stems injoignable (${STEMS_SERVICE}) — ${msg}` },
      { status: 502 },
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return NextResponse.json(
      { error: `échec séparation: ${body || res.statusText}` },
      { status: res.status },
    );
  }

  const zip = Buffer.from(await res.arrayBuffer());
  return new NextResponse(zip, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="stems.zip"`,
      "X-Stems": STEM_NAMES.join(","),
    },
  });
}
