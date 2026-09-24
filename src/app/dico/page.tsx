"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { useState } from "react";
import {
  NOTES,
  QUALITIES,
  formatChordName,
  type NoteName,
  type ChordQuality,
} from "@/lib/chord-data";
import ChordDiagram from "@/components/ChordDiagram";
import { BookOpen } from "lucide-react";

export default function ChordDictionaryPage() {
  const [selectedNote, setSelectedNote] = useState<NoteName>(NOTES[0]);
  const [selectedQuality, setSelectedQuality] = useState<ChordQuality>(
    QUALITIES[0]
  );

  return (
    <div className="flex flex-col items-center min-h-screen">
      <header className="w-full pt-12 pb-6">
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-amber-400" />
            Dictionnaire d&apos;accords
          </h1>
          <p className="text-zinc-500 text-sm">Tous les accords de guitare</p>
        </div>
      </header>

      <main className="flex-1 w-full flex flex-col items-center px-4 pb-16">
        <div className="w-full max-w-5xl bg-zinc-900 border border-zinc-700 rounded-xl p-4 flex flex-col lg:flex-row items-center gap-6">
          <div className="flex-1 w-full overflow-x-auto">
            {NOTES.map((note) => (
              <div key={note} className="mb-4">
                <div className="text-xs font-bold text-amber-400 mb-1.5">
                  {note.split("/")[0]}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {QUALITIES.map((q) => {
                    const name = formatChordName(note, q);
                    const active =
                      note === selectedNote && q === selectedQuality;
                    return (
                      <button
                        key={q}
                        onClick={() => {
                          setSelectedNote(note);
                          setSelectedQuality(q);
                        }}
                        className={`px-2 py-1 rounded text-[11px] font-medium whitespace-nowrap transition-colors ${
                          active
                            ? "bg-amber-500 text-black"
                            : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                        }`}
                      >
                        {name}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="flex-shrink-0">
            <ChordDiagram note={selectedNote} quality={selectedQuality} />
          </div>
        </div>
      </main>
    </div>
  );
}