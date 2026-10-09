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
import { cagedVoicings } from "@/lib/caged";
import { MODES, modeRoots, modeTonicChord } from "@/lib/modes";
import { BookOpen } from "lucide-react";

export default function ChordDictionaryPage() {
  const [selectedNote, setSelectedNote] = useState<NoteName>(NOTES[0]);
  const [selectedQuality, setSelectedQuality] = useState<ChordQuality>(
    QUALITIES[0]
  );

  const chordName = formatChordName(selectedNote, selectedQuality);
  const caged = cagedVoicings(selectedNote, selectedQuality);
  const roots = modeRoots(selectedNote);
  const parentName = selectedNote.split("/")[0];

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

        <div className="w-full max-w-5xl mt-6 bg-zinc-900 border border-zinc-700 rounded-xl p-4">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h2 className="text-lg font-bold text-white">Système CAGED</h2>
            <span className="text-[10px] uppercase tracking-wide text-zinc-500">
              5 formes · capo
            </span>
          </div>
          {caged.length > 0 ? (
            <>
              <p className="text-zinc-500 text-xs mb-4">
                {chordName} : place un capo sur la case indiquée, puis joue la
                forme ouverte correspondante.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {caged.map((v) => (
                  <div
                    key={v.form}
                    className="flex flex-col items-center gap-1 rounded-lg bg-zinc-800/40 border border-zinc-800 p-2"
                  >
                    <ChordDiagram
                      note={selectedNote}
                      quality={selectedQuality}
                      label={chordName}
                      shape={v.shape}
                      capo={v.capo}
                    />
                    <div className="text-center leading-tight">
                      <div className="text-[11px] font-bold text-amber-400">
                        Forme {v.form}
                      </div>
                      <div className="text-[10px] text-zinc-500">
                        {v.capo === 0 ? "sans capo" : `capo ${v.capo}`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-zinc-500 text-xs">
              Le système CAGED s&apos;illustre sur les accords majeurs, mineurs et
              de septième : choisis Maj, Min, 7, min7 ou maj7 pour afficher les 5
              positions (C‑A‑G‑E‑D) avec capo.
            </p>
          )}
        </div>

        <div className="w-full max-w-5xl mt-6 bg-zinc-900 border border-zinc-700 rounded-xl p-4">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h2 className="text-lg font-bold text-white">
              Les modes de la gamme majeure
            </h2>
            <span className="text-[10px] uppercase tracking-wide text-zinc-500">
              7 modes · relatifs
            </span>
          </div>
          <p className="text-zinc-500 text-xs mb-4">
            Un mode, c&apos;est la gamme majeure vue depuis un autre degré. Les 7
            modes ci-dessous partagent les mêmes notes que {parentName} majeur :
            seule la tonique se déplace, ce qui déplace les tons et demi‑tons et
            change la couleur. L&apos;accord tonique indique le type d&apos;accord
            sur lequel le mode sonne le mieux.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="text-zinc-500 uppercase text-[10px] tracking-wide">
                  <th className="py-1.5 pr-3 font-semibold">Degré</th>
                  <th className="py-1.5 pr-3 font-semibold">Fond.</th>
                  <th className="py-1.5 pr-3 font-semibold">Formule</th>
                  <th className="py-1.5 pr-3 font-semibold">Note carac.</th>
                  <th className="py-1.5 pr-3 font-semibold">Accord tonique</th>
                  <th className="py-1.5 pr-3 font-semibold">Couleur</th>
                  <th className="py-1.5 font-semibold">Exemple</th>
                </tr>
              </thead>
              <tbody>
                {MODES.map((mode, i) => {
                  const root = roots[i];
                  return (
                    <tr
                      key={mode.name}
                      className="border-t border-zinc-800 align-top"
                    >
                      <td className="py-1.5 pr-3 whitespace-nowrap">
                        <span className="text-amber-400 font-bold">
                          {mode.roman}
                        </span>{" "}
                        <span className="text-zinc-200">{mode.name}</span>
                      </td>
                      <td className="py-1.5 pr-3 text-zinc-300 whitespace-nowrap">
                        {root.split("/")[0]}
                      </td>
                      <td className="py-1.5 pr-3 text-zinc-400 font-mono whitespace-nowrap">
                        {mode.intervals}
                      </td>
                      <td
                        className="py-1.5 pr-3 text-zinc-400 whitespace-nowrap cursor-help"
                        title={mode.charHelp}
                      >
                        {mode.charNote}
                      </td>
                      <td className="py-1.5 pr-3 text-amber-300 whitespace-nowrap">
                        {modeTonicChord(mode, root)}
                      </td>
                      <td className="py-1.5 pr-3 text-zinc-400">{mode.mood}</td>
                      <td className="py-1.5 text-zinc-500">{mode.example}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-zinc-600 text-[11px] mt-3">
            Astuce : survole la{" "}
            <span className="text-zinc-400">note caractéristique</span> pour
            comprendre ce qui donne à chaque mode sa couleur — c&apos;est elle
            qu&apos;on vise en solo.
          </p>
        </div>
      </main>
    </div>
  );
}