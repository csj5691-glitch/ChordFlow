// Copyright (c) 2026 Claude St-Jean. All rights reserved.

// Progression de la transcription : telechargement YouTube et conversion
// (cote serveur Next), puis analyse (service Python, interroge via
// /api/transcribe-progress). Le magasin vit sur globalThis car les routes
// Next compilees separement partagent le meme processus Node.

export type TranscribePhase = "download" | "convert" | "notes" | "chords";

export type TranscribeProgress = {
  phase: TranscribePhase;
  percent: number;
  line: string;
};

type Store = Map<string, TranscribeProgress>;

function getStore(): Store {
  const g = globalThis as unknown as { __transcribeProgress?: Store };
  if (!g.__transcribeProgress) g.__transcribeProgress = new Map();
  return g.__transcribeProgress;
}

export function setTranscribeProgress(
  token: string,
  progress: TranscribeProgress
): void {
  if (!token) return;
  getStore().set(token, progress);
}

export function getTranscribeProgress(
  token: string
): TranscribeProgress | undefined {
  return getStore().get(token);
}

export function clearTranscribeProgress(token: string): void {
  if (!token) return;
  getStore().delete(token);
}

// Les tokens vivent le temps d'une requete : on purge les entrees anciennes
// pour ne pas garder indefiniment des entrees orphelines.
const TTL_MS = 15 * 60 * 1000;
const touched = new Map<string, number>();

export function touchTranscribeProgress(token: string): void {
  if (!token) return;
  const now = Date.now();
  touched.set(token, now);
  for (const [key, at] of touched) {
    if (now - at > TTL_MS) {
      touched.delete(key);
      getStore().delete(key);
    }
  }
}
