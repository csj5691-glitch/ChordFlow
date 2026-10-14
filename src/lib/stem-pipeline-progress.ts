// Progression des étapes AVANT la séparation Demucs (téléchargement yt-dlp +
// conversion ffmpeg). Le service stems n'expose sa barre tqdm qu'une fois la
// séparation lancée : ce magasin couvre la phase amont, lu par
// /api/stems-progress quand le service répond encore 404.

export type PipelineProgress = {
  phase: "download" | "convert";
  percent: number;
  line: string;
};

type Store = Map<string, PipelineProgress>;

// Stocké sur globalThis : les route handlers Next sont compilés séparément,
// mais partagent le même processus Node (comme le client Prisma).
function getStore(): Store {
  const g = globalThis as unknown as { __stemPipelineProgress?: Store };
  if (!g.__stemPipelineProgress) g.__stemPipelineProgress = new Map();
  return g.__stemPipelineProgress;
}

export function setPipelineProgress(token: string, p: PipelineProgress): void {
  if (!token) return;
  getStore().set(token, p);
}

export function getPipelineProgress(token: string): PipelineProgress | undefined {
  return getStore().get(token);
}

export function clearPipelineProgress(token: string): void {
  if (!token) return;
  getStore().delete(token);
}
