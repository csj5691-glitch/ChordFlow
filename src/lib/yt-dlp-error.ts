// Turns a yt-dlp failure into an actionable French message. yt-dlp writes the
// real reason on stderr (anti-bot check, private video, 429, unsupported URL…),
// while `execFile` only reports "Command failed: …" — without this mapping the
// browser shows nothing usable.
export function ytdlpFailure(stderr: string | undefined, fallback: string): string {
  const raw = (stderr ?? "").trim();
  const known: [RegExp, string][] = [
    [
      /not a bot|confirm you'?re not a bot|Sign in to confirm/i,
      "YouTube bloque yt-dlp (vérification anti-bot) — mets yt-dlp à jour (yt-dlp -U) ou configure des cookies",
    ],
    [/private video/i, "vidéo privée — utilise une vidéo publique"],
    [/video unavailable|not available in your country|blocked it/i, "vidéo indisponible (pays /Rights)"],
    [/HTTP Error 429|Too Many Requests/i, "YouTube renvoie trop de requêtes — réessaie dans quelques minutes"],
    [/HTTP Error 403/i, "accès refusé par YouTube (403) — réessaie plus tard ou mets yt-dlp à jour"],
    [/unable to extract|unsupported url|no video formats/i, "yt-dlp n'arrive pas à lire cette URL — mets yt-dlp à jour"],
    [/ffmpeg|ffprobe not installed/i, "ffmpeg est requis pour le téléchargement — installe-le puis réessaie"],
    [/timed out|timeout/i, "téléchargement trop long (délai dépassé)"],
    [
      /Sign in to confirm your age|age-restricted/i,
      "vidéo soumise à une limite d'âge — connecte-toi via des cookies yt-dlp",
    ],
  ];
  for (const [re, msg] of known) {
    if (re.test(raw)) return msg;
  }
  const errorLine = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^ERROR:/i.test(l))
    .pop();
  if (errorLine) return `${errorLine.replace(/^ERROR:\s*/i, "")}`.slice(0, 220);
  return fallback.slice(0, 220);
}