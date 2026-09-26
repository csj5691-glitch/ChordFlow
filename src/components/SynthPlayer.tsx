"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Square } from "lucide-react";
import { renderSequence, type SynthEvent, beatsForShape } from "@/lib/chord-synth";
import type { SavedChordShape } from "@/lib/types";

interface SynthPlayerProps {
  diagrams: SavedChordShape[];
  bpm: number;
  onCurrentIndexChange?: (index: number | null) => void;
}

export default function SynthPlayer({ diagrams, bpm, onCurrentIndexChange }: SynthPlayerProps) {
  const [playing, setPlaying] = useState(false);
  const [currentLabel, setCurrentLabel] = useState<string | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);

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
    setCurrentLabel(null);
    onCurrentIndexChange?.(null);
  }, [onCurrentIndexChange]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (ctxRef.current && ctxRef.current.state === "running") {
        ctxRef.current.close().catch(() => {});
      }
      onCurrentIndexChange?.(null);
    };
  }, [onCurrentIndexChange]);

  const playEvent = (
    ctx: AudioContext,
    ev: SynthEvent,
    master: GainNode,
    when: number
  ) => {
    const dur = Math.max(0.12, ev.duration);
    if (
      ev.silence ||
      ((ev.notes.length === 0 || ev.notes[0] === 0) &&
        !(ev.mutedNotes && ev.mutedNotes.length > 0))
    ) {
      return;
    }
    if (ev.notes.length > 0 && ev.notes[0] !== 0) {
      // Dry acoustic-guitar pluck simulation:
      // fundamental (triangle, warm) + octave harmonic (sine, bright attack)
      // with fast exponential decay (no synth sustain).
      const fund = ctx.createOscillator();
      fund.type = "triangle";
      fund.frequency.value = ev.notes[0];

      const harm = ctx.createOscillator();
      harm.type = "sine";
      harm.frequency.value = ev.notes[0] * 2;

      const fundGain = ctx.createGain();
      fundGain.gain.setValueAtTime(0.7, when);
      fundGain.gain.exponentialRampToValueAtTime(0.001, when + dur);

      const harmGain = ctx.createGain();
      harmGain.gain.setValueAtTime(0.25, when);
      harmGain.gain.exponentialRampToValueAtTime(0.001, when + dur * 0.5);

      // Gentle low-pass for warmth, preserving guitar fundamentals (82-330Hz)
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(4000, when);
      lp.frequency.linearRampToValueAtTime(1200, when + dur);
      lp.Q.value = 1;

      fund.connect(fundGain);
      harm.connect(harmGain);
      fundGain.connect(lp);
      harmGain.connect(lp);
      lp.connect(master);
      fund.start(when);
      fund.stop(when + dur + 0.05);
      harm.start(when);
      harm.stop(when + dur * 0.5 + 0.02);

      ev.notes.slice(1).forEach((f) => {
        const o = ctx.createOscillator();
        o.type = "triangle";
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.3, when);
        g.gain.exponentialRampToValueAtTime(0.001, when + dur);
        o.connect(g);
        g.connect(master);
        o.start(when);
        o.stop(when + dur + 0.05);
      });
    }

    if (ev.mutedNotes && ev.mutedNotes.length > 0) {
      const mDur = Math.min(0.08, dur);
      for (const f of ev.mutedNotes) {
        const o = ctx.createOscillator();
        o.type = "triangle";
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(0.1, when + 0.005);
        g.gain.linearRampToValueAtTime(0, when + mDur);
        o.connect(g);
        g.connect(master);
        o.start(when);
        o.stop(when + mDur + 0.02);
      }
    }
  };

  const play = useCallback(async () => {
    stop();
    const events = renderSequence(diagrams, bpm);
    if (events.length === 0) return;

    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    ctxRef.current = ctx;
    const master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);

    const now = ctx.currentTime + 0.1;
    for (const ev of events) {
      playEvent(ctx, ev, master, now + ev.start);
    }
    const totalMs = events.reduce((a, e) => a + e.duration, 0) * 1000;

    let idx = 0;
    const startedAt = performance.now() + 100;
    const tick = () => {
      const t = performance.now() - startedAt;
      while (idx < events.length && t >= events[idx].start * 1000) {
        setCurrentLabel(events[idx].label);
        onCurrentIndexChange?.(idx);
        idx++;
      }
      if (idx >= events.length || t >= totalMs) {
        setPlaying(false);
        setCurrentLabel(null);
        onCurrentIndexChange?.(null);
        return;
      }
      timerRef.current = window.setTimeout(tick, 50);
    };
    timerRef.current = window.setTimeout(tick, 50);
    setPlaying(true);
  }, [diagrams, bpm, stop, onCurrentIndexChange]);

  const totalBeat = diagrams.reduce((a, d) => a + (d.bar ? 0 : beatsForShape(d)), 0);

  return (
    <div className="flex items-center gap-3">
      {playing ? (
        <button
          onClick={stop}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-500 text-white hover:bg-red-400 transition-colors"
          title="Arrêter la lecture"
        >
          <Square className="w-3.5 h-3.5" />
          Arrêter
        </button>
      ) : (
        <button
          onClick={() => play()}
          disabled={diagrams.length === 0}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-500 text-black hover:bg-emerald-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title={`Jouer la séquence (${bpm} BPM, ≈ ${((totalBeat * 60) / bpm).toFixed(1)} s)`}
        >
          <Play className="w-3.5 h-3.5" />
          Jouer le rythme
        </button>
      )}
      {playing && currentLabel && (
        <span className="text-xs font-semibold text-emerald-300 animate-pulse">
          En lecture : {currentLabel}
        </span>
      )}
    </div>
  );
}