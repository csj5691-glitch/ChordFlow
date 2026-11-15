import { NextRequest, NextResponse } from "next/server";
import {
  getYoutubeWav,
  isValidVideoId,
  youtubeAudioError,
} from "@/lib/yt-audio";
import {
  clearTranscribeProgress,
  setTranscribeProgress,
} from "@/lib/transcribe-progress";

const TRANSCRIBE_SERVICE =
  process.env.TRANSCRIBE_SERVICE_URL ?? "http://127.0.0.1:8766";
const TOKEN_RE = /^[A-Za-z0-9_-]{8,64}$/;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

type Resolved =
  | { file: Blob; token: string }
  | { error: string; status: number };

function cleanToken(value: unknown): string {
  return typeof value === "string" && TOKEN_RE.test(value.trim())
    ? value.trim()
    : "";
}

function report(token: string, percent: number, line: string) {
  if (!token) return;
  setTranscribeProgress(token, {
    phase: /conversion/i.test(line) ? "convert" : "download",
    percent,
    line,
  });
}

// Recupere le fichier audio de la requete : soit un envoi multipart classique,
// soit un simple identifiant YouTube (l'audio est alors telecharge cote
// serveur, sans passage par le navigateur).
async function resolveAudio(req: NextRequest): Promise<Resolved> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await req.json().catch(() => null)) as {
      videoId?: unknown;
      token?: unknown;
    } | null;
    const videoId = typeof body?.videoId === "string" ? body.videoId.trim() : "";
    const token = cleanToken(body?.token);
    if (!isValidVideoId(videoId)) {
      return { error: "videoId invalide", status: 400 };
    }
    try {
      const wav = await getYoutubeWav(videoId, (percent, line) =>
        report(token, percent, line)
      );
      return {
        file: new File([new Uint8Array(wav)], "youtube.wav", {
          type: "audio/wav",
        }),
        token,
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
  return { file, token: cleanToken(formData.get("token")) };
}

export async function POST(req: NextRequest) {
  let token = "";
  try {
    const audio = await resolveAudio(req);
    if ("error" in audio) {
      return NextResponse.json({ error: audio.error }, { status: audio.status });
    }
    token = audio.token;
    if (token) {
      setTranscribeProgress(token, {
        phase: "notes",
        percent: 1,
        line: "détection des notes…",
      });
    }

    const upstream = new FormData();
    upstream.append(
      "file",
      audio.file,
      (audio.file as File).name || "audio.wav"
    );
    if (token) upstream.append("token", token);

    const res = await fetch(`${TRANSCRIBE_SERVICE}/transcribe`, {
      method: "POST",
      body: upstream,
      signal: AbortSignal.timeout(590_000),
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) clearTranscribeProgress(token);
    return new Response(text, {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    clearTranscribeProgress(token);
    return NextResponse.json(
      {
        error: "service transcribe injoignable",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 503 }
    );
  }
}
