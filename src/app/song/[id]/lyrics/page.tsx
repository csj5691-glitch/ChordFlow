"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { use, useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Upload, Save, Music2, Play, Pause } from "lucide-react";
import { useSharedSong } from "@/lib/use-shared-song";
import { SongTab } from "@/lib/types";
import {
  parseLyrics,
  toLRC,
  toSRT,
  toVTT,
  toASS,
} from "@/lib/lyrics";

function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.round((t - Math.floor(t)) * 100);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function parseTime(str: string): number {
  const m = str.match(/^(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?$/);
  if (!m) return 0;
  const mm = parseInt(m[1], 10);
  const ss = parseInt(m[2], 10);
  let frac = 0;
  if (m[3]) {
    const f = m[3];
    frac = f.length === 3 ? parseInt(f, 10) / 1000 : parseInt(f, 10) / 100;
  }
  return mm * 60 + ss + frac;
}

export default function LyricsEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { current: song, loading, upsert } = useSharedSong(id);

  const [lyricsText, setLyricsText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [syncMode, setSyncMode] = useState(false);
  const [syncPoints, setSyncPoints] = useState<{ audio: number; lyric: number }[]>([]);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const waveformRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (song) {
    // eslint-disable-next-line react-hooks/set-state-in-effect
      setDirty(false);
    }
  }, [song]);

  const lines = useMemo(() => parseLyrics(lyricsText), [lyricsText]);

  const duration = useMemo(() => {
    if (lines.length === 0) return 60;
    return Math.max(60, lines[lines.length - 1].time + 8);
  }, [lines]);
  // Dessin de la waveform audio pour caler les paroles au ms pres
  useEffect(() => {
    const canvas = waveformRef.current;
    if (!canvas || !audioBuffer) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#18181b";
    ctx.fillRect(0, 0, w, h);
    const data = audioBuffer.getChannelData(0);
    const step = Math.ceil(data.length / w);
    const mid = h / 2;
    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      let min = 1, max = -1;
      for (let j = 0; j < step; j++) {
        const v = data[x * step + j] || 0;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      ctx.moveTo(x, mid + min * mid);
      ctx.lineTo(x, mid + max * mid);
    }
    ctx.stroke();
    const pct = time / audioBuffer.duration;
    ctx.strokeStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(pct * w, 0);
    ctx.lineTo(pct * w, h);
    ctx.stroke();
  }, [audioBuffer, time]);

  // Lecture auto (temps lineaire) pour l'apercu karaoke
  // Lecture auto (temps lineaire) pour l'apercu karaoke
  useEffect(() => {
    if (!playing) {
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }
    const startOffset = time;
    const startTime = Date.now();
    timerRef.current = window.setInterval(() => {
      const t = startOffset + (Date.now() - startTime) / 1000;
      if (t >= duration) {
        setPlaying(false);
        setTime(duration);
      } else {
        setTime(t);
      }
    }, 50);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, duration]);

  const currentIndex = useMemo(() => {
    let idx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].time <= time) idx = i;
      else break;
    }
    return idx;
  }, [lines, time]);

  const handleLoadAudio = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const buf = await ctx.decodeAudioData(reader.result as ArrayBuffer);
        setAudioBuffer(buf);
      } catch (err) {
        console.error('Decodage audio echoue', err);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  }, []);
  const handleImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      const parsed = parseLyrics(text);
      if (parsed.length > 0) {
        setLyricsText(toLRC(parsed));
      } else {
        setLyricsText(text);
      }
      setDirty(true);
    };
    reader.readAsText(file);
    e.target.value = "";
  }, []);

  const handleExport = useCallback((format: "lrc" | "srt" | "vtt" | "ass") => {
    const parsed = parseLyrics(lyricsText);
    let content = "";
    const ext = format;
    let mime = "text/plain";
    if (format === "lrc") { content = toLRC(parsed); mime = "text/plain"; }
    else if (format === "srt") { content = toSRT(parsed); mime = "text/srt"; }
    else if (format === "vtt") { content = toVTT(parsed); mime = "text/vtt"; }
    else if (format === "ass") { content = toASS(parsed, song?.title || "ChordFlow"); mime = "text/x-ssa"; }
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(song?.title || "lyrics").replace(/[^a-z0-9]/gi, "_")}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }, [lyricsText, song?.title]);

  const handleSave = useCallback(async () => {
    if (!song) return;
    const updated: SongTab = { ...song, officialSynced: lyricsText.trim() };
    await upsert(updated);
    setDirty(false);
  }, [song, lyricsText, upsert]);

  const updateLine = useCallback((idx: number, field: "time" | "text", value: string) => {
    const parsed = parseLyrics(lyricsText);
    if (idx < 0 || idx >= parsed.length) return;
    if (field === "time") {
      parsed[idx].time = parseTime(value);
    } else {
      parsed[idx].text = value;
    }
    setLyricsText(toLRC(parsed));
    setDirty(true);
  }, [lyricsText]);

  const removeLine = useCallback((idx: number) => {
    const parsed = parseLyrics(lyricsText);
    parsed.splice(idx, 1);
    setLyricsText(toLRC(parsed));
    setDirty(true);
  }, [lyricsText]);

  const splitLine = useCallback((idx: number) => {
    const parsed = parseLyrics(lyricsText);
    if (idx < 0 || idx >= parsed.length) return;
    const line = parsed[idx];
    const words = line.text.trim().split(/\s+/);
    if (words.length < 2) return;
    const mid = Math.ceil(words.length / 2);
    const first = words.slice(0, mid).join(" ");
    const second = words.slice(mid).join(" ");
    const nextTime =
      idx + 1 < parsed.length ? parsed[idx + 1].time : line.time + 2;
    const splitTime = (line.time + nextTime) / 2;
    parsed[idx].text = first;
    parsed.splice(idx + 1, 0, { time: splitTime, text: second });
    setLyricsText(toLRC(parsed));
    setDirty(true);
  }, [lyricsText]);

  const mergeLine = useCallback((idx: number) => {
    const parsed = parseLyrics(lyricsText);
    if (idx < 0 || idx >= parsed.length - 1) return;
    parsed[idx].text = `${parsed[idx].text} ${parsed[idx + 1].text}`.trim();
    parsed.splice(idx + 1, 1);
    setLyricsText(toLRC(parsed));
    setDirty(true);
  }, [lyricsText]);

  const addLine = useCallback(() => {
    const parsed = parseLyrics(lyricsText);
    const lastTime = parsed.length > 0 ? parsed[parsed.length - 1].time + 2 : 0;
    parsed.push({ time: lastTime, text: "" });
    setLyricsText(toLRC(parsed));
    setDirty(true);
  }, [lyricsText]);

  // --- Synchronisation par deux points ---
  const markSyncPoint = useCallback(
    (lyricTime: number) => {
      setSyncPoints((prev) => {
        if (prev.length >= 2) return [{ audio: time, lyric: lyricTime }];
        return [...prev, { audio: time, lyric: lyricTime }];
      });
    },
    [time]
  );

  const applySync = useCallback(() => {
    if (syncPoints.length < 2) return;
    const [p1, p2] = syncPoints;
    const dLyric = p2.lyric - p1.lyric;
    if (Math.abs(dLyric) < 0.001) return; // evite division par zero
    const scale = (p2.audio - p1.audio) / dLyric;
    const offset = p1.audio - scale * p1.lyric;
    const parsed = parseLyrics(lyricsText);
    const transformed = parsed.map((l) => ({
      time: Math.max(0, scale * l.time + offset),
      text: l.text,
    }));
    setLyricsText(toLRC(transformed));
    setDirty(true);
    setSyncMode(false);
    setSyncPoints([]);
  }, [syncPoints, lyricsText]);

  const cancelSync = useCallback(() => {
    setSyncMode(false);
    setSyncPoints([]);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-zinc-500">Chargement…</p>
      </div>
    );
  }
  if (!song) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-zinc-500 text-lg">Chanson introuvable</p>
        <button onClick={() => router.push("/")} className="text-amber-400 hover:text-amber-300">
          Retour
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-black text-zinc-200">
      <header className="sticky top-0 z-10 bg-black/80 backdrop-blur-lg border-b border-zinc-800/50">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <button onClick={() => router.push(`/song/${id}`)} className="p-2 hover:bg-zinc-800 rounded-lg">
            <ArrowLeft className="w-5 h-5 text-zinc-400" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-white truncate">Paroles synchronisées</h1>
            <p className="text-sm text-zinc-400 truncate">{song.title} — {song.artist}</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".lrc,.srt,.vtt,.ass,.ssa,.txt"
              className="hidden"
              onChange={handleImport}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
            >
              <Upload className="w-3.5 h-3.5" />
              Importer
            </button>
            <select
              defaultValue=""
              onChange={(e) => {
                const f = e.target.value as "lrc" | "srt" | "vtt" | "ass";
                if (f) handleExport(f);
                e.target.value = "";
              }}
              className="text-xs font-medium px-3 py-1.5 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700 cursor-pointer focus:outline-none focus:border-amber-500/60"
            >
              <option value="" disabled>
                Exporter…
              </option>
              <option value="lrc">LRC</option>
              <option value="srt">SRT</option>
              <option value="vtt">VTT</option>
              <option value="ass">ASS</option>
            </select>
            <button
              onClick={handleSave}
              disabled={!dirty}
              className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${
                dirty
                  ? "bg-amber-500 text-black hover:bg-amber-400"
                  : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
              }`}
            >
              <Save className="w-3.5 h-3.5" />
              Enregistrer
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6 flex flex-col gap-6">
        {/* Forme d'onde audio */}
        <section className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-zinc-300 flex items-center gap-2">
              Forme d&apos;onde
            </h2>
            <div className="flex items-center gap-2">
              <input
                ref={audioInputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={handleLoadAudio}
              />
              <button
                onClick={() => audioInputRef.current?.click()}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
              >
                Charger audio
              </button>
              {audioBuffer && (
                <span className="text-[11px] text-zinc-500 font-mono">
                  {audioBuffer.duration.toFixed(1)} s
                </span>
              )}
            </div>
          </div>
          {audioBuffer ? (
            <canvas
              ref={waveformRef}
              className="w-full h-24 rounded-lg cursor-pointer"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const pct = (e.clientX - rect.left) / rect.width;
                setTime(Math.max(0, Math.min(audioBuffer.duration, pct * audioBuffer.duration)));
              }}
            />
          ) : (
            <p className="text-xs text-zinc-600 text-center py-6">
              Charge un fichier audio pour afficher la forme d&apos;onde et caler les paroles.
            </p>
          )}
        </section>
        {/* Aperçu karaoké */}
        <section className="flex flex-col gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-zinc-300 flex items-center gap-2">
              <Music2 className="w-4 h-4 text-amber-400" />
              Aperçu karaoké
            </h2>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={duration}
                step={0.1}
                value={time}
                onChange={(e) => setTime(parseFloat(e.target.value))}
                className="w-48 accent-amber-500"
              />
              <button
                onClick={() => setPlaying((p) => !p)}
                className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
              >
                {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </button>
              <span className="font-mono text-xs text-zinc-500 w-12 text-right">
                {formatTime(time)}
              </span>
            </div>
          </div>
          <div className="min-h-24 flex flex-col items-center justify-center gap-2 text-center">
            {currentIndex > 0 && lines[currentIndex - 1] && (
              <p className="text-base text-zinc-600 leading-relaxed">
                {lines[currentIndex - 1].text}
              </p>
            )}
            <p className="text-2xl font-bold text-white leading-tight">
              {currentIndex >= 0 ? lines[currentIndex].text : "—"}
            </p>
            {currentIndex < lines.length - 1 && lines[currentIndex + 1] && (
              <p className="text-base text-zinc-600 leading-relaxed">
                {lines[currentIndex + 1].text}
              </p>
            )}
          </div>
        </section>

        {/* Éditeur */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-zinc-300">
              Paroles synchronisées ({lines.length} lignes)
            </h2>
            <button
              onClick={addLine}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
            >
              + Ligne
            </button>
          </div>
          <div className="flex items-center gap-2 flex-wrap rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
            <button
              onClick={() => {
                if (syncMode) cancelSync();
                else {
                  setSyncMode(true);
                  setSyncPoints([]);
                }
              }}
              className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${
                syncMode
                  ? "bg-amber-500 text-black hover:bg-amber-400"
                  : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
              }`}
            >
              {syncMode ? "Annuler la synchro" : "Synchroniser (2 points)"}
            </button>
            {syncMode && (
              <>
                <span className="text-[11px] text-zinc-500">
                  Naviguez avec le curseur, puis cliquez Marquer sur deux lignes.
                </span>
                {syncPoints.map((p, i) => (
                  <span key={i} className="text-[11px] font-mono text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-full px-2.5 py-1">
                    Point {i + 1} : audio {formatTime(p.audio)} vers parole {formatTime(p.lyric)}
                  </span>
                ))}
                {syncPoints.length === 2 && (
                  <button
                    onClick={applySync}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-emerald-500 text-black hover:bg-emerald-400 transition-colors"
                  >
                    Appliquer
                  </button>
                )}
              </>
            )}
          </div>
          <div className="flex flex-col gap-2 max-h-[50vh] overflow-y-auto">
            {lines.map((l, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  value={formatTime(l.time)}
                  onChange={(e) => updateLine(i, "time", e.target.value)}
                  className="w-20 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1 font-mono text-xs text-amber-400 focus:outline-none focus:border-amber-500/60"
                />
                <input
                  type="text"
                  value={l.text}
                  onChange={(e) => updateLine(i, "text", e.target.value)}
                  className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1 text-sm text-zinc-200 focus:outline-none focus:border-amber-500/60"
                />
                {syncMode && (
                  <button
                    onClick={() => markSyncPoint(l.time)}
                    className="px-2 py-1 rounded-lg bg-amber-500/20 text-amber-300 text-[10px] font-semibold hover:bg-amber-500/30 transition-colors whitespace-nowrap"
                    title="Marquer ce point (audio courant + ce timestamp)"
                  >
                    Marquer
                  </button>
                )}
                <button
                  onClick={() => splitLine(i)}
                  className="p-1.5 rounded-lg bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors text-[10px] font-bold"
                  title="Découper la ligne en deux"
                >
                  ✂
                </button>
                {i < lines.length - 1 && (
                  <button
                    onClick={() => mergeLine(i)}
                    className="p-1.5 rounded-lg bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors text-[10px] font-bold"
                    title="Fusionner avec la ligne suivante"
                  >
                    ⊕
                  </button>
                )}
                <button
                  onClick={() => removeLine(i)}
                  className="p-1.5 rounded-lg bg-zinc-800 text-red-400 hover:bg-red-500/10 transition-colors"
                  title="Supprimer"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <details className="text-xs text-zinc-500">
            <summary className="cursor-pointer hover:text-zinc-300">Éditeur brut (LRC)</summary>
            <textarea
              value={lyricsText}
              onChange={(e) => {
                setLyricsText(e.target.value);
                setDirty(true);
              }}
              spellCheck={false}
              className="w-full h-40 mt-2 bg-zinc-950 border border-zinc-700 rounded-xl p-3 font-mono text-xs text-zinc-200 focus:outline-none focus:border-amber-500/60 resize-y"
            />
          </details>
        </section>
      </main>
    </div>
  );
}
