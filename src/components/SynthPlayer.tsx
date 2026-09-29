"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Square, Pause } from "lucide-react";
import { renderSequence, type SynthEvent, beatsForShape } from "@/lib/chord-synth";
import { playEngineEvent, sf2Resume, sf2StopAll, getMasterFilter, setMasterFilter } from "@/lib/sf2-bank";
import type { SavedChordShape } from "@/lib/types";

interface SynthPlayerProps {
  diagrams: SavedChordShape[];
  bpm: number;
  program?: number | null;
  percussion?: boolean;
  onCurrentIndexChange?: (index: number | null) => void;
}

export default function SynthPlayer({ diagrams, bpm, program, percussion, onCurrentIndexChange }: SynthPlayerProps) {
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [currentLabel, setCurrentLabel] = useState<string | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const posRef = useRef(0);
  const [filterHz, setFilterHz] = useState(getMasterFilter);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const closeCtx = useCallback(() => {
    if (ctxRef.current && ctxRef.current.state === "running") {
      ctxRef.current.close().catch(() => {});
    }
    ctxRef.current = null;
  }, []);

  const resetUi = useCallback(() => {
    setPlaying(false);
    setPaused(false);
    setCurrentLabel(null);
    onCurrentIndexChange?.(null);
  }, [onCurrentIndexChange]);

  const stop = useCallback(() => {
    sf2StopAll();
    clearTimer();
    closeCtx();
    posRef.current = 0;
    resetUi();
  }, [clearTimer, closeCtx, resetUi]);

  useEffect(() => {
    return () => {
      sf2StopAll();
      clearTimer();
      closeCtx();
      onCurrentIndexChange?.(null);
    };
  }, [clearTimer, closeCtx, onCurrentIndexChange]);

  const playEvent = useCallback(
    (ctx: AudioContext, ev: SynthEvent, master: GainNode, when: number) => {
      playEngineEvent(ctx, ev, master, when, program, { strum: "off", percussion, gain: 1 });
    },
    [program, percussion]
  );

  const totalMs = useCallback(
    () => renderSequence(diagrams, bpm).reduce((a, e) => a + e.duration, 0) * 1000,
    [diagrams, bpm]
  );

  // Drives the label/highlight cursor. `startedAtRef` is set by play/resume so
  // the elapsed time continues across a pause.
  const scheduleTicker = useCallback(
    (events: SynthEvent[]) => {
      const endMs = events.reduce((a, e) => a + e.duration, 0) * 1000;
      let idx = 0;
      const tick = () => {
        const t = performance.now() - startedAtRef.current;
        while (idx < events.length && t >= events[idx].start * 1000) {
          setCurrentLabel(events[idx].label);
          onCurrentIndexChange?.(idx);
          idx++;
        }
        if (idx >= events.length || t >= endMs) {
          posRef.current = 0;
          setPlaying(false);
          setPaused(false);
          setCurrentLabel(null);
          onCurrentIndexChange?.(null);
          return;
        }
        timerRef.current = window.setTimeout(tick, 50);
      };
      timerRef.current = window.setTimeout(tick, 50);
      setPlaying(true);
      setPaused(false);
    },
    [onCurrentIndexChange]
  );

  const start = useCallback(
    (events: SynthEvent[], fromPosMs: number) => {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      sf2Resume();
      const ctx = new Ctor();
      ctxRef.current = ctx;
      const master = ctx.createGain();
      master.gain.value = 1.0;
      master.connect(ctx.destination);

      const now = ctx.currentTime + 0.1;
      const fromSec = fromPosMs / 1000;
      for (const ev of events) {
        if ((ev.start + ev.duration) * 1000 <= fromPosMs) continue;
        playEvent(ctx, ev, master, now + Math.max(0, ev.start - fromSec));
      }
      startedAtRef.current = performance.now() + 100 - fromPosMs;
      scheduleTicker(events);
    },
    [playEvent, scheduleTicker]
  );

  const play = useCallback(() => {
    stop();
    const events = renderSequence(diagrams, bpm);
    if (events.length === 0) return;
    start(events, 0);
  }, [stop, start, diagrams, bpm]);

  const pause = useCallback(() => {
    if (!playing) return;
    posRef.current = Math.max(0, performance.now() - startedAtRef.current);
    sf2StopAll();
    clearTimer();
    closeCtx();
    setPaused(true);
    setPlaying(false);
  }, [playing, clearTimer, closeCtx]);

  const resume = useCallback(() => {
    const events = renderSequence(diagrams, bpm);
    const pos = posRef.current;
    if (events.length === 0 || pos >= totalMs()) {
      resetUi();
      return;
    }
    start(events, pos);
  }, [start, totalMs, resetUi, diagrams, bpm]);

  const totalBeat = diagrams.reduce((a, d) => a + (d.bar ? 0 : beatsForShape(d)), 0);

  return (
    <div className="flex items-center gap-3">
      {playing ? (
        <>
          <button
            onClick={pause}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-500 text-black hover:bg-amber-400 transition-colors"
            title="Mettre en pause"
          >
            <Pause className="w-3.5 h-3.5" />
            Pause
          </button>
          <button
            onClick={stop}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-500 text-white hover:bg-red-400 transition-colors"
            title="Arrêter la lecture"
          >
            <Square className="w-3.5 h-3.5" />
            Arrêter
          </button>
        </>
      ) : (
        <button
          onClick={paused ? resume : play}
          disabled={diagrams.length === 0}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-500 text-black hover:bg-emerald-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title={
            paused
              ? "Reprendre la lecture"
              : `Jouer la séquence (${bpm} BPM, ≈ ${((totalBeat * 60) / bpm).toFixed(1)} s)`
          }
        >
          <Play className="w-3.5 h-3.5" />
          {paused ? "Reprendre" : "Jouer le rythme"}
        </button>
      )}
      {paused ? (
        <span className="text-xs font-semibold text-amber-300">
          En pause : {currentLabel ?? "…"}
        </span>
      ) : (
        playing &&
        currentLabel && (
          <span className="text-xs font-semibold text-emerald-300 animate-pulse">
            En lecture : {currentLabel}
          </span>
        )
      )}
      <label className="flex items-center gap-1 text-[11px] text-zinc-400" title="Adoucir les sons MIDI (filtre passe-bas)">
        Doux
        <input
          type="range"
          min={200}
          max={8000}
          step={50}
          value={filterHz}
          onChange={(e) => {
            const v = Number(e.target.value);
            setMasterFilter(v);
            setFilterHz(v);
          }}
          className="w-20 h-1 accent-amber-500 cursor-pointer"
        />
        <span className="w-8 text-right font-mono">{filterHz}</span>
      </label>
    </div>
  );
}