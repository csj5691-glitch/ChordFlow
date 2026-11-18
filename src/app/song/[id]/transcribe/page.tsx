"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { use, useState, useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Upload,
  Music2,
  Loader2,
  Play,
  Search,
  FileAudio,
} from "lucide-react";
import { useSharedSong } from "@/lib/use-shared-song";
import { loadYouTubeId } from "@/lib/youtube-store";
import { hasAudioStems, loadAudioStems } from "@/lib/audio-store";

// localStorage n'emet pas d'evenement : abonnement vide, la valeur est relue
// a chaque rendu. useSyncExternalStore evite toute desynchronisation SSR.
const noSubscribe = () => () => {};
const noServerSnapshot = () => null;

interface TabResult {
  tab: string;
  note_count: number;
  duration: number;
  tab_notes?: number;
  bpm?: number | null;
}

interface ChordResult {
  chords: { start: number; end: number; chord: string }[];
  count: number;
  duration: number;
  key?: string;
  repetitions: { pattern: string[]; repeats: number; coverage: number };
}

// Libelle lisible pour chaque etape de la transcription.
const PHASE_LABEL: Record<string, string> = {
  download: "Téléchargement YouTube",
  convert: "Conversion audio",
  notes: "Détection des notes",
  chords: "Analyse des accords",
};

