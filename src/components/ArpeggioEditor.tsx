"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ChordShapeView from "@/components/ChordShapeView";
import TabStaffView from "@/components/TabStaffView";
import { diagramsToTab } from "@/lib/diagrams-to-tab";
import { soundingNotes } from "@/lib/articulation";
import { renderSequence } from "@/lib/chord-synth";
import { playGmEvent } from "@/lib/gm-voice";
import type { SavedChordShape } from "@/lib/types";
import { X, ChevronLeft, ChevronRight, Plus, Trash2, Copy, Music, Play, Square } from "lucide-react";

// Timbre de guitare General MIDI : 25 = Steel String Guitar (guitare acoustique).
const GUITAR_PROGRAM = 25;

// index 0 = corde grave (mi grave). Même convention que ChordShapeView.
const STRINGS = ["E", "A", "D", "G", "B", "e"];
const OPEN_MIDI = [40, 45, 50, 55, 59, 64];
const PITCH = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function pitchOf(string: number, fret: number): string {
  const midi = OPEN_MIDI[string] + fret;
  return PITCH[((midi % 12) + 12) % 12];
}

function noteFull(string: number, fret: number): string {
  const midi = OPEN_MIDI[string] + fret;
  return PITCH[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

// Fenêtre d'affichage du manche : décale `baseFret` pour que la case reste dans
// les 5 cases visibles de ChordShapeView.
function baseFretFor(fret: number): number {
  return fret <= 5 ? 1 : fret - 2;
}

interface PrimaryNote {
  string: number;
  fret: number;
}

function primaryNote(d: SavedChordShape): PrimaryNote {
  if (d.fingers.length > 0) {
    const sorted = [...d.fingers].sort((a, b) => a.string - b.string);
    return { string: sorted[0].string, fret: sorted[0].fret };
  }
  for (let s = 0; s < 6; s++) {
    if (d.muted?.[s] !== true) return { string: s, fret: 0 };
  }
  return { string: 5, fret: 0 };
}

// Reconstruit un diagramme à note unique (les autres cordes sont étouffées),
// en conservant durée/point/ending/legato.
function withNote(d: SavedChordShape, string: number, fret: number): SavedChordShape {
  const safeFret = Math.max(0, Math.min(24, fret));
  return {
    ...d,
    fingers: [{ string, fret: safeFret, finger: 1 }],
    muted: [0, 1, 2, 3, 4, 5].map((s) => s !== string),
    barreOn: false,
    barreCount: 6,
    baseFret: baseFretFor(safeFret),
    capo: 0,
    label: pitchOf(string, safeFret),
    silence: false,
    sounding: 1,
  };
}

function stepId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

interface ArpeggioEditorProps {
  diagrams: SavedChordShape[];
  start: number;
  end: number;
  title?: string;
  bpm: number;
  onClose?: () => void;
  onChange: (diagrams: SavedChordShape[]) => void;
  // Affichage en ligne (dans la vue Riff) plutôt qu'en modale plein écran.
  embedded?: boolean;
  heading?: string;
}

export default function ArpeggioEditor({
  diagrams,
  start,
  end,
  title,
  bpm,
  onClose,
  onChange,
  embedded = false,
  heading = "Éditeur d'arpège",
}: ArpeggioEditorProps) {
  const [endIdx, setEndIdx] = useState(end);
  const [playing, setPlaying] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const stopTimerRef = useRef<number | null>(null);

  const steps = useMemo(
    () => diagrams.slice(start, endIdx + 1),
    [diagrams, start, endIdx]
  );

  const tab = useMemo(
    () => diagramsToTab(steps, { title, bpm }),
    [steps, title, bpm]
  );

  useEffect(() => {
    if (embedded || !onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, embedded]);

  // Stoppe la lecture en fermant son contexte audio (coupe nettes des voix
  // encore planifiées) et annule le minuteur de fin.
  const stopAudio = useCallback(() => {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    const c = ctxRef.current;
    ctxRef.current = null;
    if (c) void c.close().catch(() => {});
    setPlaying(false);
  }, []);

  // Joue le riff (les `steps` affichés) avec un timbre de guitare MIDI. Le
  // contexte audio est créé au clic (geste utilisateur) puis recréé à chaque
  // lecture : `stopAudio` le ferme systématiquement, donc pas d'accumulation.
  const playRiff = useCallback(async () => {
    stopAudio();
    const events = renderSequence(steps, bpm);
    if (events.length === 0) return;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    ctxRef.current = ctx;
    try {
      await ctx.resume();
    } catch {
      // L'état réel est relu ci-dessous.
    }
    const master = ctx.createGain();
    master.gain.value = 0.7;
    master.connect(ctx.destination);
    const t0 = ctx.currentTime + 0.08;
    for (const ev of events) {
      playGmEvent(ctx, ev, master, t0 + ev.start, GUITAR_PROGRAM, {
        strum: "off",
        gain: 1,
      });
    }
    const last = events[events.length - 1];
    const totalMs = (last.start + last.duration + 0.6) * 1000;
    setPlaying(true);
    stopTimerRef.current = window.setTimeout(() => stopAudio(), totalMs);
  }, [steps, bpm, stopAudio]);

  // Libère le contexte audio si l'éditeur est démonté en pleine lecture.
  useEffect(() => {
    return () => {
      if (stopTimerRef.current !== null) window.clearTimeout(stopTimerRef.current);
      const c = ctxRef.current;
      if (c) void c.close().catch(() => {});
    };
  }, []);

  const updateNote = (k: number, note: PrimaryNote) => {
    const idx = start + k;
    const list = diagrams.slice();
    if (!list[idx]) return;
    list[idx] = withNote(list[idx], note.string, note.fret);
    onChange(list);
  };

  const move = (k: number, dir: -1 | 1) => {
    const idx = start + k;
    const target = idx + dir;
    if (target < start || target > endIdx) return;
    const list = diagrams.slice();
    [list[idx], list[target]] = [list[target], list[idx]];
    onChange(list);
  };

  const duplicate = (k: number) => {
    const idx = start + k;
    const list = diagrams.slice();
    const src = list[idx];
    if (!src) return;
    list.splice(idx + 1, 0, { ...src, id: stepId("arp") });
    setEndIdx((v) => v + 1);
    onChange(list);
  };

  const remove = (k: number) => {
    const idx = start + k;
    const list = diagrams.slice();
    if (!list[idx]) return;
    list.splice(idx, 1);
    if (steps.length <= 1) {
      onChange(list);
      onClose?.();
      return;
    }
    setEndIdx((v) => v - 1);
    onChange(list);
  };

  const addStep = () => {
    const list = diagrams.slice();
    const last = list[endIdx];
    const base = last ?? list[start];
    const fresh: SavedChordShape = base
      ? { ...base, id: stepId("arp") }
      : withNote(
          {
            id: stepId("arp"),
            label: "E",
            fingers: [],
            barreOn: false,
            barreCount: 6,
            muted: [],
            baseFret: 1,
            capo: 0,
            duration: 1,
          },
          0,
          0
        );
    list.splice(endIdx + 1, 0, fresh);
    setEndIdx((v) => v + 1);
    onChange(list);
  };

  const header = (
    <header className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800">
      <Music className="w-5 h-5 text-cyan-300 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <h2 className="text-white font-bold leading-tight">{heading}</h2>
        <p className="text-[11px] text-zinc-500 truncate">
          Étapes {start + 1}–{endIdx + 1} · {steps.length} note
          {steps.length > 1 ? "s" : ""}
        </p>
      </div>
      <button
        type="button"
        onClick={() => (playing ? stopAudio() : void playRiff())}
        disabled={steps.length === 0}
        className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
          playing
            ? "bg-amber-500 text-black hover:bg-amber-400"
            : "bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25"
        }`}
        title={playing ? "Arrêter la lecture" : "Écouter le riff (guitare MIDI)"}
      >
        {playing ? (
          <Square className="w-3.5 h-3.5" />
        ) : (
          <Play className="w-3.5 h-3.5" />
        )}
        {playing ? "Stop" : "Écouter"}
      </button>
      {!embedded && onClose && (
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
          title="Fermer (Échap)"
        >
          <X className="w-4 h-4" />
          Fermer
        </button>
      )}
    </header>
  );

  const body = (
    <div className={embedded ? "" : "flex-1 overflow-y-auto"}>
      <div className="p-4 flex flex-col gap-5">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
              {tab ? (
                <TabStaffView title={title} bpm={bpm} tab={tab} showMutes={false} />
              ) : (
                <p className="text-[11px] text-zinc-600">
                  Aucune note à afficher en tablature.
                </p>
              )}
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                Notes de l&apos;arpège
              </span>
              <button
                type="button"
                onClick={addStep}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Ajouter une note
              </button>
            </div>

            <div className="flex gap-3 overflow-x-auto pb-2">
              {steps.map((step, k) => {
                const isSingle = soundingNotes(step) <= 1;
                const p = primaryNote(step);
                return (
                  <div
                    key={step.id}
                    className="flex flex-col items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 p-2 w-44 flex-shrink-0"
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="text-[10px] text-zinc-500">#{k + 1}</span>
                      <span className="text-[10px] font-bold text-cyan-300">
                        {isSingle ? noteFull(p.string, p.fret) : `${pitchOf(p.string, p.fret)} (accord)`}
                      </span>
                    </div>

                    <div className="w-40">
                      <ChordShapeView shape={step} showMutes={false} />
                    </div>

                    {isSingle ? (
                      <>
                        <select
                          value={p.string}
                          onChange={(e) =>
                            updateNote(k, { string: Number(e.target.value), fret: p.fret })
                          }
                          className="w-full bg-zinc-800 border border-zinc-700 rounded-lg text-[11px] text-zinc-200 px-2 py-1 focus:outline-none focus:border-cyan-500/60 cursor-pointer"
                          title="Corde"
                        >
                          {STRINGS.map((name, s) => (
                            <option key={s} value={s}>
                              Corde {s + 1} · {name}
                            </option>
                          ))}
                        </select>
                        <div className="flex items-center gap-1 w-full">
                          <button
                            type="button"
                            onClick={() =>
                              updateNote(k, { string: p.string, fret: Math.max(0, p.fret - 1) })
                            }
                            className="w-8 h-8 rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors text-base font-bold"
                            title="Descendre d'une case"
                          >
                            −
                          </button>
                          <input
                            type="number"
                            min={0}
                            max={24}
                            value={p.fret}
                            onChange={(e) => {
                              const v = parseInt(e.target.value, 10);
                              if (!Number.isNaN(v))
                                updateNote(k, { string: p.string, fret: v });
                            }}
                            className="w-full h-8 rounded-md bg-zinc-950 border border-zinc-700 text-center text-sm text-cyan-300 font-semibold focus:outline-none focus:border-cyan-500/60"
                            title="Case"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              updateNote(k, { string: p.string, fret: Math.min(24, p.fret + 1) })
                            }
                            className="w-8 h-8 rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors text-base font-bold"
                            title="Monter d'une case"
                          >
                            +
                          </button>
                        </div>
                      </>
                    ) : (
                      <p className="text-[10px] text-zinc-500 italic text-center">
                        Accord plaqué ({soundingNotes(step)} notes) — éditez-le depuis la liste.
                      </p>
                    )}

                    <div className="flex items-center gap-1 mt-0.5">
                      <button
                        type="button"
                        onClick={() => move(k, -1)}
                        disabled={k === 0}
                        className="w-8 h-8 rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
                        title="Déplacer avant"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(k, 1)}
                        disabled={k === steps.length - 1}
                        className="w-8 h-8 rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center"
                        title="Déplacer après"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => duplicate(k)}
                        className="w-8 h-8 rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors flex items-center justify-center"
                        title="Dupliquer la note"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(k)}
                        className="w-8 h-8 rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors flex items-center justify-center"
                        title="Supprimer la note"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <p className="text-[11px] text-zinc-600">
              Chaque note = un diagramme à corde unique. Les modifications sont
              enregistrées immédiatement dans la séquence.
            </p>
          </div>
        </div>
  );

  if (embedded) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 flex flex-col overflow-hidden">
        {header}
        {body}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-stretch sm:items-center justify-center p-0 sm:p-6"
      onPointerDown={onClose}
    >
      <div
        className="bg-zinc-950 border border-zinc-700 rounded-none sm:rounded-2xl w-full max-w-6xl max-h-full flex flex-col overflow-hidden"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {header}
        {body}
      </div>
    </div>
  );
}
