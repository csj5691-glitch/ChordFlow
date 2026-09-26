"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { useCallback, useEffect, useRef, useState } from "react";
import { AudioWaveform, Loader2, Pause, Play, Square } from "lucide-react";

const STEMS = [
  { id: "vocals", label: "Voix", color: "bg-violet-500" },
  { id: "drums", label: "Batterie", color: "bg-amber-500" },
  { id: "bass", label: "Basse", color: "bg-emerald-500" },
  { id: "guitar", label: "Guitare", color: "bg-sky-500" },
  { id: "piano", label: "Piano", color: "bg-purple-400" },
  { id: "other", label: "Autres", color: "bg-zinc-400" },
] as const;

type StemId = (typeof STEMS)[number]["id"];

export default function StemsMixer() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRefs = useRef<Record<StemId, HTMLAudioElement | null>>({
    vocals: null,
    drums: null,
    bass: null,
    guitar: null,
    piano: null,
    other: null,
  });
  const timeoutsRef = useRef<number[]>([]);

  const cleanupUrls = useCallback(() => {
    for (const key of Object.keys(stemUrls) as StemId[]) {
      if (stemUrls[key]) URL.revokeObjectURL(stemUrls[key]!);
    }
  }, [stemUrls]);

  useEffect(() => {
    return () => {
      for (const key of Object.keys(stemUrls) as StemId[]) {
        if (stemUrls[key]) URL.revokeObjectURL(stemUrls[key]!);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      for (const t of timeoutsRef.current) window.clearTimeout(t);
    };
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      setPlaying(false);
      cleanupUrls();
      try {
        const form = new FormData();
        form.set("file", file, file.name);
        const res = await fetch("/api/stems", { method: "POST", body: form });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error ?? `erreur ${res.status}`);
        }
        const zipBlob = await res.blob();
        const entries = await readZip(zipBlob);
        const newUrls: Record<StemId, string | null> = {
          vocals: null,
          drums: null,
          bass: null,
          guitar: null,
          piano: null,
          other: null,
        };
        for (const stem of STEMS) {
          const blob = entries[stem.id];
          if (blob) newUrls[stem.id] = URL.createObjectURL(blob);
        }
        setStemUrls(newUrls);
      } catch (e) {
        setError(e instanceof Error ? e.message : "échec extraction");
        setStemUrls({
          vocals: null,
          drums: null,
          bass: null,
          guitar: null,
          piano: null,
          other: null,
        });
      } finally {
        setBusy(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [cleanupUrls],
  );

  const play = useCallback(() => {
    const offset = 0;
    for (const stem of STEMS) {
      const el = audioRefs.current[stem.id];
      if (!el || !stemUrls[stem.id]) continue;
      el.currentTime = offset;
      el.volume = volumes[stem.id];
      void el.play().catch(() => {});
    }
    setPlaying(true);
  }, [stemUrls, volumes]);

  const pause = useCallback(() => {
    for (const stem of STEMS) {
      const el = audioRefs.current[stem.id];
      if (el) el.pause();
    }
    setPlaying(false);
  }, []);

  const stop = useCallback(() => {
    for (const stem of STEMS) {
      const el = audioRefs.current[stem.id];
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

  const handleVolumeChange = useCallback(
    (stem: StemId, value: number) => {
      setVolumes((prev) => ({ ...prev, [stem]: value }));
      const el = audioRefs.current[stem];
      if (el) el.volume = value;
    },
    [],
  );

  const allReady = STEMS.every((s) => stemUrls[s.id]);
  const readyCount = STEMS.filter((s) => stemUrls[s.id]).length;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 flex flex-col gap-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
        <AudioWaveform className="w-4 h-4 text-emerald-400" />
        Mixeur 6 pistes (Demucs)
      </div>
      <p className="text-xs text-zinc-500">
        Upload un fichier audio — le service local sépare en 6 pistes synchronisées.
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
          Séparation en cours (peut prendre 1–3 min)…
        </div>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}

      {allReady && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggle}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 text-black text-xs font-semibold hover:bg-emerald-400 transition-colors"
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
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {STEMS.map((stem) => (
              <div
                key={stem.id}
                className="flex items-center gap-2 rounded-lg bg-zinc-800/60 px-2 py-1.5"
              >
                <span
                  className={`w-2 h-2 rounded-full ${stem.color} flex-shrink-0`}
                />
                <span className="text-xs text-zinc-300 w-20 flex-shrink-0">
                  {stem.label}
                </span>
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
              </div>
            ))}
          </div>
        </div>
      )}

      {!allReady && readyCount > 0 && (
        <p className="text-xs text-zinc-500">
          {readyCount}/6 pistes disponibles
        </p>
      )}

      {STEMS.map((stem) => (
        <audio
          key={stem.id}
          ref={(el) => {
            audioRefs.current[stem.id] = el;
          }}
          src={stemUrls[stem.id] ?? undefined}
          preload="auto"
          className="hidden"
        />
      ))}
    </div>
  );
}

async function readZip(
  blob: Blob,
): Promise<Record<string, Blob>> {
  const ds = new DecompressionStream("deflate-raw");
  const stream = blob.stream().pipeThrough(ds);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const data = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    data.set(c, offset);
    offset += c.length;
  }
  const view = new DataView(data.buffer);
  const text = new TextDecoder();
  const result: Record<string, Blob> = {};

  let pos = 0;
  while (pos < data.length - 4) {
    const sig = view.getUint32(pos, true);
    if (sig !== 0x04034b50) break;
    const compMethod = view.getUint16(pos + 8, true);
    const compSize = view.getUint32(pos + 18, true);
    const nameLen = view.getUint16(pos + 26, true);
    const extraLen = view.getUint16(pos + 28, true);
    const name = text.decode(data.subarray(pos + 30, pos + 30 + nameLen));
    const dataStart = pos + 30 + nameLen + extraLen;
    const fileData = data.subarray(dataStart, dataStart + compSize);

    if (!name.endsWith("/")) {
      const ds2 = new DecompressionStream("deflate-raw");
      const stream2 = new Blob([fileData]).stream().pipeThrough(ds2);
      const reader2 = stream2.getReader();
      const chunks2: Uint8Array[] = [];
      let total2 = 0;
      while (true) {
        const { done, value } = await reader2.read();
        if (done) break;
        chunks2.push(value);
        total2 += value.length;
      }
      const raw = new Uint8Array(total2);
      let off2 = 0;
      for (const c of chunks2) {
        raw.set(c, off2);
        off2 += c.length;
      }
      const stemName = name.replace(".wav", "").toLowerCase();
      result[stemName] = new Blob([raw], { type: "audio/wav" });
    }

    pos = dataStart + compSize;
  }

  return result;
}
