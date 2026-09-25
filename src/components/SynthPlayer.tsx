"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Square } from "lucide-react";
import { renderSequence, type SynthEvent, beatsForShape } from "@/lib/chord-synth";
import type { SavedChordShape } from "@/lib/types";

interface SynthPlayerProps {
  diagrams: SavedChordShape[];
  bpm: number;
}

export default function SynthPlayer({ diagrams, bpm }: SynthPlayerProps) {
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
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (ctxRef.current && ctxRef.current.state === "running") {
        ctxRef.current.close().catch(() => {});
      }
    };
  }, []);

  const playEvent = (
    ctx: AudioContext,
    ev: SynthEvent,
    master: GainNode,
    when: number
  ) => {
    const dur = Math.max(0.08, ev.duration);
    if (
      ev.silence ||
      ((ev.notes.length === 0 || ev.notes[0] === 0) &&
        !(ev.mutedNotes && ev.mutedNotes.length > 0))
    ) {
      return;
    }
    if (ev.notes.length > 0 && ev.notes[0] !== 0) {
    const saw = ctx.createOscillator();
    saw.type = "sawtooth";
    const osc2 = ctx.createOscillator();
    osc2.type = "triangle";
    const gate = ctx.createGain();
    gate.gain.setValueAtTime(0, when);
    gate.gain.linearRampToValueAtTime(0.9, when + 0.02);
    gate.gain.setValueAtTime(0.9, when + Math.max(0.02, dur - 0.05));
    gate.gain.linearRampToValueAtTime(0, when + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(2200, when);
    lp.frequency.linearRampToValueAtTime(600, when + dur);

    saw.frequency.value = ev.notes[0];
    osc2.frequency.value = ev.notes[0];
    ev.notes.slice(1).forEach((f) => {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      const lg = ctx.createGain();
      lg.gain.setValueAtTime(0.45, when);
      lg.gain.linearRampToValueAtTime(0.45, when + Math.max(0.02, dur - 0.05));
      lg.gain.linearRampToValueAtTime(0, when + dur);
      o.connect(lg);
      lg.connect(lp);
      o.start(when);
      o.stop(when + dur + 0.05);
    });

    saw.connect(gate);
    gate.connect(lp);
    lp.connect(master);
    osc2.connect(gate);
    saw.start(when);
    saw.stop(when + dur + 0.05);
    osc2.start(when);
    osc2.stop(when + dur + 0.05);
    }

    if (ev.mutedNotes && ev.mutedNotes.length > 0) {
      const mDur = Math.min(0.08, dur);
      for (const f of ev.mutedNotes) {
        const o = ctx.createOscillator();
        o.type = "triangle";
        o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(0.12, when + 0.01);
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
        idx++;
      }
      if (idx >= events.length || t >= totalMs) {
        setPlaying(false);
        setCurrentLabel(null);
        return;
      }
      timerRef.current = window.setTimeout(tick, 50);
    };
    timerRef.current = window.setTimeout(tick, 50);
    setPlaying(true);
  }, [diagrams, bpm, stop]);

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