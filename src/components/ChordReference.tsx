"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.


import { useState, useMemo } from "react";
import ChordDiagram from "@/components/ChordDiagram";
import {
  NOTES,
  QUALITIES,
  getChordShape,
  formatChordName,
  type NoteName,
  type ChordQuality,
} from "@/lib/chord-data";

interface ChordReferenceProps {
  onInsert?: (chordName: string) => void;
}

const STRING_NAMES = ["E", "A", "D", "G", "B", "e"];
const FRET_COUNT = 5;

export default function ChordReference({ onInsert }: ChordReferenceProps) {
  const [selectedNote, setSelectedNote] = useState<NoteName>("C");
  const [selectedQuality, setSelectedQuality] = useState<ChordQuality>("Maj");

  const shape = useMemo(
    () => getChordShape(selectedNote, selectedQuality),
    [selectedNote, selectedQuality]
  );

  const chordName = useMemo(
    () => formatChordName(selectedNote, selectedQuality),
    [selectedNote, selectedQuality]
  );

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold text-white">Recherche d&apos;accords</h4>
        {onInsert && (
          <button
            onClick={() => onInsert(chordName)}
            className="text-xs px-2 py-1 bg-amber-500/20 text-amber-400 rounded hover:bg-amber-500/30 transition-colors"
          >
            Insérer {chordName}
          </button>
        )}
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        <div className="flex-1 space-y-3">
          <div className="grid grid-cols-4 gap-1">
            {QUALITIES.map((q) => (
              <button
                key={q}
                onClick={() => setSelectedQuality(q)}
                className={`px-2 py-1.5 rounded text-xs font-medium transition-colors ${
                  selectedQuality === q
                    ? "bg-zinc-700 text-white"
                    : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                }`}
              >
                {q}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1">
            <span className="text-xs text-zinc-500 w-8">Fret</span>
            {Array.from({ length: FRET_COUNT }, (_, i) => (
              <span
                key={i}
                className="w-7 h-5 flex items-center justify-center text-[10px] text-zinc-600"
              >
                {shape.baseFret + i}
              </span>
            ))}
          </div>

          <div className="space-y-0.5">
            {STRING_NAMES.map((name, sIdx) => (
              <div key={name} className="flex items-center gap-1">
                <span className="text-xs text-zinc-500 w-8 font-mono">{name}</span>
                {Array.from({ length: FRET_COUNT }, (_, fIdx) => {
                  const fretValue = shape.frets[sIdx];
                  const isMuted = fretValue === -1;
                  const isOpen = fretValue === 0;
                  const absoluteFret = fretValue;
                  const isAtThisFret =
                    !isMuted &&
                    !isOpen &&
                    absoluteFret === shape.baseFret + fIdx;

                  return (
                    <div
                      key={fIdx}
                      className="w-7 h-5 flex items-center justify-center"
                    >
                      {isAtThisFret && (
                        <div className="w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center">
                          <span className="text-[9px] font-bold text-black leading-none">
                            {shape.fingers[sIdx]}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-4 gap-1">
            {NOTES.map((n) => (
              <button
                key={n}
                onClick={() => setSelectedNote(n)}
                className={`px-1 py-1 rounded text-[10px] font-medium transition-colors ${
                  selectedNote === n
                    ? "bg-amber-500 text-black"
                    : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                }`}
              >
                {n.split("/")[0]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-shrink-0 flex items-center justify-center">
          <ChordDiagram note={selectedNote} quality={selectedQuality} />
        </div>
      </div>
    </div>
  );
}
