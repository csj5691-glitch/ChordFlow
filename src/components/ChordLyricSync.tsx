"use client";

import { useRef, useEffect, useMemo, useCallback, useState } from "react";
import { ChordSection } from "@/lib/types";

interface ChordLyricSyncProps {
  sections: ChordSection[];
  syncedLrc?: string;
  plainLyrics?: string;
  currentTime: number;
  onSeek?: (time: number) => void;
  offset?: number;
  lineOffsets?: Record<number, number>;
  onLineOffsetChange?: (lineIndex: number, offset: number) => void;
}

interface LrcLine {
  time: number;
  text: string;
}

function parseLrc(lrc: string): LrcLine[] {
  const lines: LrcLine[] = [];
  for (const line of lrc.split("\n")) {
    const matchHH = line.match(/^\[(\d+):(\d+):(\d+\.?\d*)\]\s*(.*)/);
    if (matchHH) {
      const time = parseInt(matchHH[1], 10) * 3600 + parseInt(matchHH[2], 10) * 60 + parseFloat(matchHH[3]);
      const text = matchHH[4].trim();
      if (text) lines.push({ time, text });
      continue;
    }
    const match = line.match(/^\[(\d+):(\d+\.?\d*)\]\s*(.*)/);
    if (match) {
      const time = parseInt(match[1], 10) * 60 + parseFloat(match[2]);
      const text = match[3].trim();
      if (text) lines.push({ time, text });
    }
  }
  return lines;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface SyncLine {
  lrcTime: number;
  lrcText: string;
  chords: string[];
  sectionLabel?: string;
}

export default function ChordLyricSync({
  sections,
  syncedLrc,
  plainLyrics,
  currentTime,
  onSeek,
  offset = 0,
  lineOffsets = {},
  onLineOffsetChange,
}: ChordLyricSyncProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [editMode, setEditMode] = useState(false);
  const [globalShift, setGlobalShift] = useState(0);

  const lrcLines = useMemo(() => {
    if (syncedLrc) return parseLrc(syncedLrc);
    if (plainLyrics) {
      return plainLyrics.split("\n").filter((l) => l.trim()).map((text, i) => ({ time: i * 3, text }));
    }
    return [];
  }, [syncedLrc, plainLyrics]);

  const adjustedLrc = useMemo(
    () => lrcLines.map((l) => ({ ...l, time: Math.max(0, l.time + offset) })),
    [lrcLines, offset],
  );

  const allChordLines = useMemo(() => {
    const flat: { chords: string[]; lyrics: string; sectionLabel?: string }[] = [];
    sections.forEach((section) => {
      section.lines.forEach((line) => {
        flat.push({
          chords: line.chords,
          lyrics: line.lyrics,
          sectionLabel: section.label,
        });
      });
    });
    return flat;
  }, [sections]);

  const syncLines = useMemo((): SyncLine[] => {
    if (adjustedLrc.length === 0) {
      return allChordLines.map((cl) => ({
        lrcTime: 0,
        lrcText: "",
        chords: cl.chords,
        sectionLabel: cl.sectionLabel,
      }));
    }

    const chordWithIndex = allChordLines.map((cl, i) => ({ ...cl, origIdx: i }));
    const nonEmptyChords = chordWithIndex.filter((c) => c.lyrics.trim());

    if (nonEmptyChords.length === 0) {
      return adjustedLrc.map((lrc) => ({
        lrcTime: lrc.time,
        lrcText: lrc.text,
        chords: [],
      }));
    }

    const result: SyncLine[] = [];
    let chordPointer = 0;

    for (let lrcIdx = 0; lrcIdx < adjustedLrc.length; lrcIdx++) {
      const lrc = adjustedLrc[lrcIdx];

      const targetChordIdx = Math.round((lrcIdx / Math.max(adjustedLrc.length - 1, 1)) * (nonEmptyChords.length - 1));
      const searchFrom = Math.max(0, targetChordIdx - 2);
      const searchTo = Math.min(nonEmptyChords.length, targetChordIdx + 3);

      let bestMatch = -1;
      let bestScore = 0;

      for (let ci = searchFrom; ci < searchTo; ci++) {
        if (ci <= chordPointer - 1) continue;
        const cl = nonEmptyChords[ci];
        const lrcWords = new Set(lrc.text.toLowerCase().split(/\s+/).filter(Boolean));
        const chordWords = new Set(cl.lyrics.toLowerCase().split(/\s+/).filter(Boolean));
        const common = [...lrcWords].filter((w) => chordWords.has(w)).length;
        const score = common / Math.max(lrcWords.size, 1);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = ci;
        }
      }

      if (bestMatch >= 0 && bestScore > 0.2) {
        const cl = nonEmptyChords[bestMatch];
        result.push({
          lrcTime: lrc.time,
          lrcText: lrc.text,
          chords: cl.chords,
          sectionLabel: cl.sectionLabel,
        });
        chordPointer = bestMatch + 1;
      } else {
        const fallbackIdx = Math.min(chordPointer, nonEmptyChords.length - 1);
        const cl = nonEmptyChords[fallbackIdx];
        result.push({
          lrcTime: lrc.time,
          lrcText: lrc.text,
          chords: chordPointer <= fallbackIdx && cl ? cl.chords : [],
          sectionLabel: undefined,
        });
        if (fallbackIdx === chordPointer) chordPointer++;
      }
    }

    return result;
  }, [adjustedLrc, allChordLines]);

  const activeIdx = useMemo(() => {
    let best = -1;
    for (let i = 0; i < syncLines.length; i++) {
      const lo = lineOffsets[i] || 0;
      const effectiveTime = syncLines[i].lrcTime + lo + globalShift;
      if (currentTime >= effectiveTime - 0.3) {
        best = i;
      }
    }
    return best;
  }, [syncLines, currentTime, lineOffsets, globalShift]);

  useEffect(() => {
    if (activeIdx < 0) return;
    const el = containerRef.current?.querySelector(`[data-idx="${activeIdx}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeIdx]);

  const handleClick = useCallback(
    (lineIdx: number, lrcTime: number) => {
      if (editMode) {
        const newOffset = Math.round((currentTime - lrcTime) * 100) / 100;
        onLineOffsetChange?.(lineIdx, newOffset);
        return;
      }
      const lo = lineOffsets[lineIdx] || 0;
      onSeek?.(lrcTime + lo + globalShift);
    },
    [editMode, onLineOffsetChange, onSeek, currentTime, lineOffsets, globalShift],
  );

  const handleOffset = useCallback(
    (lineIdx: number, delta: number) => {
      const current = lineOffsets[lineIdx] || 0;
      const newVal = Math.round((current + delta) * 10) / 10;
      onLineOffsetChange?.(lineIdx, newVal);
    },
    [lineOffsets, onLineOffsetChange],
  );

  const hasSync = adjustedLrc.length > 0;
  const hasOffsets = Object.keys(lineOffsets).length > 0;

  return (
    <div className="rounded-xl bg-zinc-900/50 border border-zinc-700/50 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-500">Global</span>
          <input
            type="range"
            min={-30}
            max={30}
            step={0.1}
            value={globalShift}
            onChange={(e) => setGlobalShift(Math.round(parseFloat(e.target.value) * 10) / 10)}
            className="w-28 accent-amber-500"
          />
          <span className={`text-[10px] font-mono w-10 text-center ${globalShift !== 0 ? "text-amber-400" : "text-zinc-500"}`}>
            {globalShift > 0 ? "+" : ""}{globalShift.toFixed(1)}
          </span>
          {globalShift !== 0 && (
            <button
              onClick={() => setGlobalShift(0)}
              className="text-[9px] text-zinc-500 hover:text-red-400 px-1"
            >
              reset
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setEditMode(!editMode)}
            className={`text-xs font-medium px-3 py-1 rounded-full transition-colors ${
              editMode
                ? "bg-amber-500 text-black"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
            }`}
          >
            {editMode ? "Réglage actif" : "Réglage lecture"}
          </button>
          <span className="text-[10px] text-zinc-500 hidden sm:block">
            {editMode ? "Cliquez une ligne pendant la lecture pour la caler" : "Activer pour régler les lignes"}
          </span>
        </div>

        {hasOffsets && (
          <span className="text-[10px] text-zinc-600">
            {Object.keys(lineOffsets).length} lignes ajustées
          </span>
        )}
      </div>

      <div
        ref={containerRef}
        className="overflow-y-auto max-h-[55vh] py-4 px-6 space-y-0"
      >
        {syncLines.length === 0 ? (
          <p className="text-zinc-500 text-center py-8">Aucune donnée disponible</p>
        ) : (
          syncLines.map((sl, i) => {
            const isActive = i === activeIdx;
            const isPast = activeIdx >= 0 && i < activeIdx;
            const lo = lineOffsets[i] || 0;
            const effectiveTime = sl.lrcTime + lo + globalShift;
            const hasChords = sl.chords.length > 0;

            return (
              <div key={i} data-idx={i}>
                {sl.sectionLabel && (
                  <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mt-5 mb-2 pb-1 border-b border-zinc-800">
                    {sl.sectionLabel}
                  </h2>
                )}
                <div
                  className={`song-line py-1.5 px-3 -mx-3 rounded cursor-pointer transition-all duration-150 ${
                    isActive
                      ? "active bg-amber-400/8 border-l-[3px] border-amber-400"
                      : isPast
                        ? "border-l-[3px] border-transparent opacity-40"
                        : "border-l-[3px] border-transparent hover:bg-zinc-800/30"
                  }`}
                  onClick={() => handleClick(i, sl.lrcTime)}
                >
                  {hasChords && (
                    <div className="flex font-mono text-[13px] font-semibold leading-none mb-0.5 select-none">
                      {sl.chords.map((chord, cIdx) => (
                        <span
                          key={cIdx}
                          className={`chord-tag inline-block mx-px ${
                            isActive ? "text-amber-400" : "text-emerald-400"
                          }`}
                        >
                          {chord}
                        </span>
                      ))}
                    </div>
                  )}
                  <div
                    className={`lyrics text-[15px] leading-snug ${
                      isActive ? "text-white" : isPast ? "text-zinc-500" : "text-zinc-300"
                    }`}
                  >
                    {sl.lrcText || "\u00A0"}
                  </div>

                  {editMode && (
                    <div className="flex items-center gap-1 mt-1 -mb-0.5" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => handleOffset(i, -0.5)}
                        className="w-5 h-5 rounded bg-zinc-700 hover:bg-zinc-600 text-white text-[10px] flex items-center justify-center"
                      >
                        -.5
                      </button>
                      <button
                        onClick={() => handleOffset(i, -0.1)}
                        className="w-5 h-5 rounded bg-zinc-700 hover:bg-zinc-600 text-white text-[10px] flex items-center justify-center"
                      >
                        -
                      </button>
                      {lo !== 0 && (
                        <span className="text-[9px] font-mono text-amber-400 min-w-[30px] text-center">
                          {lo > 0 ? "+" : ""}{lo.toFixed(1)}
                        </span>
                      )}
                      <button
                        onClick={() => handleOffset(i, 0.1)}
                        className="w-5 h-5 rounded bg-zinc-700 hover:bg-zinc-600 text-white text-[10px] flex items-center justify-center"
                      >
                        +
                      </button>
                      <button
                        onClick={() => handleOffset(i, 0.5)}
                        className="w-5 h-5 rounded bg-zinc-700 hover:bg-zinc-600 text-white text-[10px] flex items-center justify-center"
                      >
                        +.5
                      </button>
                      <span className={`text-[9px] font-mono ml-2 ${isActive ? "text-amber-400" : "text-zinc-600"}`}>
                        {formatTime(effectiveTime)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
