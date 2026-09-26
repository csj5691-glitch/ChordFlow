"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { useCallback, useRef, useState } from "react";
import { AudioWaveform, Download, Loader2, Music2 } from "lucide-react";

const STEMS = [
  { id: "vocals", label: "Voix" },
  { id: "drums", label: "Batterie" },
  { id: "bass", label: "Basse" },
  { id: "other", label: "Autres" },
] as const;

type StemId = (typeof STEMS)[number]["id"];

export default function StemsExtractor() {
  const [stem, setStem] = useState<StemId>("vocals");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; label: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      setResult(null);
      try {
        const form = new FormData();
        form.set("file", file, file.name);
        form.set("stem", stem);
        const res = await fetch("/api/stems", { method: "POST", body: form });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error ?? `erreur ${res.status}`);
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setResult({ url, label: stem });
      } catch (e) {
        setError(e instanceof Error ? e.message : "échec extraction");
      } finally {
        setBusy(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [stem],
  );

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
        <AudioWaveform className="w-4 h-4 text-emerald-400" />
        Séparer les pistes (Demucs local)
      </div>
      <p className="text-xs text-zinc-500">
        Upload un fichier audio — le service local demucs-onnx extrait la piste choisie.
      </p>
      <div className="flex flex-wrap gap-2">
        {STEMS.map((s) => (
          <button
            key={s.id}
            type="button"
            disabled={busy}
            onClick={() => setStem(s.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              stem === s.id
                ? "bg-emerald-500 text-black"
                : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            } disabled:opacity-40`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
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
      </div>
      {busy && (
        <div className="flex items-center gap-2 text-xs text-amber-300 animate-pulse">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Séparation en cours (peut prendre 1–2 min)…
        </div>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
      {result && (
        <div className="flex flex-col gap-2">
          <audio controls src={result.url} className="w-full h-8" />
          <div className="flex items-center gap-2">
            <Music2 className="w-3.5 h-3.5 text-emerald-400" />
            <a
              href={result.url}
              download={`${result.label}.wav`}
              className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300"
            >
              <Download className="w-3.5 h-3.5" />
              Télécharger ({result.label}.wav)
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
