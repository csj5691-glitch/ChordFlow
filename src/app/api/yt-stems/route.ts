import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileP = promisify(execFile);

const STEMS_SERVICE = process.env.STEMS_SERVICE_URL ?? "http://127.0.0.1:8765";
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{6,20}$/;

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let videoId = "";
  try {
    const body = await req.json();
    if (typeof body?.videoId === "string") videoId = body.videoId.trim();
  } catch {
    return NextResponse.json({ error: "corps invalide" }, { status: 400 });
  }

  if (!VIDEO_ID_RE.test(videoId)) {
    return NextResponse.json({ error: "videoId invalide" }, { status: 400 });
  }

  const dir = await mkdtemp(join(tmpdir(), "ytstem-"));
  const audioPath = join(dir, "audio");
  const wavPath = join(dir, "out.wav");
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;

  try {
    try {
      console.log(`[yt-stems] téléchargement de ${videoId}…`);
      await execFileP(
        "yt-dlp",
        ["--no-playlist", "--no-warnings", "-f", "bestaudio", "-o", audioPath, watchUrl],
        { timeout: 240_000, maxBuffer: 8 * 1024 * 1024 }
      );
    } catch (e) {
      const err = e as { message?: string; stderr?: Buffer | string };
      const stderr = err?.stderr ? String(err.stderr).slice(0, 400) : "";
      console.error(`[yt-stems] yt-dlp a échoué pour ${videoId}: ${err?.message ?? e}\n${stderr}`);
      const msg = err?.message ?? String(e);
      return NextResponse.json(
        {
          error: msg.includes("ENOENT")
            ? "yt-dlp introuvable sur cette machine — installe-le puis utilise l'app en local"
            : `téléchargement YouTube impossible: ${msg.slice(0, 300)}`,
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

    const wav = await readFile(wavPath);
    const upstream = new FormData();
    upstream.set("file", new File([new Uint8Array(wav)], "youtube.wav", { type: "audio/wav" }));

    let res: Response;
    try {
      res = await fetch(`${STEMS_SERVICE}/separate?stem=vocals`, {
        method: "POST",
        body: upstream,
        signal: AbortSignal.timeout(590_000),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "erreur inconnue";
      return NextResponse.json(
        { error: `service stems injoignable (${STEMS_SERVICE}) — ${msg}` },
        { status: 502 }
      );
    }

    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `échec séparation: ${bodyText || res.statusText}` },
        { status: res.status }
      );
    }

    const audio = Buffer.from(await res.arrayBuffer());
    return new NextResponse(audio, {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Content-Disposition": `attachment; filename="vocals.wav"`,
      },
    });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
