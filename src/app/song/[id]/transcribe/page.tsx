"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { use, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Upload, Music2, Loader2 } from "lucide-react";
import { useSharedSong } from "@/lib/use-shared-song";

export default function TranscribePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { current: song, upsert } = useSharedSong(id);

  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tabResult, setTabResult] = useState<{ tab: string; note_count: number; duration: number } | null>(null);
  const [chordResult, setChordResult] = useState<{ chords: { start: number; end: number; chord: string }[]; count: number; duration: number; repetitions: { pattern: string[]; repeats: number; coverage: number } } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setTranscribing(true);
    setError(null);
    setTabResult(null);
    setChordResult(null);
    try {
      // Transcription (notes + tab)
      const fd1 = new FormData();
      fd1.append("file", file);
      const res1 = await fetch("/api/transcribe", { method: "POST", body: fd1 });
      const data1 = await res1.json().catch(() => null);
      if (!res1.ok) {
        setError(data1?.error ?? data1?.detail ?? "Erreur de transcription");
        return;
      }
      setTabResult({ tab: data1.tab, note_count: data1.note_count, duration: data1.duration });

      // Detection d'accords + repetitions
      const fd2 = new FormData();
      fd2.append("file", file);
      const res2 = await fetch("/api/transcribe-chords", { method: "POST", body: fd2 });
      const data2 = await res2.json().catch(() => null);
      if (res2.ok) {
        setChordResult({
          chords: data2.chords,
          count: data2.count,
          duration: data2.duration,
          repetitions: data2.repetitions,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur reseau");
    } finally {
      setTranscribing(false);
    }
  }, []);

  const handleSaveTab = useCallback(async () => {
    if (!song || !tabResult) return;
    const updated = { ...song, transcribedTab: tabResult.tab };
    await upsert(updated);
  }, [song, tabResult, upsert]);

  const handleSaveChords = useCallback(async () => {
    if (!song || !chordResult) return;
    // Sauvegarder la sequence d'accords dans officialSynced (format LRC-like)
    const lrc = chordResult.chords
      .map((c) => `[${Math.floor(c.start / 60).toString().padStart(2, "0")}:${(c.start % 60).toFixed(2).padStart(5, "0")}] ${c.chord}`)
      .join("\n");
    const updated = { ...song, officialSynced: lrc };
    await upsert(updated);
  }, [song, chordResult, upsert]);

  return (
    <div className="flex flex-col min-h-screen bg-black text-zinc-200">
      <header className="sticky top-0 z-10 bg-black/80 backdrop-blur-lg border-b border-zinc-800/50">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => router.push(`/song/${id}`)} className="p-2 hover:bg-zinc-800 rounded-lg">
            <ArrowLeft className="w-5 h-5 text-zinc-400" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-white truncate">Transcription IA</h1>
            <p className="text-sm text-zinc-400 truncate">{song?.title ?? "Chargement…"} — {song?.artist ?? ""}</p>
          </div>
          <input
            type="file"
            accept="audio/*"
            className="hidden"
            ref={fileInputRef}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={transcribing}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-orange-600 text-white hover:bg-orange-500 transition-colors disabled:opacity-50"
          >
            <Upload className="w-3.5 h-3.5" />
            {transcribing ? "Transcription…" : "Transcrire un audio"}
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6 flex flex-col gap-6">
        {error && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
            {error}
          </div>
        )}

        {transcribing && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-amber-400" />
            <span className="ml-3 text-zinc-400">Transcription en cours…</span>
          </div>
        )}

        {tabResult && (
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-zinc-300">
                Tablature transcrite ({tabResult.note_count} notes · {tabResult.duration.toFixed(1)} s)
              </h2>
              <button
                onClick={handleSaveTab}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-500 text-black hover:bg-amber-400 transition-colors"
              >
                Appliquer la tablature
              </button>
            </div>
            <pre className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 font-mono text-xs text-zinc-200 whitespace-pre overflow-x-auto max-h-96">
              {tabResult.tab}
            </pre>
          </section>
        )}

        {chordResult && (
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-zinc-300">
                Accords détectés ({chordResult.count} accords · {chordResult.duration.toFixed(1)} s)
              </h2>
              <button
                onClick={handleSaveChords}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-500 text-black hover:bg-amber-400 transition-colors"
              >
                Appliquer les accords
              </button>
            </div>
            {chordResult.repetitions && chordResult.repetitions.repeats > 0 && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
                <strong>Répétition détectée :</strong>{" "}
                {chordResult.repetitions.pattern.join(" → ")} ×{chordResult.repetitions.repeats}
                {" "}(couverture {(chordResult.repetitions.coverage * 100).toFixed(0)}%)
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

        {!transcribing && !tabResult && !chordResult && !error && (
          <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
            <Music2 className="w-12 h-12 mb-4 opacity-30" />
            <p>Sélectionne un fichier audio pour le transcrire.</p>
            <p className="text-xs mt-2">Le service local (start-transcribe.bat) doit tourner sur le port 8766.</p>
          </div>
        )}
      </main>
    </div>
  );
}
