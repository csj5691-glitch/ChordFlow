"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, Square, Play, RotateCcw } from "lucide-react";
import { renderSequence, beatsForShape, type SynthEvent } from "@/lib/chord-synth";
import { parseChordContent } from "@/lib/chord-parser";
import { decodeHtmlEntities } from "@/lib/ug-scraper";
import type { SavedChordShape } from "@/lib/types";
import ChordShapeView from "@/components/ChordShapeView";

interface ConductorProps {
  diagrams: SavedChordShape[];
  bpm: number;
  content: string;
  officialPlain?: string;
  officialSynced?: string;
  onClose: () => void;
}

function extractLyrics(content: string): { label: string; lines: string[] }[] {
  const sections = parseChordContent(decodeHtmlEntities(content));
  return sections
    .map((s) => ({
      label: s.label ?? "",
      lines: s.lines.map((l) => l.lyrics).filter(Boolean),
    }))
    .filter((s) => s.lines.length > 0);
}

function extractOfficialLyrics(synced?: string, plain?: string): string[] {
  if (synced) {
    const lines: string[] = [];
    for (const line of synced.split("\n")) {
      const m = line.match(/^\[(?:\d+:\d+\.?\d*)\]\s*(.*)/);
      if (m && m[1].trim()) lines.push(m[1].trim());
    }
    if (lines.length > 0) return lines;
  }
  return (plain || "")
    .split("\n")
    .map((l) => decodeHtmlEntities(l).trim())
    .filter(Boolean);
}

