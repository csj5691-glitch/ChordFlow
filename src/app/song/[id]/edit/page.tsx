"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { use, useState, useCallback, useRef, useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import ChordBuilder from "@/components/ChordBuilder";
import ChordShapeView from "@/components/ChordShapeView";
import SynthPlayer from "@/components/SynthPlayer";
import Conductor from "@/components/Conductor";
import { getSongTab } from "@/lib/mock-data";
import { useSharedSong } from "@/lib/use-shared-song";
import type { SavedChordShape, SongTab } from "@/lib/types";
import {
  ArrowLeft,
  FileText,
  LayoutGrid,
  Plus,
  Pause,
  Trash2,
  ChevronUp,
  ChevronDown,
  Save,
  Copy,
  Clipboard,
  SeparatorVertical,
  Mic2,
} from "lucide-react";

function getStaticSong(id: string): SongTab | null {
  if (id.startsWith("custom-")) return null;
  return getSongTab(id);
}

function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

type EditMode = "grid" | "diagrams";

const DURATION_OPTIONS = [
  { label: "dble croche · ¼ temps", note: "double-croche", beats: 0.25 },
  { label: "croche · ½ temps", note: "croche", beats: 0.5 },
  { label: "noire · 1 temps", note: "noire", beats: 1 },
  { label: "blanche · 2 temps", note: "blanche", beats: 2 },
  { label: "ronde · 4 temps", note: "ronde", beats: 4 },
  { label: "carrée · 8 temps", note: "carrée", beats: 8 },
] as const;

function formatBeats(beats: number): string {
  const base = DURATION_OPTIONS.find((o) => o.beats === beats);
  if (base) return base.note;
  const dotted = DURATION_OPTIONS.find((o) => o.beats * 1.5 === beats);
  return dotted ? `${dotted.note} pointée` : String(beats);
}

export default function EditSongPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EditSongView key={id} id={id} />;
}

