"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.


import { useRef, useEffect, useState, useCallback, useMemo, useSyncExternalStore } from "react";
import { ChordSection } from "@/lib/types";
import { subscribeCurrentTime, getCurrentTime } from "@/lib/playback-store";
import { sectionsToContent } from "@/lib/chord-parser";
import ChordDiagram from "@/components/ChordDiagram";
import { resolveChordForDiagram, type NoteName, type ChordQuality } from "@/lib/chord-data";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function ChordName({ chord }: { chord: string }) {
  const slashIdx = chord.lastIndexOf("/");
  if (slashIdx <= 0 || slashIdx === chord.length - 1) {
    return <>{chord}</>;
  }
  return (
    <>
      {chord.slice(0, slashIdx)}
      <span className="opacity-50">/</span>
      <span className="opacity-70">{chord.slice(slashIdx + 1)}</span>
    </>
  );
}

interface Segment {
  text: string;
  chordIdx?: number;
}

function buildSegments(raw: string, chords: string[]): Segment[] {
  if (!chords.length || !raw) return [{ text: raw }];
  const segs: Segment[] = [];
  let pos = 0;
  for (let i = 0; i < chords.length; i++) {
    const chord = chords[i];
    const idx = raw.indexOf(chord, pos);
    if (idx === -1) continue;
    if (idx > pos) segs.push({ text: raw.slice(pos, idx) });
    segs.push({ text: chord, chordIdx: i });
    pos = idx + chord.length;
  }
  if (pos < raw.length) segs.push({ text: raw.slice(pos) });
  return segs;
}

