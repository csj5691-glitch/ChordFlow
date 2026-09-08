// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { NextRequest } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzePcm } from "@/lib/bpm-detect";

const execFileP = promisify(execFile);

const cache = new Map<string, { bpm: number; confidence: number }>();
const CACHE_MAX = 200;

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{6,20}$/;

function parseWavToF32(buf: Buffer): { samples: Float32Array; sampleRate: number } {
  if (
    buf.length < 44 ||
    buf.toString("latin1", 0, 4) !== "RIFF" ||
    buf.toString("latin1", 8, 12) !== "WAVE"
  ) {
    throw new Error("fichier WAV invalide");
  }

  let sampleRate = 44100;
  let dataOffset = -1;
  let dataBytes = 0;
  let bits = 16;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("latin1", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "fmt " && size >= 16) {
      sampleRate = buf.readUInt32LE(offset + 12);
      bits = buf.readUInt16LE(offset + 22);
    } else if (id === "data") {
      dataOffset = offset + 8;
      dataBytes = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }

  if (dataOffset < 0 || dataBytes === 0) {
    throw new Error("aucune donnée audio dans le WAV");
  }
  if (bits !== 16) {
    throw new Error(`format ${bits} bits non supporté`);
  }

  const count = Math.floor(dataBytes / 2);
  const samples = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    samples[i] = buf.readInt16LE(dataOffset + i * 2) / 32768;
  }
  return { samples, sampleRate };
}

export async function POST(req: NextRequest) {
  let videoId = "";
  try {
    const body = await req.json();
    if (typeof body?.videoId === "string") videoId = body.videoId.trim();
  } catch {
    return Response.json({ error: "corps invalide" }, { status: 400 });
  }

  if (!VIDEO_ID_RE.test(videoId)) {
    return Response.json({ error: "videoId invalide" }, { status: 400 });
  }

  const cached = cache.get(videoId);
  if (cached) {
    return Response.json({ videoId, ...cached, cached: true });
  }

  const dir = await mkdtemp(join(tmpdir(), "ytbpm-"));
  const audioPath = join(dir, "audio");
  const wavPath = join(dir, "out.wav");
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;

  const result = { bpm: 0, confidence: 0 };
  let errorMsg = "";
  try {
    console.log(`[yt-bpm] téléchargement de ${videoId}…`);
    await execFileP(
      "yt-dlp",
      [
        "--no-playlist",
        "--no-warnings",
        "-f",
        "bestaudio",
        "-o",
        audioPath,
        watchUrl,
      ],
      { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 }
    );

    console.log(`[yt-bpm] conversion de ${videoId}…`);
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
      { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 }
    );

    const wav = await readFile(wavPath);
    const { samples, sampleRate } = parseWavToF32(wav);
    const analysis = analyzePcm(samples, sampleRate);
    result.bpm = Math.round(analysis.bpm * 10) / 10;
    result.confidence = analysis.confidence;
  } catch (err) {
    const e = err as { stderr?: Buffer | string; message?: string };
    errorMsg = e?.message ?? "échec";
    const stderr = e?.stderr ? String(e.stderr).slice(0, 500) : "";
    console.error(`[yt-bpm] échec pour ${videoId} : ${errorMsg}\n${stderr}`);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  if (result.bpm <= 0) {
    return Response.json(
      { error: errorMsg || "impossible de mesurer le BPM" },
      { status: 500 }
    );
  }

  cache.set(videoId, result);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  console.log(
    `[yt-bpm] ${videoId} -> ${result.bpm} BPM (confiance ${result.confidence.toFixed(2)})`
  );
  return Response.json({ videoId, ...result, cached: false });
}