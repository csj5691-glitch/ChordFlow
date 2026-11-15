// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ytdlpFailure } from "@/lib/yt-dlp-error";

const execFileP = promisify(execFile);

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{6,20}$/;

// Le meme audio sert aux deux etapes (notes puis accords) : on garde le WAV
// en memoire pour eviter un second telechargement YouTube.
const cache = new Map<string, Buffer>();
const CACHE_MAX = 2;

const DOWNLOAD_RE = /\[download\]\s+([\d.]+)%/;

export function isValidVideoId(id: string): boolean {
  return VIDEO_ID_RE.test(id);
}

function isTransient(stderr: string): boolean {
  return /HTTP Error (403|429)|Too Many Requests|not a bot|Sign in to confirm/i.test(
    stderr
  );
}

type ProgressFn = (percent: number, line: string) => void;

// Telecharge l'audio en flux pour remonter l'avancement (yt-dlp ecrit une
// ligne par pourcentage).
function download(
  videoId: string,
  audioPath: string,
  onProgress?: ProgressFn
): Promise<void> {
  return new Promise((resolve, reject) => {
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
        `https://www.youtube.com/watch?v=${videoId}`,
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
          onProgress?.(
            Math.max(0, Math.min(100, parseFloat(m[1]))),
            "téléchargement de la vidéo (yt-dlp)…"
          );
        } else if (line.includes("[ExtractAudio]") || line.includes("[Merger]")) {
          onProgress?.(100, "traitement de la piste audio…");
        }
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    const timer = setTimeout(() => {
      child.kill();
      reject(
        Object.assign(new Error("téléchargement YouTube trop long (240 s)"), {
          stderr,
        })
      );
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

// Telecharge l'audio YouTube et le convertit en WAV mono 44,1 kHz 16 bits,
// le format attendu par le service transcribe.
export async function getYoutubeWav(
  videoId: string,
  onProgress?: ProgressFn
): Promise<Buffer> {
  if (!isValidVideoId(videoId)) throw new Error("videoId invalide");
  const cached = cache.get(videoId);
  if (cached) {
    // Remet en tete de cache (LRU).
    cache.delete(videoId);
    cache.set(videoId, cached);
    onProgress?.(100, "audio déjà téléchargé…");
    return cached;
  }

  const dir = await mkdtemp(join(tmpdir(), "ytaudio-"));
  const audioPath = join(dir, "audio");
  const wavPath = join(dir, "out.wav");
  try {
    // YouTube renvoie parfois 403/429 (anti-bot) : une seconde tentative apres
    // une courte pause suffit en general.
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await download(videoId, audioPath, onProgress);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        const stderr = (err as { stderr?: Buffer | string })?.stderr;
        if (attempt === 0 && stderr && isTransient(String(stderr))) {
          onProgress?.(0, "YouTube a refusé la requête, nouvelle tentative…");
          await new Promise((r) => setTimeout(r, 2500));
          continue;
        }
        break;
      }
    }
    if (lastErr) throw lastErr;

    onProgress?.(100, "conversion en WAV mono…");
    await execFileP(
      "ffmpeg",
      [
        "-y",
        "-i",
        audioPath,
        "-ac",
        "1",
        "-ar",
        "44100",
        "-sample_fmt",
        "s16",
        "-f",
        "wav",
        wavPath,
      ],
      { timeout: 180_000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }
    );

    const wav = await readFile(wavPath);
    if (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(videoId, wav);
    return wav;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// Message lisible pour l'interface (yt-dlp introuvable, anti-bot, age...).
export function youtubeAudioError(err: unknown): string {
  const e = err as { stderr?: Buffer | string; message?: string };
  const stderr = e?.stderr ? String(e.stderr) : "";
  return ytdlpFailure(stderr, e?.message ?? "echec du telechargement YouTube");
}