function newToken(): string {
  return `tx${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

// Presence du service de transcription local : un health check suffit pour
// savoir s'il est deja lance. Retourne true/false, sans toucher au state du
// composant (le useEffect du rendu s'occupe de la mise a jour).
async function checkTranscribeHealth(): Promise<boolean> {
  try {
    const res = await fetch("/api/transcribe-health", { cache: "no-store" });
    const data = await res.json().catch(() => null);
    return Boolean(res.ok && data?.ok);
  } catch {
    return false;
  }
}

export default function TranscribePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { current: song, upsert } = useSharedSong(id);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  // Vrai quand le service de transcription local repond (health OK) : le
  // bouton « Démarrer le service » doit etre inactif tant que le service
  // tourne.
  const [serviceOk, setServiceOk] = useState(false);
  const [sourceLabel, setSourceLabel] = useState<string | null>(null);
  const [tabResult, setTabResult] = useState<TabResult | null>(null);
  const [chordResult, setChordResult] = useState<ChordResult | null>(null);
  const [youtubeSearchId, setYoutubeSearchId] = useState<string | null>(null);
  const [hasStems, setHasStems] = useState(false);
  const [savedTab, setSavedTab] = useState(false);
  const [savedChords, setSavedChords] = useState(false);
  const [progress, setProgress] = useState<{
    percent: number;
    line: string;
    phase: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    checkTranscribeHealth().then((ok) => {
      if (active) setServiceOk(ok);
    });
    return () => {
      active = false;
    };
  }, []);

  // Lien YouTube : identifiant trouve par la recherche, sinon champ de la
  // chanson, sinon identifiant memorise localement sur cet appareil.
  const localYoutubeId = useSyncExternalStore(
    noSubscribe,
    () => loadYouTubeId(id),
    noServerSnapshot
  );
  const youtubeId = youtubeSearchId ?? song?.youtubeId ?? localYoutubeId ?? null;

  // Presence des stems locaux (l'instrumental donne la meilleure transcription).
  useEffect(() => {
    let active = true;
    hasAudioStems(id)
      .then((value) => {
        if (active) setHasStems(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [id]);

  const runTranscription = useCallback(
    async (opts: { videoId?: string; blob?: Blob; fileName?: string; label: string }) => {
      setBusy(opts.label);
      setError(null);
      setTabResult(null);
      setChordResult(null);
      setSourceLabel(null);
      setSavedTab(false);
      setSavedChords(false);

      const token = newToken();
      setProgress({ percent: 0, line: "préparation…", phase: "download" });
      let stopped = false;
      const poll = async () => {
        try {
          const res = await fetch(
            `/api/transcribe-progress?token=${encodeURIComponent(token)}`,
            { cache: "no-store" }
          );
          if (!res.ok || stopped) return;
          const data = await res.json().catch(() => null);
          if (!data || stopped) return;
          setProgress({
            percent: typeof data.percent === "number" ? data.percent : 0,
            line: data.line ?? "",
            phase: data.phase ?? "notes",
          });
        } catch {
          // service momentanement muet : on garde la derniere valeur
        }
      };
      const timer = setInterval(() => void poll(), 900);
      void poll();

      try {
        let init: RequestInit;
        if (opts.videoId) {
          // L'audio est telecharge cote serveur : rien ne transite par le
          // navigateur.
          init = {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ videoId: opts.videoId, token }),
          };
        } else if (opts.blob) {
          const fd = new FormData();
          fd.append("file", opts.blob, opts.fileName || "audio.wav");
          fd.append("token", token);
          init = { method: "POST", body: fd };
        } else {
          setError("Aucune source audio.");
          return;
        }

        // 1. Notes + tablature
        const res1 = await fetch("/api/transcribe", init);
        const data1 = await res1.json().catch(() => null);
        if (!res1.ok) {
          setError(data1?.error ?? data1?.detail ?? "Erreur de transcription");
          return;
        }
        setTabResult({
          tab: data1.tab,
          note_count: data1.note_count,
          duration: data1.duration,
          tab_notes: data1.tab_notes,
          bpm: data1.bpm ?? null,
        });
        setSourceLabel(opts.label);

        // Persistance automatique : la tablature generee est sauvegardee
        // immediatement, sans attendre l'analyse des accords (qui peut echouer
        // sans empecher la sauvegarde de la tablature).
        if (data1.tab && song) {
          setSavedTab(true);
          try {
            await upsert({ ...song, transcribedTab: data1.tab });
          } catch (saveErr) {
            console.error("[ChordFlow] Echec sauvegarde tablature transcrite :", saveErr);
            setError("Sauvegarde de la tablature impossible.");
          }
        }

        // 2. Accords + repetitions (le WAV YouTube est deja en cache serveur)
        const res2 = await fetch("/api/transcribe-chords", init);
        const data2 = await res2.json().catch(() => null);
        if (res2.ok) {
          setChordResult({
            chords: data2.chords,
            count: data2.count,
            duration: data2.duration,
            key: data2.key,
            repetitions: data2.repetitions,
          });
        } else {
          setError(
            data2?.error ?? data2?.detail ?? "Accords non détectés (tablature disponible)."
          );
        }

        if (res2.ok && data2.chords && song) {
          setSavedChords(true);
          const header = data2.key ? `# Tonalite : ${data2.key}\n` : "";
          const lrc = data2.chords
            .map(
              (c: { start: number; chord: string }) =>
                `[${Math.floor(c.start / 60).toString().padStart(2, "0")}:${(c.start % 60)
                  .toFixed(2)
                  .padStart(5, "0")}] ${c.chord}`
            )
            .join("\n");
          try {
            await upsert({ ...song, transcribedChords: header + lrc });
          } catch (saveErr2) {
            console.error("[ChordFlow] Echec sauvegarde accords transcrits :", saveErr2);
            setError("Sauvegarde des accords impossible.");
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erreur reseau");
      } finally {
        stopped = true;
        clearInterval(timer);
        setBusy(null);
        setProgress(null);
      }
    },
    [song, upsert]
  );

  const transcribeFromYoutube = useCallback(() => {
    if (!youtubeId) return;
    void runTranscription({
      videoId: youtubeId,
      label: `YouTube · ${youtubeId}`,
    });
  }, [youtubeId, runTranscription]);

  const transcribeFromSearch = useCallback(async () => {
    if (!song) return;
    setBusy("Recherche sur YouTube…");
    setError(null);
    try {
      const q = `${song.artist} ${song.title}`.trim() || song.title;
      const res = await fetch("/api/yt-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.videoId) {
        setError(
          data?.error ?? "Aucune vidéo YouTube trouvée pour cette chanson."
        );
        return;
      }
      setYoutubeSearchId(data.videoId);
      await runTranscription({
        videoId: data.videoId,
        label: `YouTube · recherche « ${q} »`,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur reseau");
    } finally {
      setBusy(null);
    }
  }, [song, runTranscription]);

  const transcribeFromStems = useCallback(async () => {
    setBusy("Chargement de l'instrumental…");
    setError(null);
    try {
      const stems = await loadAudioStems(id);
      const blob = stems?.noVocals || stems?.vocals || null;
      if (!blob) {
        setError("Aucun stem audio local pour cette chanson.");
        return;
      }
      await runTranscription({
        blob,
        fileName: stems?.noVocals ? "instrumental.wav" : "voix.wav",
        label: stems?.noVocals ? "Instrumental local" : "Voix locale",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur reseau");
    } finally {
      setBusy(null);
    }
  }, [id, runTranscription]);

  const handleLaunch = useCallback(async () => {
    setLaunching(true);
    setError(null);
    try {
      const res = await fetch("/api/transcribe-launch", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Impossible de lancer le service");
        return;
      }
      // Attendre que le service soit pret
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        try {
          const h = await fetch("/api/transcribe-health");
          const hd = await h.json();
          if (hd.ok) {
            setError(null);
            setServiceOk(true);
            return;
          }
        } catch {
          // continue
        }
      }
      setError("Le service ne repond pas. Lance start-transcribe.bat manuellement.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur reseau");
    } finally {
      setLaunching(false);
    }
  }, []);

  const handleSaveTab = useCallback(async () => {
    if (!song || !tabResult) return;
    const updated = { ...song, transcribedTab: tabResult.tab };
    await upsert(updated);
    setSavedTab(true);
  }, [song, tabResult, upsert, setSavedTab]);

  const handleSaveChords = useCallback(async () => {
    if (!song || !chordResult) return;
    // On n'ecrit jamais dans officialSynced : ce champ porte les paroles
    // synchronisees, qui seraient perdues. Les accords vivent a part.
    const header = chordResult.key ? `# Tonalite : ${chordResult.key}\n` : "";
    const lrc = chordResult.chords
      .map(
        (c) =>
          `[${Math.floor(c.start / 60).toString().padStart(2, "0")}:${(c.start % 60)
            .toFixed(2)
            .padStart(5, "0")}] ${c.chord}`
      )
      .join("\n");
    const updated = { ...song, transcribedChords: header + lrc };
    await upsert(updated);
    setSavedChords(true);
  }, [song, chordResult, upsert, setSavedChords]);

  const disabled = busy !== null;

  return (
    <div className="flex flex-col min-h-screen bg-black text-zinc-200">
      <header className="sticky top-0 z-10 bg-black/80 backdrop-blur-lg border-b border-zinc-800/50">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => router.push(`/song/${id}`)}
            className="p-2 hover:bg-zinc-800 rounded-lg"
          >
            <ArrowLeft className="w-5 h-5 text-zinc-400" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-white truncate">Transcription IA</h1>
            <p className="text-sm text-zinc-400 truncate">
              {song?.title ?? "Chargement…"} — {song?.artist ?? ""}
            </p>
          </div>
          <button
            onClick={handleLaunch}
            disabled={launching || serviceOk}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={
              serviceOk
                ? "Service de transcription en ligne"
                : "Lancer le service local (start-transcribe.bat)"
            }
          >
            {launching ? "Lancement…" : "Démarrer le service"}
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6 flex flex-col gap-6">
        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
            {error}
          </div>
        )}

        <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 flex flex-col gap-3">
          <h2 className="text-sm font-bold text-zinc-300">Source audio</h2>
          <div className="flex flex-wrap gap-2">
            {youtubeId ? (
              <button
                onClick={transcribeFromYoutube}
                disabled={disabled}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-orange-600 text-white hover:bg-orange-500 transition-colors disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5" />
                Transcrire depuis YouTube
              </button>
            ) : (
              <button
                onClick={transcribeFromSearch}
                disabled={disabled || !song}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-orange-600 text-white hover:bg-orange-500 transition-colors disabled:opacity-50"
                title="Cherche la chanson sur YouTube avec l'artiste et le titre"
              >
                <Search className="w-3.5 h-3.5" />
                Chercher sur YouTube
              </button>
            )}
            {hasStems && (
              <button
                onClick={transcribeFromStems}
                disabled={disabled}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-emerald-700 text-white hover:bg-emerald-600 transition-colors disabled:opacity-50"
                title="Meilleur résultat : l'instrumental ne contient pas de voix"
              >
                <FileAudio className="w-3.5 h-3.5" />
                Utiliser l&apos;instrumental
              </button>
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors disabled:opacity-50"
            >
              <Upload className="w-3.5 h-3.5" />
              Choisir un fichier audio…
            </button>
            <input
              type="file"
              accept="audio/*"
              className="hidden"
              ref={fileInputRef}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  void runTranscription({
                    blob: file,
                    fileName: file.name,
                    label: file.name,
                  });
                }
                e.target.value = "";
              }}
            />
          </div>
          <p className="text-xs text-zinc-500">
            {youtubeId ? (
              <>
                Vidéo liée :{" "}
                <span className="font-mono text-zinc-400">
                  youtube.com/watch?v={youtubeId}
                </span>
                . L&apos;audio est téléchargé côté serveur, aucun envoi manuel.
              </>
            ) : (
              <>
                Aucun lien YouTube : la chanson sera cherchée automatiquement
                (artiste + titre).
              </>
            )}{" "}
            Spotify ne permet pas de télécharger l&apos;audio (DRM) — on passe
            donc par YouTube.
          </p>
        </section>

        {busy && (
          <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Loader2 className="w-4 h-4 animate-spin text-amber-400 flex-shrink-0" />
                <span className="text-sm font-semibold text-zinc-200 truncate">
                  {PHASE_LABEL[progress?.phase ?? "notes"] ?? "Transcription"}
                </span>
              </div>
              <span className="text-xs font-mono text-amber-400 flex-shrink-0">
                {Math.round(progress?.percent ?? 0)} %
              </span>
            </div>
            <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full bg-amber-500 transition-[width] duration-500"
                style={{ width: `${Math.min(100, Math.max(2, progress?.percent ?? 2))}%` }}
              />
            </div>
            <p className="text-xs text-zinc-500 truncate">
              {progress?.line || busy}
              {busy !== progress?.line && (
                <span className="ml-2 text-zinc-600">source : {busy}</span>
              )}
            </p>
          </section>
        )}

        {tabResult && (
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h2 className="text-sm font-bold text-zinc-300">
                Tablature transcrite ({tabResult.tab_notes ?? tabResult.note_count}{" "}
                notes · {tabResult.duration.toFixed(1)} s
                {tabResult.bpm ? ` · ≈ ${Math.round(tabResult.bpm)} BPM` : ""})
                {sourceLabel && (
                  <span className="ml-2 text-xs font-normal text-zinc-500">
                    source : {sourceLabel}
                  </span>
                )}
              </h2>
              <button
                onClick={handleSaveTab}
                disabled={savedTab}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-500 text-black hover:bg-amber-400 transition-colors disabled:opacity-60 disabled:cursor-default"
              >
                {savedTab ? "Tablature enregistrée ✓" : "Appliquer la tablature"}
              </button>
            </div>
            <pre className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 font-mono text-xs text-zinc-200 whitespace-pre overflow-x-auto max-h-96">
              {tabResult.tab}
            </pre>
          </section>
        )}

        {chordResult && (
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h2 className="text-sm font-bold text-zinc-300">
                Accords détectés ({chordResult.count} accords ·{" "}
                {chordResult.duration.toFixed(1)} s)
                {chordResult.key && (
                  <span className="ml-2 text-xs font-normal text-zinc-500">
                    tonalité : {chordResult.key}
                  </span>
                )}
              </h2>
              <button
                onClick={handleSaveChords}
                disabled={savedChords}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-500 text-black hover:bg-amber-400 transition-colors disabled:opacity-60 disabled:cursor-default"
              >
                {savedChords ? "Accords enregistrés ✓" : "Appliquer les accords"}
              </button>
            </div>
            {chordResult.repetitions && chordResult.repetitions.repeats > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
                <strong>Répétition détectée :</strong>{" "}
                {chordResult.repetitions.pattern.join(" → ")} ×
                {chordResult.repetitions.repeats} (couverture{" "}
                {(chordResult.repetitions.coverage * 100).toFixed(0)}%)
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {chordResult.chords.map((c, i) => (
                <span
                  key={i}
                  className="text-xs font-mono bg-zinc-800 text-zinc-200 rounded-lg px-2 py-1"
                >
                  {c.start.toFixed(1)}s → {c.chord}
                </span>
              ))}
            </div>
          </section>
        )}

        {!busy && !tabResult && !chordResult && !error && (
          <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
            <Music2 className="w-12 h-12 mb-4 opacity-30" />
            <p>Choisis une source audio pour lancer la transcription.</p>
            <p className="text-xs mt-2">
              Le service local (start-transcribe.bat) doit tourner sur le port
              8766.
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-2 pb-6">
          <button
            onClick={() => router.push(`/song/${id}`)}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Retour à la chanson
          </button>
          <button
            onClick={() => router.push(`/song/${id}/edit`)}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors"
          >
            Ouvrir l&apos;éditeur
          </button>
        </div>
      </main>
    </div>
  );
}
