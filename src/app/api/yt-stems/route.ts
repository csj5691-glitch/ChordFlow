import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ytdlpFailure } from "@/lib/yt-dlp-error";

const execFileP = promisify(execFile);

const STEMS_SERVICE = process.env.STEMS_SERVICE_URL ?? "http://127.0.0.1:8765";
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{6,20}$/;
const STEM_CHOICES = ["vocals", "noVocals", "drums", "bass", "guitar", "piano", "other"] as const;
// Modèle 4 pistes (htdemucs) : ni piano ni guitar. On sert « other » plutôt
// qu'une erreur, et l'en-tête X-Stem-Substituted prévient l'appelant.
const STEM_FALLBACK: Record<string, string> = { guitar: "other", piano: "other" };

export const runtime = "nodejs";
export const maxDuration = 300;

const wavCache = new Map<string, Buffer>();
const WAV_CACHE_MAX = 2;

export async function POST(req: NextRequest) {
  let videoId = "";
  let stem = "vocals";
  let progressToken = "";
  try {
    const body = await req.json();
    if (typeof body?.videoId === "string") videoId = body.videoId.trim();
    if (typeof body?.stem === "string") stem = body.stem.trim();
    if (typeof body?.progressToken === "string") progressToken = body.progressToken.trim();
  } catch {
    return NextResponse.json({ error: "corps invalide" }, { status: 400 });
  }

  if (!VIDEO_ID_RE.test(videoId)) {
    return NextResponse.json({ error: "videoId invalide" }, { status: 400 });
  }
  if (!STEM_CHOICES.includes(stem as (typeof STEM_CHOICES)[number])) {
    return NextResponse.json(
      { error: `stem invalide (choix: ${STEM_CHOICES.join(", ")})` },
      { status: 400 }
    );
  }

  let wav = wavCache.get(videoId);
  if (wav) {
    console.log(`[yt-stems] cache WAV pour ${videoId}`);
    wavCache.delete(videoId);
    wavCache.set(videoId, wav);
  } else {
    const dir = await mkdtemp(join(tmpdir(), "ytstem-"));
    const audioPath = join(dir, "audio");
    const wavPath = join(dir, "out.wav");
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;

    try {
      try {
        console.log(`[yt-stems] téléchargement de ${videoId}…`);
        await execFileP(
          "yt-dlp",
          [
            "--no-playlist",
            "--no-warnings",
            "--retries",
            "3",
            "--fragment-retries",
            "3",
            "-f",
            "bestaudio",
            "-o",
            audioPath,
            watchUrl,
          ],
          { timeout: 240_000, maxBuffer: 8 * 1024 * 1024 }
        );
      } catch (e) {
        const err = e as { message?: string; stderr?: Buffer | string };
        const stderr = err?.stderr ? String(err.stderr) : "";
        console.error(`[yt-stems] yt-dlp a échoué pour ${videoId}: ${err?.message ?? e}\n${stderr}`);
        const msg = err?.message ?? String(e);
        return NextResponse.json(
          {
            error: msg.includes("ENOENT")
              ? "yt-dlp introuvable sur cette machine — installe-le puis utilise l'app en local"
              : `téléchargement YouTube impossible: ${ytdlpFailure(stderr, msg)}`,
          },
          { status: 500 }
        );
      }

      try {
        console.log(`[yt-stems] conversion de ${videoId}…`);
        await execFileP(
          "ffmpeg",
          ["-y", "-i", audioPath, "-ac", "1", "-ar", "44100", "-sample_fmt", "s16", "-f", "wav", wavPath],
          { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 }
        );
      } catch (e) {
        const err = e as { message?: string };
        console.error(`[yt-stems] ffmpeg a échoué pour ${videoId}: ${err?.message ?? e}`);
        return NextResponse.json(
          { error: `conversion audio impossible (ffmpeg): ${(err?.message ?? String(e)).slice(0, 300)}` },
          { status: 500 }
        );
      }

      wav = await readFile(wavPath);
      if (wavCache.size >= WAV_CACHE_MAX) {
        const oldest = wavCache.keys().next().value;
        if (oldest !== undefined) wavCache.delete(oldest);
      }
      wavCache.set(videoId, wav);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  // Deux essais : le stem demandé puis « other » si le modèle ne le produit
  // pas (le WAV est déjà en cache, le 2e appel est immédiat).
  const candidates = [stem, STEM_FALLBACK[stem]].filter(
    (s, i, arr): s is string => !!s && arr.indexOf(s) === i
  );
  let res: Response | null = null;
  let used = stem;
  let lastBody = "";
  let lastStatus = 502;
  const tokenQuery =
    progressToken && /^[A-Za-z0-9_-]{8,64}$/.test(progressToken)
      ? `&progress_token=${encodeURIComponent(progressToken)}`
      : "";
  for (const candidate of candidates) {
    const upstream = new FormData();
    upstream.set("file", new File([new Uint8Array(wav)], "youtube.wav", { type: "audio/wav" }));
    try {
      res = await fetch(`${STEMS_SERVICE}/separate?stem=${encodeURIComponent(candidate)}${tokenQuery}`, {
        method: "POST",
        body: upstream,
        // Séparation Demucs CPU : mesurée à ~3,7x le temps réel (45 s d'audio
        // → 115 s), donc une chanson de 4 min demande ~9 min. Le timeout doit
        // dépasser ça, sinon le téléchargement échoue en fin de morceau.
        signal: AbortSignal.timeout(1_800_000),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "erreur inconnue";
      const timeout = /timeout|abort/i.test(msg) || (e as { name?: string })?.name === "AbortError";
      return NextResponse.json(
        {
          error: timeout
            ? `séparation trop longue (service CPU) — le service garde le résultat en cache : relance le téléchargement, il répondra immédiatement`
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
