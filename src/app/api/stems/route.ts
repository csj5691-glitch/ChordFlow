import { NextRequest, NextResponse } from "next/server";

const STEMS_SERVICE = process.env.STEMS_SERVICE_URL ?? "http://127.0.0.1:8765";
const STEM_CHOICES = ["vocals", "noVocals", "drums", "bass", "guitar", "piano", "other"] as const;
// Le modèle par défaut (htdemucs, 4 pistes) ne produit ni piano ni guitar. On
// répond avec la piste « other » plutôt qu'une erreur : l'utilisateur obtient
// de l'audio exploitable, et l'en-tête X-Stem-Substituted prévient l'appelant.
const STEM_FALLBACK: Record<string, string> = { guitar: "other", piano: "other" };
// Séparation Demucs CPU : ~3,7x le temps réel mesurés (45 s d'audio -> 115 s),
// donc une chanson de 4 min demande ~9 min. 30 min de marge.
const SEPARATION_TIMEOUT_MS = 1_800_000;

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  if (!form) {
    return NextResponse.json({ error: "form-data requis" }, { status: 400 });
  }

  const file = form.get("file");
  const stem =
    req.nextUrl.searchParams.get("stem") ??
    (form.get("stem") as string | null) ??
    "vocals";
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

  // Deux essais : le stem demandé, puis son équivalent « other » si le modèle
  // ne sait pas le produire (le calcul est mis en cache, le 2e essai est gratuit).
  const candidates = [stem, STEM_FALLBACK[stem]].filter(
    (s, i, arr): s is string => !!s && arr.indexOf(s) === i
  );
  let res: Response | null = null;
  let used = stem;
  let lastBody = "";
  let lastStatus = 502;
  for (const candidate of candidates) {
    const body = new FormData();
    body.set("file", file, file.name || "audio.mp3");
    try {
      res = await fetch(`${STEMS_SERVICE}/separate?stem=${encodeURIComponent(candidate)}`, {
        method: "POST",
        body,
        signal: AbortSignal.timeout(SEPARATION_TIMEOUT_MS),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "erreur inconnue";
      const timeout = /timeout|abort/i.test(msg) || (e as { name?: string })?.name === "AbortError";
      return NextResponse.json(
        {
          error: timeout
            ? `séparation trop longue (service CPU) — le service garde le résultat en cache : relance l'extraction, elle répondra immédiatement`
            : `service stems injoignable (${STEMS_SERVICE}) — ${msg}`,
        },
        { status: timeout ? 504 : 502 }
      );
    }
    if (res.ok) {
      used = candidate;
      break;
    }
    lastBody = await res.text().catch(() => "");
    lastStatus = res.status;
    res = null;
  }

  if (!res) {
    return NextResponse.json(
      { error: `échec séparation: ${lastBody || "aucune piste produite"}` },
      { status: lastStatus }
    );
  }

  const audio = Buffer.from(await res.arrayBuffer());
  return new NextResponse(audio, {
    status: 200,
    headers: {
      "Content-Type": "audio/wav",
      "Content-Disposition": `attachment; filename="${stem}.wav"`,
      ...(used !== stem ? { "X-Stem-Substituted": used } : {}),
    },
  });
}
