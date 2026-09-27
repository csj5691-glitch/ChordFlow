"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { useCallback, useEffect, useRef, useState } from "react";
import { AudioWaveform, Check, Loader2, Pause, Play, Square, Trash2 } from "lucide-react";
import { saveStem, loadStems, deleteStems } from "@/lib/stems-db";

const STEMS = [
  { id: "vocals", label: "Voix", color: "bg-violet-500" },
  { id: "drums", label: "Batterie", color: "bg-amber-500" },
  { id: "bass", label: "Basse", color: "bg-emerald-500" },
  { id: "guitar", label: "Guitare", color: "bg-sky-500" },
  { id: "piano", label: "Piano", color: "bg-purple-400" },
  { id: "other", label: "Autres", color: "bg-zinc-400" },
] as const;

type StemId = (typeof STEMS)[number]["id"];

type StemStatus = "idle" | "loading" | "ready" | "error";

export default function StemsMixer({ songId }: { songId: string }) {
  const [status, setStatus] = useState<Record<StemId, StemStatus>>({
    vocals: "idle",
    drums: "idle",
    bass: "idle",
    guitar: "idle",
    piano: "idle",
    other: "idle",
  });
  const [stemUrls, setStemUrls] = useState<Record<StemId, string | null>>({
    vocals: null,
    drums: null,
    bass: null,
    guitar: null,
    piano: null,
    other: null,
  });
  const [volumes, setVolumes] = useState<Record<StemId, number>>({
    vocals: 0.8,
    drums: 0.8,
    bass: 0.8,
    guitar: 0.8,
    piano: 0.8,
    other: 0.8,
  });
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const audioObjsRef = useRef<Partial<Record<StemId, HTMLAudioElement>>>({});

  const readyCount = STEMS.filter((s) => status[s.id] === "ready").length;

  useEffect(() => {
    if (!busy) return;
    const start = Date.now();
    const interval = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [busy]);

  useEffect(() => {
    void loadStems(songId).then((records) => {
      if (records.length === 0) return;
      const urls: Record<StemId, string | null> = {
        vocals: null, drums: null, bass: null, guitar: null, piano: null, other: null,
      };
      const st: Record<StemId, StemStatus> = {
        vocals: "idle", drums: "idle", bass: "idle", guitar: "idle", piano: "idle", other: "idle",
      };
      for (const rec of records) {
        const url = URL.createObjectURL(rec.blob);
        urls[rec.stem as StemId] = url;
        st[rec.stem as StemId] = "ready";
        const audioEl = new Audio(url);
        audioEl.preload = "auto";
        audioObjsRef.current[rec.stem as StemId] = audioEl;
      }
      setStemUrls(urls);
      setStatus(st);
    }).catch(() => {});
  }, [songId]);

  useEffect(() => {
    return () => {
      for (const key of Object.keys(stemUrls) as StemId[]) {
        if (stemUrls[key]) URL.revokeObjectURL(stemUrls[key]!);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setPlaying(false);
      for (const key of Object.keys(stemUrls) as StemId[]) {
        if (stemUrls[key]) URL.revokeObjectURL(stemUrls[key]!);
      }
      setStemUrls({
        vocals: null,
        drums: null,
        bass: null,
        guitar: null,
        piano: null,
        other: null,
      });
      setStatus({
        vocals: "idle",
        drums: "idle",
        bass: "idle",
        guitar: "idle",
        piano: "idle",
        other: "idle",
      });

      const buffer = await file.arrayBuffer();
      const blob = new Blob([buffer], { type: file.type });

      for (const stem of STEMS) {
        setStatus((prev) => ({ ...prev, [stem.id]: "loading" }));
        try {
          const form = new FormData();
          form.set("file", blob, file.name);
          const res = await fetch(`/api/stems?stem=${stem.id}`, {
            method: "POST",
            body: form,
            signal: AbortSignal.timeout(600_000),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => null);
            throw new Error(data?.error ?? `erreur ${res.status}`);
          }
          const audioBlob = await res.blob();
            const url = URL.createObjectURL(audioBlob);
            const audioEl = new Audio(url);
            audioEl.preload = "auto";
            audioObjsRef.current[stem.id] = audioEl;
            setStemUrls((prev) => ({ ...prev, [stem.id]: url }));
            setStatus((prev) => ({ ...prev, [stem.id]: "ready" }));
            void saveStem({
              id: `${songId}-${stem.id}`,
              songId,
              stem: stem.id,
              blob: audioBlob,
              fileName: file.name,
              createdAt: Date.now(),
            });
        } catch {
          setStatus((prev) => ({ ...prev, [stem.id]: "error" }));
        }
      }
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    },
    [stemUrls, songId],
  );

  const play = useCallback(() => {
    for (const stem of STEMS) {
      const el = audioObjsRef.current[stem.id];
      if (!el || status[stem.id] !== "ready") continue;
      el.currentTime = 0;
      el.volume = volumes[stem.id];
      void el.play().catch(() => {});
    }
    setPlaying(true);
  }, [status, volumes]);

  const pause = useCallback(() => {
    for (const stem of STEMS) {
      const el = audioObjsRef.current[stem.id];
      if (el) el.pause();
    }
    setPlaying(false);
  }, []);

  const stop = useCallback(() => {
    for (const stem of STEMS) {
      const el = audioObjsRef.current[stem.id];
      if (el) {
        el.pause();
        el.currentTime = 0;
      }
    }
    setPlaying(false);
  }, []);

  const toggle = useCallback(() => {
    if (playing) {
      pause();
    } else {
      play();
    }
  }, [playing, pause, play]);

  const handleVolumeChange = useCallback((stem: StemId, value: number) => {
    setVolumes((prev) => ({ ...prev, [stem]: value }));
    const el = audioObjsRef.current[stem];
    if (el) el.volume = value;
  }, []);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 flex flex-col gap-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
        <AudioWaveform className="w-4 h-4 text-emerald-400" />
        Mixeur 6 pistes (Demucs)
      </div>
      <p className="text-xs text-zinc-500">
        Upload un fichier audio — séparation en 6 pistes synchronisées.
      </p>
      <p className="text-[10px] text-zinc-600">
        Formats supportés : WAV, MP3, FLAC, OGG, M4A, AAC — max 200 Mo
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
        className="text-xs text-zinc-400 file:mr-3 file:rounded-lg file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-zinc-200 hover:file:bg-zinc-700"
      />

      {busy && (
        <div className="flex items-center gap-2 text-xs text-amber-300 animate-pulse">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Séparation en cours — {readyCount}/6 pistes ({Math.round((readyCount / 6) * 100)}%) — {elapsed}s écoulées
        </div>
      )}

      {readyCount > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggle}
              disabled={readyCount === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 text-black text-xs font-semibold hover:bg-emerald-400 transition-colors disabled:opacity-40"
            >
              {playing ? (
                <>
                  <Pause className="w-3.5 h-3.5" />
                  Pause
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" />
                  Jouer
                </>
              )}
            </button>
            <button
              type="button"
              onClick={stop}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 text-xs font-semibold hover:bg-zinc-700 transition-colors"
            >
              <Square className="w-3.5 h-3.5" />
              Stop
            </button>
            <button
              type="button"
              onClick={() => {
                void deleteStems(songId).then(() => {
                  for (const key of Object.keys(stemUrls) as StemId[]) {
                    if (stemUrls[key]) URL.revokeObjectURL(stemUrls[key]!);
                    const el = audioObjsRef.current[key];
                    if (el) {
                      el.pause();
                      el.src = "";
                    }
                  }
                  setStemUrls({ vocals: null, drums: null, bass: null, guitar: null, piano: null, other: null });
                  setStatus({ vocals: "idle", drums: "idle", bass: "idle", guitar: "idle", piano: "idle", other: "idle" });
                  setPlaying(false);
                });
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 text-red-400 text-xs font-semibold hover:bg-zinc-700 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Effacer
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {STEMS.map((stem) => {
              const st = status[stem.id];
              return (
                <div
                  key={stem.id}
                  className="flex items-center gap-2 rounded-lg bg-zinc-800/60 px-2 py-1.5"
                >
                  <span className={`w-2 h-2 rounded-full ${stem.color} flex-shrink-0`} />
                  <span className="text-xs text-zinc-300 w-20 flex-shrink-0">
                    {stem.label}
                  </span>
                  {st === "loading" && (
                    <Loader2 className="w-3 h-3 animate-spin text-amber-400 flex-shrink-0" />
                  )}
                  {st === "ready" && (
                    <Check className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                  )}
                  {st === "error" && (
                    <span className="text-[10px] text-red-400 flex-shrink-0">erreur</span>
                  )}
                  {st === "ready" && (
                    <>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={volumes[stem.id]}
                        onChange={(e) =>
                          handleVolumeChange(stem.id, parseFloat(e.target.value))
                        }
                        className="flex-1 h-1 accent-emerald-500 cursor-pointer"
                      />
                      <span className="text-[10px] text-zinc-500 font-mono w-8 text-right">
                        {Math.round(volumes[stem.id] * 100)}%
                      </span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {busy && readyCount < 6 && (
        <div className="flex flex-col gap-1">
          {STEMS.map((stem) => (
            <div key={stem.id} className="flex items-center gap-2 text-xs text-zinc-500">
              <span className={`w-1.5 h-1.5 rounded-full ${
                status[stem.id] === "loading"
                  ? "bg-amber-400 animate-pulse"
                  : status[stem.id] === "ready"
                  ? "bg-emerald-400"
                  : status[stem.id] === "error"
                  ? "bg-red-400"
                  : "bg-zinc-600"
              }`} />
              <span className="w-16">{stem.label}</span>
              <span className="text-[10px]">
                {status[stem.id] === "loading"
                  ? `en cours… ${elapsed}s`
                  : status[stem.id] === "ready"
                  ? "OK"
                  : status[stem.id] === "error"
                  ? "échec"
                  : "en attente"}
              </span>
            </div>
          ))}
        </div>
      )}


    </div>
  );
}
