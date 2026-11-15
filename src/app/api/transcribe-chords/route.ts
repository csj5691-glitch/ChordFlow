import { NextRequest, NextResponse } from "next/server";
import {
  getYoutubeWav,
  isValidVideoId,
  youtubeAudioError,
} from "@/lib/yt-audio";

const TRANSCRIBE_SERVICE = process.env.TRANSCRIBE_SERVICE_URL ?? "http://127.0.0.1:8766";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

// Recupere le fichier audio de la requete : soit un envoi multipart classique,
// soit un simple identifiant YouTube (l'audio est alors telecharge cote
// serveur, sans passage par le navigateur).
async function resolveAudio(req: NextRequest): Promise<
  { file: Blob } | { error: string; status: number }
> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await req.json().catch(() => null)) as { videoId?: unknown } | null;
    const videoId = typeof body?.videoId === "string" ? body.videoId.trim() : "";
    if (!isValidVideoId(videoId)) {
      return { error: "videoId invalide", status: 400 };
    }
    try {
      const wav = await getYoutubeWav(videoId);
      return {
        file: new File([new Uint8Array(wav)], "youtube.wav", { type: "audio/wav" }),
      };
    } catch (err) {
      return { error: youtubeAudioError(err), status: 502 };
    }
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!file || !(file instanceof Blob)) {
    return { error: "fichier manquant", status: 400 };
  }
  return { file };
}

export async function POST(req: NextRequest) {
  try {
    const audio = await resolveAudio(req);
    if ("error" in audio) {
      return NextResponse.json({ error: audio.error }, { status: audio.status });
    }

    const upstream = new FormData();
    upstream.append(
      "file",
      audio.file,
      (audio.file as File).name || "audio.wav"
    );

    const res = await fetch(`${TRANSCRIBE_SERVICE}/chords`, {
      method: "POST",
      body: upstream,
      signal: AbortSignal.timeout(300_000),
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
