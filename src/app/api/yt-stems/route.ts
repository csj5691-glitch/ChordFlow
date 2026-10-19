import { NextRequest, NextResponse } from "next/server";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ytdlpFailure } from "@/lib/yt-dlp-error";
import { setPipelineProgress, clearPipelineProgress } from "@/lib/stem-pipeline-progress";

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

// Attend que le service Demucs réponde 200 avant de lancer la séparation.
async function waitForStemsService(timeoutMs = 300_000, intervalMs = 1_000): Promise<void> {
  const url = `${STEMS_SERVICE}/health`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(2_500),
        cache: "no-store",
      });
      if (res.ok) {
        return;
      }
    } catch {
      // Injoignable : on continue à attendre.
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("service stems injoignable ou non prêt après attente");
}

// Ligne de progression yt-dlp, ex. : « [download]  42.3% of 3.45MiB at 1.2MiB/s »
const DOWNLOAD_RE = /\[download\]\s+([\d.]+)%/;

// Lance yt-dlp en flux et remonte le pourcentage à /api/stems-progress via le
// magasin partagé (le service stems ne répond encore qu'en 404 à ce stade).
function runDownload(
  videoId: string,
  audioPath: string,
  watchUrl: string,
  token: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const report = (percent: number, line: string) =>
      setPipelineProgress(token, { phase: "download", percent, line });
    report(0, "téléchargement de la vidéo (yt-dlp)…");
    const child = spawn(
      "yt-dlp",
      [
        "--no-playlist",
        "--no-warnings",
        "--newline",
        "--progress",
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
      { windowsHide: true }
    );
    let stderr = "";
    const onData = (buf: Buffer) => {
      const text = buf.toString();
      stderr = (stderr + text).slice(-200_000);
      for (const line of text.split(/\r?\n/)) {
        const m = DOWNLOAD_RE.exec(line);
        if (m) {
          report(Math.max(0, Math.min(100, parseFloat(m[1]))), "téléchargement de la vidéo (yt-dlp)…");
        } else if (line.includes("[ExtractAudio]") || line.includes("[Merger]")) {
          report(99, "traitement de la piste audio…");
        }
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    const timer = setTimeout(() => {
      child.kill();
      reject(Object.assign(new Error("téléchargement YouTube trop long (240 s)"), { stderr }));
    }, 240_000);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(Object.assign(err, { stderr }));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(Object.assign(new Error(`yt-dlp: code ${code}`), { stderr }));
    });
  });
}

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
      // Un 403/429 de YouTube est le plus souvent transitoire (anti-bot / débit) :
      // on retente une fois après une courte pause avant d'abandonner.
      let ok = false;
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 2 && !ok; attempt++) {
        try {
          console.log(`[yt-stems] téléchargement de ${videoId}… (essai ${attempt + 1})`);
          await runDownload(videoId, audioPath, watchUrl, progressToken);
          ok = true;
        } catch (e) {
          lastErr = e;
          const stderr = (e as { stderr?: Buffer | string })?.stderr
            ? String((e as { stderr?: Buffer | string }).stderr)
            : "";
          const transient = /HTTP Error (403|429)|Too Many Requests|not a bot|Sign in to confirm/i.test(
            stderr
          );
          if (attempt === 0 && transient) {
            console.warn(`[yt-stems] ${videoId} : échec transitoire, nouvel essai dans 2,5 s…`);
            await new Promise((r) => setTimeout(r, 2500));
            continue;
          }
          break;
        }
      }
      if (!ok) {
        const err = lastErr as { message?: string; stderr?: Buffer | string };
        const stderr = err?.stderr ? String(err.stderr) : "";
        console.error(`[yt-stems] yt-dlp a échoué pour ${videoId}: ${err?.message ?? lastErr}\n${stderr}`);
        const msg = err?.message ?? String(lastErr);
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
        setPipelineProgress(progressToken, {
          phase: "convert",
          percent: 100,
          line: "conversion audio (ffmpeg)…",
        });
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
      // La séparation (barre tqdm du service) prend le relais : on libère la
      // progression amont pour ne pas la masquer.
      clearPipelineProgress(progressToken);
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

  // Attendre que le service Demucs soit prêt avant de lancer la séparation.
  if (progressToken) {
    try {
      setPipelineProgress(progressToken, {
        phase: "waiting",
        percent: 0,
        line: "en attente du service Demucs…",
      });
    } catch {}
  }
  try {
    await waitForStemsService();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "erreur inconnue";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
  if (progressToken) {
    try {
      clearPipelineProgress(progressToken);
    } catch {}
  }

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
