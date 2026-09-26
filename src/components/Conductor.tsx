"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, Square, Play, RotateCcw } from "lucide-react";
import { renderSequence, beatsForShape, legatoStringName, measureInfoFromSignature, measureForBeat, beatInMeasure, type SynthEvent } from "@/lib/chord-synth";
import { parseChordContent } from "@/lib/chord-parser";
import { decodeHtmlEntities } from "@/lib/ug-scraper";
import type { SavedChordShape, SongTab } from "@/lib/types";
import ChordShapeView from "@/components/ChordShapeView";
import { BarGlyph } from "@/components/BarGlyph";

interface ConductorProps {
  diagrams: SavedChordShape[];
  bpm: number;
  timeSignature?: SongTab["timeSignature"];
  content: string;
  officialPlain?: string;
  officialSynced?: string;
  instrumentalUrl?: string | null;
  vocalsUrl?: string | null;
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

interface LyricLine {
  label: string;
  text: string;
  time: number | null;
}

function extractOfficialLyrics(synced?: string, plain?: string): LyricLine[] {
  if (synced) {
    const lines: LyricLine[] = [];
    for (const raw of synced.split("\n")) {
      const m = raw.match(/^\[(\d+):(\d+\.?\d*)\]\s*(.*)/);
      if (m && m[3].trim()) {
        const mins = parseInt(m[1], 10);
        const secs = parseFloat(m[2]);
        lines.push({ label: "", text: decodeHtmlEntities(m[3]).trim(), time: mins * 60 + secs });
      }
    }
    if (lines.length > 0) return lines;
  }
  return (plain || "")
    .split("\n")
    .map((l) => decodeHtmlEntities(l).trim())
    .filter(Boolean)
    .map((text) => ({ label: "", text, time: null }));
}

export default function Conductor({
  diagrams,
  bpm,
  timeSignature,
  content,
  officialPlain,
  officialSynced,
  instrumentalUrl,
  vocalsUrl,
  onClose,
}: ConductorProps) {
  const events = useMemo(() => renderSequence(diagrams, bpm), [diagrams, bpm]);
  const measureInfo = useMemo(
    () => measureInfoFromSignature(timeSignature),
    [timeSignature]
  );
  const lyricSections = useMemo(() => extractLyrics(content), [content]);
  const officialLines = useMemo(
    () => extractOfficialLyrics(officialSynced, officialPlain),
    [officialSynced, officialPlain]
  );
  const flatLyrics = useMemo(
    () =>
      officialLines.length > 0
        ? officialLines
        : lyricSections.flatMap((s) => s.lines.map((text) => ({ label: s.label, text, time: null as null }))),
    [officialLines, lyricSections]
  );
  const [playing, setPlaying] = useState(false);
  const [index, setIndex] = useState(0);
  const [lyricIndex, setLyricIndex] = useState(0);
  const [chordVolume, setChordVolume] = useState(1);
  const [instVolume, setInstVolume] = useState(1);
  const [vocalsVolume, setVocalsVolume] = useState(0.9);
  const [lyricOffset, setLyricOffset] = useState(0);
  const lyricOffsetRef = useRef(0);
  const changeLyricOffset = (delta: number) => {
    setLyricOffset((o) => {
      const next = Math.max(-30, Math.min(30, o + delta));
      lyricOffsetRef.current = next;
      return next;
    });
  };
  const chordVolRef = useRef(chordVolume);
  const chordMasterRef = useRef<GainNode | null>(null);
  const changeChordVolume = (v: number) => {
    setChordVolume(v);
    chordVolRef.current = v;
    if (chordMasterRef.current) {
      chordMasterRef.current.gain.setTargetAtTime(v, chordMasterRef.current.context.currentTime, 0.02);
    }
  };
  const instVolRef = useRef(instVolume);
  const changeInstVolume = (v: number) => {
    setInstVolume(v);
    instVolRef.current = v;
    if (instRef.current) instRef.current.volume = v;
  };
  const vocalsVolRef = useRef(vocalsVolume);
  const changeVocalsVolume = (v: number) => {
    setVocalsVolume(v);
    vocalsVolRef.current = v;
    if (vocalsRef.current) vocalsRef.current.volume = v;
  };
  const ctxRef = useRef<AudioContext | null>(null);
  const instRef = useRef<HTMLAudioElement | null>(null);
  const vocalsRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [stemStart, setStemStart] = useState<number | null>(null);
  const stemStartRef = useRef<number | null>(null);
  const usesAudio = useMemo(() => Boolean(instrumentalUrl || vocalsUrl), [instrumentalUrl, vocalsUrl]);
  const totalSequenceMs = useMemo(
    () => events.reduce((a, e) => a + e.duration, 0) * 1000,
    [events]
  );
  const totalMs = totalSequenceMs;

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (ctxRef.current && ctxRef.current.state === "running") {
      ctxRef.current.close().catch(() => {});
    }
    ctxRef.current = null;
    chordMasterRef.current = null;
    if (instRef.current) instRef.current.pause();
    if (vocalsRef.current) vocalsRef.current.pause();
    setPlaying(false);
  }, []);

  const detectFirstSound = async (url: string) => {
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    const Ctor =
      window.OfflineAudioContext ??
      (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
        .webkitOfflineAudioContext;
    if (!Ctor) return null;
    try {
      const tempo = new Ctor(1, 1, 44100);
      const decoded = await tempo.decodeAudioData(buf);
      const ch = decoded.getChannelData(0);
      const step = Math.floor(decoded.sampleRate * 0.05);
      let maxRms = 0;
      const rmsArr: number[] = [];
      for (let i = 0; i < ch.length; i += step) {
        let sum = 0;
        const n = Math.min(step, ch.length - i);
        for (let j = i; j < i + n; j++) sum += ch[j] * ch[j];
        const rms = Math.sqrt(sum / n);
        rmsArr.push(rms);
        if (rms > maxRms) maxRms = rms;
      }
      const thresh = Math.max(0.004, maxRms * 0.08);
      let detected = 0;
      for (let i = 0; i < rmsArr.length; i++) {
        if (rmsArr[i] > thresh) {
          detected = (i * step) / decoded.sampleRate;
          break;
        }
      }
      return detected;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    let cancelled = false;
    const refUrl = instrumentalUrl ?? vocalsUrl;
    if (refUrl) {
      void detectFirstSound(refUrl).then((d) => {
        if (cancelled) return;
        if (d === null) {
          setStemStart(null);
          stemStartRef.current = null;
        } else {
          setStemStart(d);
          stemStartRef.current = d;
        }
      });
    } else {
      stemStartRef.current = null;
      void Promise.resolve().then(() => {
        if (!cancelled) setStemStart(null);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [instrumentalUrl, vocalsUrl]);

  const playEvent = (
    ctx: AudioContext,
    ev: SynthEvent,
    master: GainNode,
    when: number
  ) => {
    const dur = Math.max(0.2, ev.duration);
    if (
      ev.silence ||
      ((ev.notes.length === 0 || ev.notes[0] === 0) &&
        !(ev.mutedNotes && ev.mutedNotes.length > 0))
    ) {
      return;
    }
    if (ev.notes.length > 0 && ev.notes[0] !== 0) {
    for (const freq of ev.notes) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const gate = ctx.createGain();
      gate.gain.setValueAtTime(0.8, when);
      gate.gain.linearRampToValueAtTime(0, when + dur);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(6000, when);
      lp.frequency.linearRampToValueAtTime(2000, when + dur);
      lp.Q.value = 0.5;
      osc.connect(gate);
      gate.connect(lp);
      lp.connect(master);
      osc.start(when);
      osc.stop(when + dur + 0.1);
    }
    }

    if (ev.mutedNotes && ev.mutedNotes.length > 0) {
      const mDur = Math.min(0.2, dur);
      for (const f of ev.mutedNotes) {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.5, when);
        g.gain.linearRampToValueAtTime(0, when + mDur);
        osc.connect(g);
        g.connect(master);
        osc.start(when);
        osc.stop(when + mDur + 0.1);
      }
    }
  };

  const play = useCallback(() => {
    stop();
    if (events.length === 0) return;

    setIndex(0);
    setLyricIndex(0);

    const pickPrimary = (): HTMLAudioElement | null => {
      if (instRef.current) return instRef.current;
      if (vocalsRef.current) return vocalsRef.current;
      return null;
    };
    const pickVocals = (): HTMLAudioElement | null => vocalsRef.current;
    const primary = pickPrimary();
    const firstVocals = pickVocals();

    if (primary) {
      primary.currentTime = 0;
      void primary.play().catch(() => {});
      if (firstVocals !== null && firstVocals !== primary) {
        firstVocals.currentTime = 0;
        void firstVocals.play().catch(() => {});
      }
    }

    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    ctxRef.current = ctx;
const master = ctx.createGain();
     master.gain.value = 2.0;
    master.connect(ctx.destination);
    chordMasterRef.current = master;
    const now = ctx.currentTime + 0.1;
    for (const ev of events) playEvent(ctx, ev, master, now + ev.start);

    const startedAt = performance.now() + 100;
    const tick = () => {
      const t = performance.now() - startedAt;
      let i = events.findIndex((e) => e.start * 1000 <= t && t < (e.start + e.duration) * 1000);
      if (i < 0) i = events.filter((e) => e.start * 1000 <= t).length - 1;
      setIndex(Math.max(0, i));
      if (flatLyrics.length > 0) {
        const lyricClockMs = vocalsRef.current ? vocalsRef.current.currentTime * 1000 : t;
        const vs = stemStartRef.current ?? 0;
        const hasTimes = flatLyrics[0].time !== null;
        let li = 0;
        if (hasTimes) {
          const firstTime = flatLyrics[0].time ?? 0;
          const ref =
            lyricClockMs + lyricOffsetRef.current * 1000 + (firstTime - vs) * 1000;
          for (let k = 0; k < flatLyrics.length; k++) {
            const tm = flatLyrics[k].time;
            if (tm !== null && tm * 1000 <= ref) li = k;
          }
        } else {
          const start = vs * 1000;
          const clock = lyricClockMs + lyricOffsetRef.current * 1000;
          if (clock >= start) {
            const span = Math.max(1, totalMs - start);
            li = Math.min(
              flatLyrics.length - 1,
              Math.max(0, Math.floor(((clock - start) / span) * flatLyrics.length))
            );
          }
        }
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
  }, [events, stop, totalMs, flatLyrics]);

  const playedRef = useRef(false);
  useEffect(() => {
    if (playedRef.current || events.length === 0) return;
    playedRef.current = true;
    const t = window.setTimeout(play, 50);
    return () => {
      window.clearTimeout(t);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  useEffect(() => {
    const el = itemRefs.current[index];
    if (el && stripRef.current) {
      el.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  }, [index]);

  const totalBeat = diagrams.reduce((a, d) => a + (d.bar ? 0 : beatsForShape(d)), 0);
  const cur = events[index];
  const dur2 = totalMs / 1000;
  const pct = cur ? (cur.start / dur2) * 100 : 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-bold text-white uppercase tracking-widest text-zinc-300">
            Chef d&apos;orchestre
          </h2>
          <span className="text-[11px] text-zinc-500 font-mono">
            {usesAudio ? `${bpm} BPM · stems` : `${bpm} BPM`} · {totalBeat.toFixed(2)} temps ·{" "}
            {dur2.toFixed(1)} s
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
              const isSilence =
                ev.silence ||
                ((ev.notes.length === 0 || ev.notes[0] === 0) &&
                  !(ev.mutedNotes && ev.mutedNotes.length > 0));
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

      <div className="flex-1 flex flex-col items-center justify-center px-6 relative z-10 gap-6 pb-16">
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
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-2 flex-wrap justify-center">
              {cur.barKind && (
                <BarGlyph
                  kind={cur.barKind}
                  className="text-amber-500 w-8 h-7"
                />
              )}
              {cur.sectionLabel && (
                <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-300/80 bg-amber-400/10 border border-amber-400/30 rounded-full px-2.5 py-0.5">
                  {cur.sectionLabel}
                </span>
              )}
              <span className="text-[11px] font-mono text-zinc-400 bg-zinc-800/60 border border-zinc-700/60 rounded-full px-2.5 py-0.5">
                Mesure {measureForBeat((cur.start * bpm) / 60, measureInfo) + 1}
                {" · temps "}
                {Math.max(1, Math.round(beatInMeasure((cur.start * bpm) / 60, measureInfo)))}
                <span className="text-zinc-600">/{measureInfo.top}</span>
                <span className="text-zinc-600"> · {measureInfo.top}/{measureInfo.bottom}</span>
              </span>
            </div>
            <p
              className={`text-2xl font-black tracking-tight ${
                cur.silence ||
                (cur.notes[0] === 0 &&
                  !(cur.mutedNotes && cur.mutedNotes.length > 0))
                  ? "text-zinc-500"
                  : "text-amber-400"
              }`}
            >
              {cur.silence ? "Silence" : cur.label}
            </p>
            {cur.legato && cur.legato.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap justify-center">
                {cur.legato.map((lg) => (
                  <span
                    key={lg.string}
                    className="text-[11px] font-mono text-sky-300 bg-sky-500/10 border border-sky-500/30 rounded-full px-2.5 py-0.5"
                  >
                    {lg.kind === "H" ? "H Hammer-on" : lg.kind === "P" ? "P Pull-off" : "Liaison"}{" "}
                    · corde {legatoStringName(lg.string)}
                  </span>
                ))}
              </div>
            )}
            <div className="w-72 sm:w-80 md:w-96">
              <ChordShapeView shape={cur.shape} />
            </div>
            <p className="text-[11px] text-zinc-500 font-mono">{cur.duration.toFixed(2)} s</p>
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
        {usesAudio && (
          <div className="flex flex-col gap-1.5 text-xs text-zinc-400">
            <div className="flex items-center gap-2">
              <span className="text-zinc-500 w-20">Instrument</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={instVolume}
                onChange={(e) => changeInstVolume(parseFloat(e.target.value))}
                className="w-32 h-1 accent-amber-500 cursor-pointer"
                title="Volume du stem instrumental"
              />
              <span className="text-[10px] text-zinc-500 font-mono w-9">
                {Math.round(instVolume * 100)}%
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-zinc-500 w-20">Chant</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={vocalsVolume}
                onChange={(e) => changeVocalsVolume(parseFloat(e.target.value))}
                className="w-32 h-1 accent-amber-500 cursor-pointer"
                title="Volume du stem vocal"
              />
              <span className="text-[10px] text-zinc-500 font-mono w-9">
                {Math.round(vocalsVolume * 100)}%
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-zinc-500 w-20">Accords</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={chordVolume}
                onChange={(e) => changeChordVolume(parseFloat(e.target.value))}
                className="w-32 h-1 accent-amber-500 cursor-pointer"
                title="Volume des accords synthétisés par-dessus le stem"
              />
              <span className="text-[10px] text-zinc-500 font-mono w-9">
                {Math.round(chordVolume * 100)}%
              </span>
            </div>
          </div>
        )}
        {usesAudio && (
          <div className="flex flex-col gap-1 text-xs text-zinc-400">
            <span className="text-zinc-500">Paroles</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => changeLyricOffset(-5)}
                className="w-9 h-7 rounded-md bg-zinc-800 hover:bg-zinc-700 font-bold text-zinc-300 transition-colors"
                title="-5 s"
              >
                -5
              </button>
              <button
                onClick={() => changeLyricOffset(-1)}
                className="w-9 h-7 rounded-md bg-zinc-800 hover:bg-zinc-700 font-bold text-zinc-300 transition-colors"
                title="-1 s"
              >
                -1
              </button>
              <span className="font-mono text-amber-400 w-16 text-center">
                {lyricOffset >= 0 ? "+" : ""}
                {lyricOffset.toFixed(1)} s
              </span>
              <button
                onClick={() => changeLyricOffset(1)}
                className="w-9 h-7 rounded-md bg-zinc-800 hover:bg-zinc-700 font-bold text-zinc-300 transition-colors"
                title="+1 s"
              >
                +1
              </button>
              <button
                onClick={() => changeLyricOffset(5)}
                className="w-9 h-7 rounded-md bg-zinc-800 hover:bg-zinc-700 font-bold text-zinc-300 transition-colors"
                title="+5 s"
              >
                +5
              </button>
              {lyricOffset !== 0 && (
                <button
                  onClick={() => {
                    lyricOffsetRef.current = 0;
                    setLyricOffset(0);
                  }}
                  className="text-zinc-500 hover:text-zinc-300 underline transition-colors"
                >
                  Reset
                </button>
              )}
            </div>
            {stemStart === null && (instrumentalUrl || vocalsUrl) ? (
              <span className="text-[10px] text-zinc-500 animate-pulse">
                Détection du premier son de la piste…
              </span>
            ) : (
              <span className="text-[10px] text-zinc-600">
                {stemStart !== null && stemStart > 0
                  ? `1re parole à ${stemStart.toFixed(2)} s (début sonore de la piste)`
                  : "1re parole au début de la lecture"}
              </span>
            )}
          </div>
        )}
      </div>
      {instrumentalUrl && (
        <audio
          ref={instRef}
          src={instrumentalUrl}
          preload="auto"
          className="hidden"
        />
      )}
      {vocalsUrl && (
        <audio
          ref={vocalsRef}
          src={vocalsUrl}
          preload="auto"
          className="hidden"
        />
      )}
    </div>
  );
}