interface ChordDisplayProps {
  sections: ChordSection[];
  timestamps: { time: number; chord: string; sectionIndex: number; lineIndex: number; matched: boolean }[];
  onSeek?: (time: number) => void;
  offset?: number;
  onChordEdit?: (sectionIndex: number, lineIndex: number, chordIndex: number, newChord: string) => void;
  onRawEdit?: (newContent: string) => void;
}
export default function ChordDisplay({
  sections,
  timestamps,
  onSeek,
  offset = 0,
  onChordEdit,
  onRawEdit,
}: ChordDisplayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const currentTime = useSyncExternalStore(subscribeCurrentTime, getCurrentTime, getCurrentTime);
  const [editing, setEditing] = useState<{ sIdx: number; lIdx: number; cIdx: number; value: string } | null>(null);
  const [editingLine, setEditingLine] = useState<{ sIdx: number; lIdx: number; value: string } | null>(null);
  const [textEditorMode, setTextEditorMode] = useState(false);
  const [rawText, setRawText] = useState("");
  const [showDiagrams, setShowDiagrams] = useState(false);

  const distinctChords = useMemo(() => {
    const seen = new Set<string>();
    const chords: { note: NoteName; quality: ChordQuality; label: string }[] = [];
    sections.forEach((section) => {
      section.lines.forEach((line) => {
        line.chords.forEach((chord) => {
          const label = chord.trim();
          const resolved = resolveChordForDiagram(label);
          if (!resolved) return;
          if (seen.has(label)) return;
          seen.add(label);
          chords.push({ note: resolved.note, quality: resolved.quality, label });
        });
      });
    });
    return chords;
  }, [sections]);

  const adjustedTimestamps = useMemo(() => timestamps.map((ts) => ({
    ...ts,
    time: Math.max(0, ts.time + offset),
  })), [timestamps, offset]);

  const activeLine = useMemo(() => {
    let closest = adjustedTimestamps[0];
    for (const ts of adjustedTimestamps) {
      if (ts.time <= currentTime) {
        closest = ts;
      } else {
        break;
      }
    }
    if (!closest) return { sectionIndex: 0, lineIndex: 0 };
    return {
      sectionIndex: closest.sectionIndex,
      lineIndex: closest.lineIndex,
    };
  }, [currentTime, adjustedTimestamps]);

  useEffect(() => {
    const activeEl = containerRef.current?.querySelector(".song-line.active");
    if (activeEl) {
      activeEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeLine]);

  const findChordForLine = useCallback(
    (sectionIdx: number, lineIdx: number) => {
      const ts = adjustedTimestamps.find(
        (t) => t.sectionIndex === sectionIdx && t.lineIndex === lineIdx
      );
      return ts ? { time: ts.time, matched: ts.matched } : undefined;
    },
    [adjustedTimestamps]
  );

  const startEditing = useCallback((sIdx: number, lIdx: number, cIdx: number, value: string) => {
    if (!onChordEdit) return;
    setEditing({ sIdx, lIdx, cIdx, value });
  }, [onChordEdit]);

  const commitEdit = useCallback(() => {
    if (!editing || !onChordEdit) {
      setEditing(null);
      return;
    }
    const val = editing.value.trim();
    if (val) {
      onChordEdit(editing.sIdx, editing.lIdx, editing.cIdx, val);
    }
    setEditing(null);
  }, [editing, onChordEdit]);

  const commitLineEdit = useCallback(() => {
    if (!editingLine || !onChordEdit) {
      setEditingLine(null);
      return;
    }
    const newRaw = editingLine.value;
    const newChords = newRaw.trim().split(/\s+/).filter(Boolean);
    const oldLine = sections[editingLine.sIdx]?.lines[editingLine.lIdx];
    if (oldLine && (newRaw !== oldLine.rawChord || newChords.length !== oldLine.chords.length)) {
      const updated = sections.map((s, si) => {
        if (si !== editingLine.sIdx) return s;
        return {
          ...s,
          lines: s.lines.map((l, li) => {
            if (li !== editingLine.lIdx) return l;
            return { ...l, chords: newChords, rawChord: newRaw };
          }),
        };
      });
      const newContent = sectionsToContent(updated);
      if (onRawEdit) {
        onRawEdit(newContent);
      }
    }
    setEditingLine(null);
  }, [editingLine, onChordEdit, onRawEdit, sections]);

  const generateRawText = useCallback(() => {
    return sections.map((section) => {
      const lines: string[] = [];
      if (section.label) lines.push(`[${section.label}]`);
      section.lines.forEach((line) => {
        if (line.chords.length > 0) lines.push(line.rawChord || line.chords.join("  "));
        lines.push(line.lyrics);
      });
      return lines.join("\n");
    }).join("\n\n");
  }, [sections]);

  const openTextEditor = useCallback(() => {
    setRawText(generateRawText());
    setTextEditorMode(true);
  }, [generateRawText]);

  const saveTextEditor = useCallback(() => {
    if (onRawEdit) {
      onRawEdit(rawText);
    }
    setTextEditorMode(false);
  }, [rawText, onRawEdit]);

  return (
    <div
      ref={containerRef}
      className={`chord-display overflow-y-auto max-h-[60vh] py-4 px-6 rounded-xl bg-zinc-900/50 border border-zinc-700/50 ${
        textEditorMode ? "flex flex-col" : ""
      }`}
    >
      {onChordEdit && (
        <div className="flex items-center gap-3 mb-4">
          <p className="text-[10px] text-zinc-600 flex-1">Cliquez sur un accord pour le modifier</p>
          <button
            onClick={() => setShowDiagrams((v) => !v)}
            className={`text-[10px] px-2 py-1 rounded transition-colors ${
              showDiagrams
                ? "bg-amber-500 text-black"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
            }`}
          >
            Diagrammes
          </button>
          <button
            onClick={textEditorMode ? () => setTextEditorMode(false) : openTextEditor}
            className={`text-[10px] px-2 py-1 rounded transition-colors ${
              textEditorMode
                ? "bg-amber-500 text-black"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
            }`}
          >
            {textEditorMode ? "Retour" : "Éditeur texte"}
          </button>
        </div>
      )}
      {showDiagrams && (
        <div className="mb-4">
          {distinctChords.length === 0 ? (
            <p className="text-[10px] text-zinc-600">Aucun accord trouvé</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {distinctChords.map((c) => (
                <div
                  key={c.label}
                  className="bg-zinc-800/40 border border-zinc-700/50 rounded-lg p-1.5"
                >
                  <ChordDiagram note={c.note} quality={c.quality} label={c.label} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {textEditorMode ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 sticky top-0 z-10 py-2 rounded-lg bg-zinc-900/95 backdrop-blur">
            <button
              onClick={saveTextEditor}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black rounded-lg text-sm font-medium transition-colors"
            >
              Appliquer
            </button>
            <button
              onClick={() => setTextEditorMode(false)}
              className="px-4 py-2 text-zinc-400 hover:text-white text-sm transition-colors"
            >
              Annuler
            </button>
            <span className="text-[10px] text-zinc-600 ml-2">
              Accords au-dessus des paroles, sections entre [crochets]
            </span>
          </div>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            className="w-full h-[44vh] bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-sm font-mono text-zinc-200 focus:outline-none focus:border-amber-500/50 resize-none leading-relaxed"
            placeholder={`[Verse 1]\nAm              F\nOn a dark desert highway\nC               G\nCool wind in my hair...`}
            spellCheck={false}
          />
        </div>
      ) : (
      <div className="space-y-1">
      {sections.map((section, sIdx) => (
        <div key={sIdx} className="mb-2">
          {section.label && (
            <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mt-5 mb-2 pb-1 border-b border-zinc-800">
              {section.label}
            </h2>
          )}
          {section.lines.map((line, lIdx) => {
            const isActive =
              activeLine.sectionIndex === sIdx && activeLine.lineIndex === lIdx;
            const isPast = activeLine.sectionIndex > sIdx || (activeLine.sectionIndex === sIdx && activeLine.lineIndex > lIdx);
            const seekTime = findChordForLine(sIdx, lIdx);
            const hasChords = line.chords.length > 0;

            return (
              <div
                key={`${sIdx}-${lIdx}`}
                className={`song-line py-1.5 px-3 -mx-3 flex items-baseline gap-3 rounded transition-all duration-150 cursor-pointer ${
                  isActive
                    ? "active bg-amber-400/8 border-l-[3px] border-amber-400"
                    : isPast
                      ? "border-l-[3px] border-transparent opacity-40"
                      : "border-l-[3px] border-transparent hover:bg-zinc-800/30"
                }`}
                onClick={() => seekTime && onSeek?.(seekTime.time)}
              >
                {seekTime && (
                  <span
                    className={`text-xs font-mono flex-shrink-0 w-12 ${
                      isActive ? "text-amber-400" : "text-zinc-600"
                    }`}
                  >
                    {formatTime(seekTime.time)}
                  </span>
                )}
                <div className="flex-1 min-w-0">
                {hasChords && (
                  <div className="font-mono text-[13px] font-semibold leading-none mb-0.5 select-none whitespace-pre">
                    {editingLine?.sIdx === sIdx && editingLine?.lIdx === lIdx ? (
                      <input
                        type="text"
                        value={editingLine.value}
                        onChange={(e) => setEditingLine((prev) => prev ? { ...prev, value: e.target.value } : null)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { e.stopPropagation(); commitLineEdit(); }
                          if (e.key === "Escape") setEditingLine(null);
                        }}
                        onBlur={commitLineEdit}
                        autoFocus
                        className="bg-zinc-800 outline-none w-48 text-amber-400 font-mono text-[13px] font-semibold rounded px-1 border border-amber-500/50"
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <>
                        {buildSegments(line.rawChord, line.chords).map((seg, sIdx2) => {
                          if (seg.chordIdx === undefined) {
                            return <span key={sIdx2}>{seg.text}</span>;
                          }
                          const cIdx = seg.chordIdx;
                          const isRepeated = cIdx > 0 && line.chords[cIdx] === line.chords[cIdx - 1];
                          if (isRepeated) {
                            return <span key={sIdx2} className="invisible">{line.chords[cIdx]}</span>;
                          }
                          return (
                            <span
                              key={sIdx2}
                              className={`chord-tag inline-block ${
                                editing?.sIdx === sIdx && editing?.lIdx === lIdx && editing?.cIdx === cIdx
                                  ? "text-amber-300 bg-amber-400/20 rounded px-0.5 mx-px"
                                  : isActive
                                    ? "text-amber-400"
                                    : "text-emerald-400"
                              } ${onChordEdit ? "cursor-text hover:bg-amber-400/15 hover:text-amber-300 rounded px-0.5 mx-px" : ""}`}
                              onClick={(e) => {
                                if (!onChordEdit) return;
                                e.stopPropagation();
                                startEditing(sIdx, lIdx, cIdx, line.chords[cIdx]);
                              }}
                            >
                              {editing?.sIdx === sIdx && editing?.lIdx === lIdx && editing?.cIdx === cIdx ? (
                                <input
                                  type="text"
                                  value={editing.value}
                                  onChange={(e) => setEditing((prev) => prev ? { ...prev, value: e.target.value } : null)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") { e.stopPropagation(); commitEdit(); }
                                    if (e.key === "Escape") setEditing(null);
                                    if (e.key === "Tab") {
                                      e.preventDefault();
                                      commitEdit();
                                      const next = cIdx + 1;
                                      if (next < line.chords.length) {
                                        setTimeout(() => startEditing(sIdx, lIdx, next, line.chords[next]), 0);
                                      }
                                    }
                                  }}
                                  onBlur={commitEdit}
                                  autoFocus
                                  className="bg-transparent outline-none text-amber-400 font-mono text-[13px] font-semibold border-b border-amber-500/50"
                                  style={{ width: `${Math.max(editing.value.length, 2)}ch` }}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              ) : (
                                <ChordName chord={line.chords[cIdx]} />
                              )}
                            </span>
                          );
                        })}
                        {onChordEdit && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingLine({ sIdx, lIdx, value: line.rawChord });
                            }}
                            className="text-[10px] text-zinc-600 hover:text-amber-400 px-1.5 py-0.5 rounded border border-dashed border-zinc-700 hover:border-amber-400/50 transition-colors ml-2"
                          >
                            éditer
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
                <div
                  className={`lyrics font-mono text-[15px] leading-snug ${
                    isActive ? "text-white" : isPast ? "text-zinc-500" : "text-zinc-300"
                  }`}
                >
                  {line.lyrics || "\u00A0"}
                </div>
                </div>
              </div>
              );
            })}
          </div>
        ))}
      </div>
      )}
    </div>
  );
}