function EditSongView({ id }: { id: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [mode, setMode] = useState<EditMode>("grid");
  const [editableContent, setEditableContent] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const [copied, setCopied] = useState<SavedChordShape | null>(null);
  const [conductorOpen, setConductorOpen] = useState(false);
  const hydratedContent = useRef(false);

  const baseSong = getStaticSong(id);
  const { current: sharedSong, upsert } = useSharedSong(id);
  const song: SongTab | null = hydrated
    ? (sharedSong ?? baseSong)
    : baseSong;

  const diagrams = song?.diagrams ?? [];

  useEffect(() => {
    if (song?.content !== undefined && !hydratedContent.current) {
      hydratedContent.current = true;
      setEditableContent(song.content);
    }
  }, [song]);

  const content = editableContent ?? song?.content ?? "";

  const handleSaveBuilderShape = useCallback(
    (shape: SavedChordShape) => {
      setShowBuilder(false);
      if (song) {
        const next: SongTab = {
          ...song,
          diagrams: [...(song.diagrams ?? []), shape],
        };
        upsert(next);
      }
    },
    [song, upsert]
  );

  const removeDiagram = useCallback(
    (diagramId: string) => {
      if (!song) return;
      const next: SongTab = {
        ...song,
        diagrams: (song.diagrams ?? []).filter((d) => d.id !== diagramId),
      };
      upsert(next);
    },
    [song, upsert]
  );

  const clearDiagrams = useCallback(() => {
    if (!song) return;
    upsert({ ...song, diagrams: [] });
    setCopied(null);
  }, [song, upsert]);

  const moveDiagram = useCallback(
    (index: number, dir: -1 | 1) => {
      if (!song) return;
      const list = [...(song.diagrams ?? [])];
      const target = index + dir;
      if (target < 0 || target >= list.length) return;
      [list[index], list[target]] = [list[target], list[index]];
      upsert({ ...song, diagrams: list });
    },
    [song, upsert]
  );

  const copyDiagram = useCallback((index: number) => {
    if (!song) return;
    const d = song.diagrams?.[index];
    if (!d) return;
    setCopied(d);
  }, [song]);

  const pasteDiagram = useCallback(
    (index: number) => {
      if (!song || !copied) return;
      const list = [...(song.diagrams ?? [])];
      const paste: SavedChordShape = {
        ...copied,
        id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      };
      list.splice(index + 1, 0, paste);
      upsert({ ...song, diagrams: list });
    },
    [song, copied, upsert]
  );

  const saveContent = useCallback(() => {
    if (!song) return;
    upsert({ ...song, content: editableContent ?? song.content });
  }, [song, editableContent, upsert]);

  const setBpm = useCallback(
    (bpm: number) => {
      if (!song) return;
      upsert({ ...song, bpm: Math.min(500, Math.max(20, Math.round(bpm))) });
    },
    [song, upsert]
  );

  const setDuration = useCallback(
    (index: number, beats: number) => {
      if (!song) return;
      const list = [...(song.diagrams ?? [])];
      if (!list[index]) return;
      list[index] = { ...list[index], duration: beats };
      upsert({ ...song, diagrams: list });
    },
    [song, upsert]
  );

  const setDotted = useCallback(
    (index: number, dotted: boolean) => {
      if (!song) return;
      const list = [...(song.diagrams ?? [])];
      if (!list[index]) return;
      list[index] = { ...list[index], dotted };
      upsert({ ...song, diagrams: list });
    },
    [song, upsert]
  );

  const addSilence = useCallback(() => {
    if (!song) return;
    const silence: SavedChordShape = {
      id: `sil-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: "Silence",
      fingers: [],
      barreOn: false,
      barreCount: 6,
      muted: Array(6).fill(true),
      baseFret: 1,
      capo: 0,
      duration: 1,
      silence: true,
    };
    upsert({ ...song, diagrams: [...(song.diagrams ?? []), silence] });
  }, [song, upsert]);

  const addBar = useCallback(() => {
    if (!song) return;
    const bar: SavedChordShape = {
      id: `bar-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: "||",
      fingers: [],
      barreOn: false,
      barreCount: 6,
      muted: [],
      baseFret: 1,
      capo: 0,
      duration: 0,
      bar: true,
      repeats: 1,
    };
    upsert({ ...song, diagrams: [...(song.diagrams ?? []), bar] });
  }, [song, upsert]);

  const setRepeats = useCallback(
    (index: number, repeats: number) => {
      if (!song) return;
      const list = [...(song.diagrams ?? [])];
      if (!list[index]) return;
      list[index] = { ...list[index], repeats: Math.min(32, Math.max(1, repeats)) };
      upsert({ ...song, diagrams: list });
    },
    [song, upsert]
  );

  const bpm = song?.bpm ?? 90;
  const secondsFor = (beats: number) => (beats * 60) / bpm;
  const beatsFor = (d: SavedChordShape) => (d.duration ?? 1) * (d.dotted ? 1.5 : 1);

  const totalBeats = (() => {
    const list = song?.diagrams ?? [];
    let section = 0;
    let total = 0;
    for (const d of list) {
      if (d.bar) {
        total += section * (d.repeats ?? 1);
        section = 0;
      } else {
        section += beatsFor(d);
      }
    }
    return total + section;
  })();

  if (!song) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-zinc-500 text-lg">Chanson introuvable</p>
        <button
          onClick={() => router.push("/")}
          className="text-amber-400 hover:text-amber-300 flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Retour
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      <header className="sticky top-0 z-10 bg-black/80 backdrop-blur-lg border-b border-zinc-800/50">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => router.push(`/song/${id}`)}
            className="p-2 hover:bg-zinc-800 rounded-lg transition-colors"
            title="Retour à la chanson"
          >
            <ArrowLeft className="w-5 h-5 text-zinc-400" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-white truncate">Éditer</h1>
            <p className="text-sm text-zinc-400 truncate">
              {song.title} — {song.artist}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setMode("grid")}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                mode === "grid"
                  ? "text-black bg-amber-400"
                  : "text-zinc-400 bg-zinc-800 hover:bg-zinc-700"
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              Grille
            </button>
            <button
              onClick={() => setMode("diagrams")}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                mode === "diagrams"
                  ? "text-black bg-amber-400"
                  : "text-zinc-400 bg-zinc-800 hover:bg-zinc-700"
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              Diagrammes
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6 flex flex-col gap-6">
        {mode === "grid" ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-zinc-300">
                Grille d&apos;accords / paroles
              </h2>
              <button
                onClick={saveContent}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-500 text-black hover:bg-amber-400 transition-colors"
              >
                <Save className="w-3.5 h-3.5" />
                Enregistrer
              </button>
            </div>
            <textarea
              value={content}
              onChange={(e) => setEditableContent(e.target.value)}
              spellCheck={false}
              className="w-full h-[60vh] bg-zinc-950 border border-zinc-700 rounded-xl p-4 font-mono text-sm text-zinc-200 focus:outline-none focus:border-amber-500/60 resize-y"
            />
            <p className="text-[11px] text-zinc-600">
              Format : lignes d&apos;accords au-dessus des paroles, sections
              entre crochets. Les diagrammes sont regénérés depuis les noms.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-sm font-bold text-zinc-300">
                  Séquence de diagrammes ({diagrams.length})
                </h2>
                <span className="text-[10px] text-zinc-600 bg-zinc-800/60 rounded px-1.5 py-0.5">
                  Convention : 1 beat = 1 temps = 1 noire · 2 temps = 1 blanche · 4 temps = 1 ronde
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-zinc-500">BPM</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setBpm(bpm - 1)}
                      className="w-7 h-7 rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors text-sm font-bold"
                      title="Moins"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min={20}
                      max={500}
                      value={bpm}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        if (!Number.isNaN(v)) setBpm(v);
                      }}
                      className="w-16 h-7 rounded-md bg-zinc-950 border border-zinc-700 text-center text-sm text-amber-400 font-semibold focus:outline-none focus:border-amber-500/60"
                    />
                    <button
                      onClick={() => setBpm(bpm + 1)}
                      className="w-7 h-7 rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors text-sm font-bold"
                      title="Plus"
                    >
                      +
                    </button>
                  </div>
                  <span className="text-[11px] text-zinc-500">
                    Temps total ≈ {secondsFor(totalBeats).toFixed(1)} s
                  </span>
                </div>
              </div>
              <SynthPlayer diagrams={diagrams} bpm={bpm} />
              <button
                onClick={() => setConductorOpen(true)}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-500 text-black hover:bg-amber-400 transition-colors w-fit"
                title="Lancer la lecture plein écran avec les diagrammes qui défilent"
              >
                <Mic2 className="w-3.5 h-3.5" />
                Chef d&apos;orchestre
              </button>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setShowBuilder((v) => !v)}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-sky-500 text-black hover:bg-sky-400 transition-colors w-fit"
                >
                  <Plus className="w-3.5 h-3.5" />
                  {showBuilder ? "Masquer le créateur" : "Créer un diagramme"}
                </button>
                <button
                  onClick={addSilence}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-zinc-700 text-zinc-200 hover:bg-zinc-600 transition-colors w-fit"
                  title="Ajouter un silence à la séquence"
                >
                  <Pause className="w-3.5 h-3.5" />
                  Silence
                </button>
                <button
                  onClick={addBar}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-zinc-700 text-zinc-200 hover:bg-zinc-600 transition-colors w-fit"
                  title="Double barre : la section précédente sera répétée"
                >
                  <SeparatorVertical className="w-3.5 h-3.5" />
                  Double barre
                </button>
                {copied && (
                  <span className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-2.5 py-1">
                    <Copy className="w-3 h-3" />
                    {copied.label} copié
                  </span>
                )}
                {diagrams.length > 0 && (
                  <button
                    onClick={clearDiagrams}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/40 hover:bg-red-500/20 transition-colors w-fit"
                    title="Supprimer tous les diagrammes"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Tout supprimer
                  </button>
                )}
              </div>

              {showBuilder && (
                <div className="mt-2">
                  <ChordBuilder onSaveShape={handleSaveBuilderShape} />
                </div>
              )}
            </div>

            {diagrams.length === 0 ? (
              <p className="text-sm text-zinc-600">
                Aucun diagramme. Créez-en un avec le créateur ci-dessus.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {diagrams.map((d, i) => (
                  <div
                    key={d.id}
                    className="bg-zinc-900 border border-zinc-700 rounded-xl p-3 flex flex-col sm:flex-row items-center gap-4"
                  >
                    <div className="w-40 flex-shrink-0">
                      <ChordShapeView shape={d} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-amber-400">
                        {d.bar ? "Double barre" : d.label}
                      </p>
                      <p className="text-[11px] text-zinc-500">
                        {d.bar
                          ? `Rejoue la section précédente ${(d.repeats ?? 1)} fois`
                          : `Position ${i + 1}`}
                      </p>
                    </div>
                    <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
                      {d.bar ? (
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-[10px] text-zinc-500">
                            Répéter la section ×
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setRepeats(i, (d.repeats ?? 1) - 1)}
                              disabled={(d.repeats ?? 1) <= 1}
                              className="w-7 h-7 rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm font-bold"
                              title="Moins de répétitions"
                            >
                              −
                            </button>
                            <input
                              type="number"
                              min={1}
                              max={32}
                              value={d.repeats ?? 1}
                              onChange={(e) => {
                                const v = parseInt(e.target.value, 10);
                                if (!Number.isNaN(v)) setRepeats(i, v);
                              }}
                              className="w-12 h-7 rounded-md bg-zinc-950 border border-zinc-700 text-center text-sm text-amber-400 font-semibold focus:outline-none focus:border-amber-500/60"
                            />
                            <button
                              onClick={() => setRepeats(i, (d.repeats ?? 1) + 1)}
                              disabled={(d.repeats ?? 1) >= 32}
                              className="w-7 h-7 rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm font-bold"
                              title="Plus de répétitions"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-1">
                            <select
                              value={d.duration ?? 1}
                              onChange={(e) => setDuration(i, parseFloat(e.target.value))}
                              className="bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 px-2 py-1.5 focus:outline-none focus:border-amber-500/60 cursor-pointer"
                              title="Durée de cet accord"
                            >
                              {DURATION_OPTIONS.map((o) => (
                                <option key={o.label} value={o.beats}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                            <label className="flex flex-col items-center gap-0.5 cursor-pointer select-none" title="Pointé (×1,5)">
                              <input
                                type="checkbox"
                                checked={d.dotted === true}
                                onChange={(e) => setDotted(i, e.target.checked)}
                                className="w-4 h-4 accent-amber-500 cursor-pointer"
                              />
                              <span className="text-[10px] text-zinc-500">Pointé</span>
                            </label>
                          </div>
                          <span className="text-[10px] text-zinc-500">
                            <span className="text-zinc-400">{formatBeats(beatsFor(d))}</span>{" "}
                            · {secondsFor(beatsFor(d)).toFixed(2)} s
                          </span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => copyDiagram(i)}
                        className="flex items-center gap-1 p-2 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
                        title="Copier ce diagramme"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => pasteDiagram(i)}
                        disabled={!copied}
                        className="flex items-center gap-1 p-2 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        title="Coller après ce diagramme"
                      >
                        <Clipboard className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => moveDiagram(i, -1)}
                        disabled={i === 0}
                        className="p-2 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        title="Monter"
                      >
                        <ChevronUp className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => moveDiagram(i, 1)}
                        disabled={i === diagrams.length - 1}
                        className="p-2 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        title="Descendre"
                      >
                        <ChevronDown className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => removeDiagram(d.id)}
                        className="p-2 rounded-lg bg-zinc-800 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Supprimer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
      {conductorOpen && (
        <Conductor
          diagrams={diagrams}
          bpm={bpm}
          content={content}
          officialPlain={song?.officialPlain}
          officialSynced={song?.officialSynced}
          onClose={() => setConductorOpen(false)}
        />
      )}
    </div>
  );
}