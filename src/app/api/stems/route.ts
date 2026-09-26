import { NextRequest, NextResponse } from "next/server";

const STEMS_SERVICE = process.env.STEMS_SERVICE_URL ?? "http://127.0.0.1:8765";
const STEM_CHOICES = ["vocals", "drums", "bass", "other"] as const;

export const runtime = "nodejs";
export const maxDuration = 600;

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "form-data requis" }, { status: 400 });
  }

  const file = form.get("file");
  const stem = (form.get("stem") as string | null) ?? "vocals";
  if (!STEM_CHOICES.includes(stem as (typeof STEM_CHOICES)[number])) {
    return NextResponse.json(
      { error: `stem invalide (choix: ${STEM_CHOICES.join(", ")})` },
      { status: 402 },
    );
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "fichier audio manquant" }, { status: 400 });
  }
  if (file.size > 200 * 1024 * 1024) {
    return NextResponse.json({ error: "fichier trop gros (max 200 Mo)" }, { status: 413 });
  }

  const upstream = new FormData();
  upstream.set("file", file, file.name || "audio.mp3");
  upstream.set("stem", stem);

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

  const audio = Buffer.from(await res.arrayBuffer());
  return new NextResponse(audio, {
    status: 200,
    headers: {
      "Content-Type": "audio/wav",
      "Content-Disposition": `attachment; filename="${stem}.wav"`,
    },
  });
}