export default function Conductor({
  diagrams,
  bpm,
  content,
  officialPlain,
  officialSynced,
  onClose,
}: ConductorProps) {
  const events = useMemo(() => renderSequence(diagrams, bpm), [diagrams, bpm]);
  const lyricSections = useMemo(() => extractLyrics(content), [content]);
  const officialLines = useMemo(
    () => extractOfficialLyrics(officialSynced, officialPlain),
    [officialSynced, officialPlain]
  );
  const flatLyrics = useMemo(
    () =>
      officialLines.length > 0
        ? officialLines.map((text) => ({ label: "", text }))
        : lyricSections.flatMap((s) => s.lines.map((text) => ({ label: s.label, text }))),
    [officialLines, lyricSections]
  );
  const [playing, setPlaying] = useState(false);
  const [index, setIndex] = useState(0);
  const [lyricIndex, setLyricIndex] = useState(0);
  const ctxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (ctxRef.current && ctxRef.current.state === "running") {
      ctxRef.current.close().catch(() => {});
    }
    ctxRef.current = null;
    setPlaying(false);
  }, []);

  const playEvent = (
    ctx: AudioContext,
    ev: SynthEvent,
    master: GainNode,
    when: number
  ) => {
    const dur = Math.max(0.08, ev.duration);
    if (ev.silence || ev.notes.length === 0 || ev.notes[0] === 0) return;
    for (const freq of ev.notes) {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = freq;
      const gate = ctx.createGain();
      gate.gain.setValueAtTime(0, when);
      gate.gain.linearRampToValueAtTime(0.6, when + 0.02);
      gate.gain.setValueAtTime(0.6, when + Math.max(0.02, dur - 0.05));
      gate.gain.linearRampToValueAtTime(0, when + dur);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(2400, when);
      lp.frequency.linearRampToValueAtTime(700, when + dur);
      osc.connect(gate);
      gate.connect(lp);
      lp.connect(master);
      osc.start(when);
      osc.stop(when + dur + 0.05);
    }
  };

  const play = useCallback(() => {
    stop();
    if (events.length === 0) return;
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    ctxRef.current = ctx;
    const master = ctx.createGain();
    master.gain.value = 0.3;
    master.connect(ctx.destination);
    const now = ctx.currentTime + 0.1;
    for (const ev of events) playEvent(ctx, ev, master, now + ev.start);
    const totalMs = events.reduce((a, e) => a + e.duration, 0) * 1000;

    setIndex(0);
    setLyricIndex(0);
    const startedAt = performance.now() + 100;
    const tick = () => {
      const t = performance.now() - startedAt;
      let i = events.findIndex((e) => e.start * 1000 <= t && t < (e.start + e.duration) * 1000);
      if (i < 0) i = events.filter((e) => e.start * 1000 <= t).length - 1;
      setIndex(Math.max(0, i));
      if (flatLyrics.length > 0) {
        const li = Math.min(
          flatLyrics.length - 1,
          Math.max(0, Math.floor((t / totalMs) * flatLyrics.length))
        );
        setLyricIndex(li);
      }
      if (t >= totalMs) {
        setPlaying(false);
        return;
      }
      timerRef.current = window.setTimeout(tick, 40);
    };
    timerRef.current = window.setTimeout(tick, 40);
    setPlaying(true);
  }, [events, stop, flatLyrics.length]);

  useEffect(() => {
    const t = window.setTimeout(play, 50);
    return () => {
      window.clearTimeout(t);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = itemRefs.current[index];
    if (el && stripRef.current) {
      el.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  }, [index]);

  const totalBeat = diagrams.reduce((a, d) => a + (d.bar ? 0 : beatsForShape(d)), 0);
  const cur = events[index];
  const elapsed = cur ? cur.start : 0;
  const duration = events.reduce((a, e) => a + e.duration, 0);
  const pct = duration > 0 ? (elapsed / duration) * 100 : 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-bold text-white uppercase tracking-widest text-zinc-300">
            Chef d&apos;orchestre
          </h2>
          <span className="text-[11px] text-zinc-500 font-mono">
            {bpm} BPM · {totalBeat.toFixed(2)} temps · {duration.toFixed(1)} s
            {flatLyrics.length > 0 && <> · {flatLyrics.length} lignes de paroles</>}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {playing ? (
            <button
              onClick={stop}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-500 text-white hover:bg-red-400 transition-colors"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              onClick={play}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-500 text-black hover:bg-emerald-400 transition-colors"
              title="Relancer"
            >
              <Play className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={play}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
            title="Rejouer depuis le début"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              stop();
              onClose();
            }}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
            title="Fermer le chef d'orchestre"
          >
            <X className="w-3.5 h-3.5" />
            Fermer
          </button>
        </div>
      </div>

      <div className="absolute inset-0 top-14 overflow-hidden pointer-events-none">
        <div className="absolute -bottom-8 left-0 right-0 h-40 opacity-60">
          <div
            ref={stripRef}
            className="flex gap-2 px-4 overflow-x-auto pb-4 pt-3"
            style={{ scrollbarWidth: "none" }}
          >
            {events.map((ev, i) => {
              const active = i === index;
              const isSilence = ev.silence || ev.notes.length === 0 || ev.notes[0] === 0;
              return (
                <div
                  key={ev.id + i}
                  ref={(el) => {
                    itemRefs.current[i] = el;
                  }}
                  className={`w-28 flex-shrink-0 rounded-xl border transition-all duration-150 ${
                    active
                      ? "border-amber-400 shadow-[0_0_24px_rgba(251,191,36,0.5)] scale-105 bg-zinc-900"
                      : "border-zinc-800 bg-zinc-900/40 opacity-40"
                  }`}
                >
                  <div
                    className={`text-center text-[10px] font-bold py-1 truncate px-1 ${
                      isSilence ? "text-zinc-500" : active ? "text-amber-400" : "text-zinc-500"
                    }`}
                  >
                    {ev.label}
                  </div>
                  <div className="pointer-events-none">
                    <ChordShapeView shape={ev.shape} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 relative z-10 gap-6">
        {flatLyrics.length > 0 && (
          <div className="text-center max-w-3xl w-full">
            {lyricIndex > 0 && flatLyrics[lyricIndex - 1] && (
              <p className="text-lg text-zinc-600 mb-3 leading-relaxed">
                {flatLyrics[lyricIndex - 1].text}
              </p>
            )}
            <div className="min-h-16 flex flex-col items-center justify-center">
              {flatLyrics[lyricIndex]?.label && (
                <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-zinc-500 mb-1">
                  {flatLyrics[lyricIndex].label}
                </p>
              )}
              <p className="text-3xl sm:text-4xl font-bold text-white leading-tight drop-shadow-[0_2px_12px_rgba(251,191,36,0.35)] text-balance">
                {flatLyrics[lyricIndex]?.text}
              </p>
            </div>
            {lyricIndex < flatLyrics.length - 1 && (
              <p className="text-lg text-zinc-600 mt-3 leading-relaxed">
                {flatLyrics[lyricIndex + 1].text}
              </p>
            )}
          </div>
        )}

        {cur && (
          <div className="flex flex-col items-center gap-1.5 opacity-75">
            <p
              className={`text-xl font-black tracking-tight ${
                cur.silence || cur.notes[0] === 0 ? "text-zinc-500" : "text-amber-400"
              }`}
            >
              {cur.silence ? "Silence" : cur.label}
            </p>
            <div className="w-32">
              <ChordShapeView shape={cur.shape} />
            </div>
            <p className="text-[10px] text-zinc-500 font-mono">{cur.duration.toFixed(2)} s</p>
          </div>
        )}
        <div className="w-full max-w-xl">
          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 transition-all duration-150"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}