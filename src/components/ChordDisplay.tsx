"use client";

import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { ChordSection } from "@/lib/types";

interface ChordDisplayProps {
  sections: ChordSection[];
  currentTime: number;
  timestamps: { time: number; chord: string; sectionIndex: number; lineIndex: number }[];
  onSeek?: (time: number) => void;
  offset?: number;
  onChordEdit?: (sectionIndex: number, lineIndex: number, chordIndex: number, newChord: string) => void;
  onRawEdit?: (newContent: string) => void;
}

function distributeChordsAcrossText(chords: string[], text: string): { word: string; chord?: string }[] {
  if (chords.length === 0) return [{ word: text }];
  const words = text.split(/(\s+)/);
  const contentWords = words.filter((w) => w.trim());
  if (contentWords.length === 0) return [{ word: text, chord: chords[0] }];

  const result: { word: string; chord?: string }[] = [];
  let chordIdx = 0;

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (!w.trim()) {
      result.push({ word: w });
      continue;
    }
    const chord = chordIdx < chords.length ? chords[chordIdx] : undefined;
    result.push({ word: w, chord });
    chordIdx++;
  }
  return result;
}

export default function ChordDisplay({
  sections,
  currentTime,
  timestamps,
  onSeek,
  offset = 0,
  onChordEdit,
  onRawEdit,
}: ChordDisplayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeLine, setActiveLine] = useState({ sectionIndex: 0, lineIndex: 0 });
  const [editing, setEditing] = useState<{ sIdx: number; lIdx: number; cIdx: number; value: string } | null>(null);
  const [editingLine, setEditingLine] = useState<{ sIdx: number; lIdx: number; value: string } | null>(null);
  const [textEditorMode, setTextEditorMode] = useState(false);
  const [rawText, setRawText] = useState("");

  const adjustedTimestamps = useMemo(() => timestamps.map((ts) => ({
    ...ts,
    time: Math.max(0, ts.time + offset),
  })), [timestamps, offset]);

  useEffect(() => {
    let closest = adjustedTimestamps[0];
    for (const ts of adjustedTimestamps) {
      if (ts.time <= currentTime) {
        closest = ts;
      } else {
        break;
      }
    }
    if (closest) {
      setActiveLine({
        sectionIndex: closest.sectionIndex,
        lineIndex: closest.lineIndex,
      });
    }
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
      return ts?.time;
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
    const chords = editingLine.value.trim().split(/\s+/).filter(Boolean);
    chords.forEach((chord, cIdx) => {
      const existing = sections[editingLine.sIdx]?.lines[editingLine.lIdx]?.chords[cIdx];
      if (existing !== chord) {
        onChordEdit(editingLine.sIdx, editingLine.lIdx, cIdx, chord);
      }
    });
    setEditingLine(null);
  }, [editingLine, onChordEdit, sections]);

  const generateRawText = useCallback(() => {
    return sections.map((section) => {
      const lines: string[] = [];
      if (section.label) lines.push(`[${section.label}]`);
      section.lines.forEach((line) => {
        if (line.chords.length > 0) lines.push(line.chords.join("  "));
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
      className="chord-display overflow-y-auto max-h-[60vh] py-4 px-6 rounded-xl bg-zinc-900/50 border border-zinc-700/50"
    >
      {onChordEdit && (
        <div className="flex items-center gap-3 mb-4">
          <p className="text-[10px] text-zinc-600 flex-1">Cliquez sur un accord pour le modifier</p>
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
      {textEditorMode ? (
        <div className="space-y-3">
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            className="w-full h-[50vh] bg-zinc-800 border border-zinc-700 rounded-lg px-4 py-3 text-sm font-mono text-zinc-200 focus:outline-none focus:border-amber-500/50 resize-none leading-relaxed"
            placeholder={`[Verse 1]\nAm              F\nOn a dark desert highway\nC               G\nCool wind in my hair...`}
            spellCheck={false}
          />
          <div className="flex items-center gap-2">
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
                className={`song-line py-1.5 px-3 -mx-3 rounded transition-all duration-150 cursor-pointer ${
                  isActive
                    ? "active bg-amber-400/8 border-l-[3px] border-amber-400"
                    : isPast
                      ? "border-l-[3px] border-transparent opacity-40"
                      : "border-l-[3px] border-transparent hover:bg-zinc-800/30"
                }`}
                onClick={() => seekTime !== undefined && onSeek?.(seekTime)}
              >
                {hasChords && (
                  <div className="flex font-mono text-[13px] font-semibold leading-none mb-0.5 select-none items-center">
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
                        {line.chords.map((chord, cIdx) => {
                      const isEditingThis =
                        editing?.sIdx === sIdx &&
                        editing?.lIdx === lIdx &&
                        editing?.cIdx === cIdx;

                      return (
                        <span
                          key={cIdx}
                          className={`chord-tag inline-block ${
                            isEditingThis
                              ? "text-amber-300 bg-amber-400/20 rounded px-0.5 mx-px"
                              : isActive
                                ? "text-amber-400"
                                : "text-emerald-400"
                          } ${onChordEdit ? "cursor-text hover:bg-amber-400/15 hover:text-amber-300 rounded px-0.5 mx-px" : "mx-px"}`}
                          onClick={(e) => {
                            if (!onChordEdit) return;
                            e.stopPropagation();
                            startEditing(sIdx, lIdx, cIdx, chord);
                          }}
                        >
                          {isEditingThis ? (
                            <input
                              type="text"
                              value={editing.value}
                              onChange={(e) =>
                                setEditing((prev) =>
                                  prev ? { ...prev, value: e.target.value } : null
                                )
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.stopPropagation();
                                  commitEdit();
                                }
                                if (e.key === "Escape") {
                                  setEditing(null);
                                }
                                if (e.key === "Tab") {
                                  e.preventDefault();
                                  commitEdit();
                                  const nextCIdx = cIdx + 1;
                                  if (nextCIdx < line.chords.length) {
                                    setTimeout(() =>
                                      startEditing(sIdx, lIdx, nextCIdx, line.chords[nextCIdx])
                                    , 0);
                                  }
                                }
                              }}
                              onBlur={commitEdit}
                              autoFocus
                              className="bg-transparent outline-none w-14 text-amber-400 font-mono text-[13px] font-semibold"
                              onClick={(e) => e.stopPropagation()}
                            />
                          ) : (
                            chord
                          )}
                        </span>
                      );
                    })}
                        </>
                      )}
                      {onChordEdit && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingLine({ sIdx, lIdx, value: line.chords.join("  ") });
                          }}
                          className="text-[10px] text-zinc-600 hover:text-amber-400 px-1.5 py-0.5 rounded border border-dashed border-zinc-700 hover:border-amber-400/50 transition-colors ml-2"
                        >
                          éditer
                        </button>
                      )}
                  </div>
                )}
                {!hasChords && onChordEdit && (
                  <div className="flex items-center h-4 mb-0.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onChordEdit(sIdx, lIdx, 0, "");
                      }}
                      className="text-[10px] text-zinc-600 hover:text-amber-400 px-1 py-0.5 rounded border border-dashed border-zinc-700 hover:border-amber-400/50 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      + accord
                    </button>
                  </div>
                )}
                <div
                  className={`lyrics text-[15px] leading-snug ${
                    isActive ? "text-white" : isPast ? "text-zinc-500" : "text-zinc-300"
                  }`}
                >
                  {line.lyrics || "\u00A0"}
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
