"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.

// Vue « Harmonique » d'un passage de riff : au lieu de la tablature, on affiche
// la progression d'accords interprétée mesure par mesure, avec un mini
// diagramme par accord, et on met en évidence l'accord de la mesure en cours.

import { chordFretsForLabel } from "@/lib/tab-view";
import { ChordMini } from "@/components/TabStaffView";

export default function RiffHarmonyView({
  chords,
  currentMeasure,
  measureOffset,
}: {
  chords?: Map<number, string>;
  currentMeasure: number;
  measureOffset?: number;
}) {
  const entries = [...(chords ?? new Map<number, string>()).entries()].sort(
    (a, b) => a[0] - b[0]
  );

  if (entries.length === 0) {
    return (
      <p className="text-[11px] text-zinc-600 max-w-sm text-center">
        Aucun accord interprété pour mesures de ce riff (notes trop dispersées).
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-[10px] text-zinc-500 px-1">
        {entries.length} mesure{entries.length > 1 ? "s" : ""} · accord
        {entries.length > 1 ? "s" : ""} interprété{entries.length > 1 ? "s" : ""} à partir des notes
      </div>
      <div className="flex flex-wrap gap-2">
        {entries.map(([m, label]) => {
          const frets = chordFretsForLabel(label);
          const active = m === currentMeasure;
          return (
            <div
              key={m}
              className={`flex flex-col items-center gap-1 rounded-xl border px-4 py-2 transition-all duration-150 ${
                active
                  ? "border-amber-400 bg-zinc-900 shadow-[0_0_22px_rgba(251,191,36,0.35)]"
                  : "border-zinc-800 bg-zinc-900/50 opacity-55"
              }`}
            >
              <span className="text-[9px] text-zinc-500">
                Mesure {m + 1 + (measureOffset ?? 0)}
              </span>
              <span className="text-lg font-black text-amber-300 leading-none">
                {label}
              </span>
              {frets && <ChordMini frets={frets} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}