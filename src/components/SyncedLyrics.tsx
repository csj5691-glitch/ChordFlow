"use client";

import { useRef, useEffect, useMemo, useCallback, useState } from "react";
import { loadLineChords, saveLineChords, loadLineSpacers, saveLineSpacers, loadExtraChordLines, saveExtraChordLines, ExtraChordLine } from "@/lib/custom-songs";
import ChordReference from "./ChordReference";

interface SyncedLyricsProps {
  songId?: string;
  artist?: string;
  title?: string;
  plainLyrics: string;
  syncedLrc?: string;
  currentTime: number;
  onSeek?: (time: number) => void;
  offset?: number;
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

export default function SyncedLyrics({
  songId,
  artist,
  title,
  plainLyrics,
  syncedLrc,
  currentTime,
  onSeek,
  offset = 0,
}: SyncedLyricsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const [editMode, setEditMode] = useState(false);
  const [lineChords, setLineChords] = useState<Record<number, string[]>>({});
  const [editingLine, setEditingLine] = useState<number | null>(null);
  const [chordInput, setChordInput] = useState("");
  const [showChordRef, setShowChordRef] = useState(false);
  const [lineSpacers, setLineSpacers] = useState<Record<number, string>>({});
  const [insertingSpacer, setInsertingSpacer] = useState<number | null>(null);
  const [spacerLabel, setSpacerLabel] = useState("");
  const [extraLines, setExtraLines] = useState<ExtraChordLine[]>([]);
  const [insertingExtraAt, setInsertingExtraAt] = useState<number | null>(null);
  const [extraChordInput, setExtraChordInput] = useState("");
  const [extraLabelInput, setExtraLabelInput] = useState("");

  useEffect(() => {
    if (songId) {
      setLineChords(loadLineChords(songId));
      setLineSpacers(loadLineSpacers(songId));
      setExtraLines(loadExtraChordLines(songId));
    }
  }, [songId]);

  const lrcLines = useMemo(() => {
    if (syncedLrc) {
      return parseLrc(syncedLrc);
    }
    const lines = plainLyrics.split("\n").filter((l) => l.trim());
    const gap = 3;
    return lines.map((text, i) => ({
      time: i * gap,
      text,
    }));
  }, [syncedLrc, plainLyrics]);

  const adjustedLines = useMemo(() => {
    return lrcLines.map((line) => ({
      ...line,
      time: Math.max(0, line.time + offset),
    }));
  }, [lrcLines, offset]);

  const activeIndex = useMemo(() => {
    let idx = -1;
    for (let i = 0; i < adjustedLines.length; i++) {
      if (currentTime >= adjustedLines[i].time - 0.1) {
        idx = i;
      } else {
        break;
      }
    }
    return idx;
  }, [adjustedLines, currentTime]);

  useEffect(() => {
    if (activeRef.current && containerRef.current) {
      const container = containerRef.current;
      const el = activeRef.current;
      const containerRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const scrollOffset = elRect.top - containerRect.top - containerRect.height / 2 + elRect.height / 2;

      container.scrollBy({
        top: scrollOffset,
        behavior: "smooth",
      });
    }
  }, [activeIndex]);

  const handleClick = useCallback(
    (time: number) => {
      if (!editMode) onSeek?.(time);
    },
    [onSeek, editMode]
  );

  const startEditChord = useCallback((lineIdx: number) => {
    setEditingLine(lineIdx);
    const existing = lineChords[lineIdx];
    setChordInput(existing ? existing.join("  ") : "");
  }, [lineChords]);

  const saveChord = useCallback(() => {
    if (editingLine === null || !songId) {
      setEditingLine(null);
      return;
    }
    const chords = chordInput.trim().split(/\s+/).filter(Boolean);
    setLineChords((prev) => {
      const next = { ...prev, [editingLine]: chords };
      saveLineChords(songId, editingLine, chords);
      return next;
    });
    setEditingLine(null);
    setChordInput("");
  }, [editingLine, chordInput, songId]);

  const insertChord = useCallback((chordName: string) => {
    setChordInput((prev) => prev ? prev + "  " + chordName : chordName);
  }, []);

  const saveSpacer = useCallback(() => {
    if (insertingSpacer === null || !songId) {
      setInsertingSpacer(null);
      return;
    }
    const label = spacerLabel.trim() || "· · ·";
    setLineSpacers((prev) => {
      const next = { ...prev, [insertingSpacer]: label };
      saveLineSpacers(songId, insertingSpacer, label);
      return next;
    });
    setInsertingSpacer(null);
    setSpacerLabel("");
  }, [insertingSpacer, spacerLabel, songId]);

  const removeSpacer = useCallback((lineIdx: number) => {
    if (!songId) return;
    setLineSpacers((prev) => {
      const next = { ...prev };
      delete next[lineIdx];
      saveLineSpacers(songId, lineIdx, "");
      return next;
    });
  }, [songId]);

  const hasChords = Object.keys(lineChords).length > 0;
  const hasSpacers = Object.keys(lineSpacers).length > 0;

  const saveExtraLine = useCallback(() => {
    if (insertingExtraAt === null || !songId) {
      setInsertingExtraAt(null);
      return;
    }
    const chords = extraChordInput.trim().split(/\s+/).filter(Boolean);
    const label = extraLabelInput.trim() || undefined;
    const newLine: ExtraChordLine = { position: insertingExtraAt, chords, label };
    const next = [...extraLines, newLine].sort((a, b) => a.position - b.position);
    setExtraLines(next);
    saveExtraChordLines(songId, next);
    setInsertingExtraAt(null);
    setExtraChordInput("");
    setExtraLabelInput("");
  }, [insertingExtraAt, extraChordInput, extraLabelInput, extraLines, songId]);

  const removeExtraLine = useCallback((idx: number) => {
    if (!songId) return;
    const next = extraLines.filter((_, i) => i !== idx);
    setExtraLines(next);
    saveExtraChordLines(songId, next);
  }, [extraLines, songId]);

  return (
    <div className="synced-lyrics-wrapper relative">
      <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 rounded-t-xl bg-zinc-900/50">
        <button
          onClick={() => setEditMode(!editMode)}
          className={`text-xs font-medium px-3 py-1 rounded-full transition-colors ${
            editMode
              ? "bg-amber-500 text-black"
              : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
          }`}
        >
          {editMode ? "Mode accords actif" : "Ajouter des accords"}
        </button>
        {hasChords && !editMode && (
          <span className="text-[10px] text-zinc-600">
            {Object.keys(lineChords).length} lignes avec accords
            {hasSpacers ? ` · ${Object.keys(lineSpacers).length} séparateurs` : ""}
          </span>
        )}
      </div>

      {editMode && (
        <div className="px-4 py-2 border-b border-zinc-800 bg-zinc-900/30">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowChordRef(!showChordRef)}
              className={`text-[10px] px-2 py-1 rounded transition-colors ${
                showChordRef ? "bg-amber-500/20 text-amber-400" : "bg-zinc-800 text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {showChordRef ? "Masquer diagrammes" : "Diagrammes"}
            </button>
            {artist && title && (
              <>
                <button
                  onClick={() => {
                    const q = encodeURIComponent(`${artist} ${title}`);
                    window.open(`https://www.songsterr.com/a/wa/search?pattern=${q}`, "_blank");
                  }}
                  className="text-[10px] px-2 py-1 rounded bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
                >
                  Songsterr
                </button>
                <button
                  onClick={() => {
                    const q = encodeURIComponent(`${artist} ${title}`);
                    window.open(`https://www.ultimate-guitar.com/search.php?search_type=title&value=${q}`, "_blank");
                  }}
                  className="text-[10px] px-2 py-1 rounded bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 transition-colors"
                >
                  UG
                </button>
              </>
            )}
            <span className="text-[10px] text-zinc-600">
              Cliquez sur une ligne pour ajouter un accord
            </span>
          </div>
          {showChordRef && (
            <div className="mt-2">
              <ChordReference onInsert={insertChord} />
            </div>
          )}
        </div>
      )}

      <div
        ref={containerRef}
        className="synced-lyrics overflow-y-auto max-h-[55vh] p-4 rounded-b-xl bg-zinc-900/50 border border-zinc-700/50 border-t-0 scroll-smooth"
      >
        {adjustedLines.length === 0 ? (
          <p className="text-zinc-500 text-center py-8">Aucune paroles disponibles</p>
        ) : (
          <div className="space-y-1">
            {adjustedLines.map((line, i) => {
              const isActive = i === activeIndex;
              const isPast = activeIndex >= 0 && i < activeIndex;
              const chords = lineChords[i] || [];
              const isEditing = editingLine === i;
              const isInsertingSpacerHere = insertingSpacer === i;
              const spacerAbove = lineSpacers[i];

              return (
                <div key={i} ref={isActive ? activeRef : undefined}>
                  {spacerAbove && !editMode && (
                    <div className="flex items-center gap-2 py-2 px-4 my-1">
                      <div className="flex-1 border-t border-zinc-700/50" />
                      <span className="text-xs text-blue-400/70 font-medium tracking-wider uppercase">
                        {spacerAbove}
                      </span>
                      <div className="flex-1 border-t border-zinc-700/50" />
                    </div>
                  )}
                  {extraLines.filter((el) => el.position === i).map((el, eIdx) => (
                    <div key={`extra-${i}-${eIdx}`} className="py-1.5 px-4">
                      {el.label && (
                        <div className="text-[10px] text-purple-400/70 font-medium tracking-wider uppercase mb-0.5">
                          {el.label}
                        </div>
                      )}
                      <div className="flex font-mono text-[13px] font-semibold leading-none select-none">
                        {el.chords.map((chord, cIdx) => (
                          <span key={cIdx} className="text-amber-400 mx-px">
                            {chord}
                          </span>
                        ))}
                      </div>
                      {editMode && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const origIdx = extraLines.indexOf(el);
                            removeExtraLine(origIdx);
                          }}
                          className="text-[9px] text-zinc-600 hover:text-red-400 mt-0.5"
                        >
                          supprimer
                        </button>
                      )}
                    </div>
                  ))}
                  {editMode && (
                    <div className="flex items-center gap-1 py-0.5 px-4">
                      <div className="flex-1 border-t border-dashed border-zinc-800" />
                      {insertingExtraAt === i ? (
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="text"
                            value={extraLabelInput}
                            onChange={(e) => setExtraLabelInput(e.target.value)}
                            placeholder="Intro/Solo/Outro"
                            className="w-24 bg-zinc-800 border border-purple-500/50 rounded px-1.5 py-0.5 text-[10px] text-purple-400 focus:outline-none text-center"
                          />
                          <input
                            type="text"
                            value={extraChordInput}
                            onChange={(e) => setExtraChordInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveExtraLine();
                              if (e.key === "Escape") { setInsertingExtraAt(null); setExtraChordInput(""); setExtraLabelInput(""); }
                            }}
                            autoFocus
                            placeholder="Am  F  C  G"
                            className="w-36 bg-zinc-800 border border-amber-500/50 rounded px-1.5 py-0.5 text-[10px] font-mono text-amber-400 focus:outline-none"
                          />
                          <button
                            onClick={(e) => { e.stopPropagation(); saveExtraLine(); }}
                            className="text-[9px] px-1.5 py-0.5 bg-amber-500 text-black rounded font-medium"
                          >
                            OK
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); setInsertingExtraAt(i); setExtraChordInput(""); setExtraLabelInput(""); }}
                          className="text-[9px] text-zinc-700 hover:text-amber-400 px-1.5 py-0.5 rounded border border-dashed border-zinc-800 hover:border-amber-400/50 transition-colors"
                        >
                          + accords (hors chant)
                        </button>
                      )}
                      <div className="flex-1 border-t border-dashed border-zinc-800" />
                    </div>
                  )}

                  <div
                    className={`lyric-line flex items-baseline gap-3 py-2.5 px-4 rounded-lg transition-all duration-150 ${
                      editMode
                        ? "cursor-pointer hover:bg-zinc-800/50 border-l-4 border-dashed border-zinc-700 hover:border-amber-400/50"
                        : `cursor-pointer ${
                            isActive
                              ? "text-xl font-semibold text-white bg-amber-400/10 border-l-4 border-amber-400 scale-[1.02] origin-left"
                              : isPast
                              ? "text-zinc-600 hover:text-zinc-400 border-l-4 border-transparent"
                              : "text-zinc-400 hover:text-zinc-300 border-l-4 border-transparent text-lg"
                          }`
                    }`}
                    onClick={() => {
                      if (editMode) {
                        startEditChord(i);
                      } else {
                        handleClick(line.time);
                      }
                    }}
                  >
                    <span
                      className={`text-xs font-mono flex-shrink-0 w-12 ${
                        isActive ? "text-amber-400" : "text-zinc-600"
                      }`}
                    >
                      {formatTime(line.time)}
                    </span>
                    <div className="flex-1 min-w-0">
                      {chords.length > 0 && !isEditing && (
                        <div className="flex gap-2 flex-wrap mb-1">
                          {chords.map((chord, cIdx) => (
                            <span
                              key={cIdx}
                              className={`font-mono text-sm font-bold px-1.5 py-0.5 rounded ${
                                isActive ? "text-amber-400 bg-amber-400/10" : "text-emerald-400"
                              }`}
                            >
                              {chord}
                            </span>
                          ))}
                        </div>
                      )}
                      {isEditing ? (
                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="text"
                            value={chordInput}
                            onChange={(e) => setChordInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") saveChord();
                              if (e.key === "Escape") { setEditingLine(null); setChordInput(""); }
                            }}
                            onBlur={saveChord}
                            autoFocus
                            placeholder="Am  F  C  G"
                            className="flex-1 bg-zinc-800 border border-amber-500/50 rounded px-2 py-1 text-sm font-mono text-amber-400 focus:outline-none"
                          />
                          <button
                            onClick={(e) => { e.stopPropagation(); saveChord(); }}
                            className="text-[10px] px-2 py-1 bg-amber-500 text-black rounded font-medium"
                          >
                            OK
                          </button>
                        </div>
                      ) : (
                        <span
                          className={`leading-relaxed ${
                            editMode
                              ? "text-zinc-400"
                              : isActive
                              ? ""
                              : isPast
                              ? "text-zinc-500"
                              : "text-zinc-400 text-lg"
                          }`}
                        >
                          {line.text}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {extraLines.filter((el) => el.position >= adjustedLines.length).map((el, eIdx) => (
              <div key={`extra-end-${eIdx}`} className="py-1.5 px-4">
                {el.label && (
                  <div className="text-[10px] text-purple-400/70 font-medium tracking-wider uppercase mb-0.5">
                    {el.label}
                  </div>
                )}
                <div className="flex font-mono text-[13px] font-semibold leading-none select-none">
                  {el.chords.map((chord, cIdx) => (
                    <span key={cIdx} className="text-amber-400 mx-px">
                      {chord}
                    </span>
                  ))}
                </div>
                {editMode && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const origIdx = extraLines.indexOf(el);
                      removeExtraLine(origIdx);
                    }}
                    className="text-[9px] text-zinc-600 hover:text-red-400 mt-0.5"
                  >
                    supprimer
                  </button>
                )}
              </div>
            ))}
            {editMode && (
              <div className="flex items-center gap-1 py-1 px-4">
                <div className="flex-1 border-t border-dashed border-zinc-800" />
                {insertingExtraAt === adjustedLines.length ? (
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="text"
                      value={extraLabelInput}
                      onChange={(e) => setExtraLabelInput(e.target.value)}
                      placeholder="Outro/Solo/Bridge"
                      className="w-24 bg-zinc-800 border border-purple-500/50 rounded px-1.5 py-0.5 text-[10px] text-purple-400 focus:outline-none text-center"
                    />
                    <input
                      type="text"
                      value={extraChordInput}
                      onChange={(e) => setExtraChordInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveExtraLine();
                        if (e.key === "Escape") { setInsertingExtraAt(null); setExtraChordInput(""); setExtraLabelInput(""); }
                      }}
                      autoFocus
                      placeholder="Am  F  C  G"
                      className="w-36 bg-zinc-800 border border-amber-500/50 rounded px-1.5 py-0.5 text-[10px] font-mono text-amber-400 focus:outline-none"
                    />
                    <button
                      onClick={(e) => { e.stopPropagation(); saveExtraLine(); }}
                      className="text-[9px] px-1.5 py-0.5 bg-amber-500 text-black rounded font-medium"
                    >
                      OK
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); setInsertingExtraAt(adjustedLines.length); setExtraChordInput(""); setExtraLabelInput(""); }}
                    className="text-[9px] text-zinc-700 hover:text-amber-400 px-1.5 py-0.5 rounded border border-dashed border-zinc-800 hover:border-amber-400/50 transition-colors"
                  >
                    + accords outro
                  </button>
                )}
                <div className="flex-1 border-t border-dashed border-zinc-800" />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="absolute top-16 right-4 flex items-center gap-2 text-xs text-zinc-600">
        <span>{formatTime(currentTime)}</span>
      </div>
    </div>
  );
}
