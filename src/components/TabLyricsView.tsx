"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.

// Paroles sous la tablature animee du Studio.
//
// Le composant ne possede pas d'horloge : il lit `getTime()` (celle de l'apercu
// « Ecouter tout ») et ne se re-rend que lorsque la ligne courante change. Deux
// modes de calage :
// - lignes horodatees (paroles officielles LRC recalees sur la grille) ;
// - sinon, repartition reguliere sur la duree de la tablature.

import { memo, useEffect, useMemo, useRef, useState } from "react";

export interface TabLyricLine {
  /** Section du morceau (« Verse 1 »...). */
  label: string;
  text: string;
  /** Temps d'apparition en secondes, ou null si non horodate. */
  time: number | null;
}

interface TabLyricsViewProps {
  lines: TabLyricLine[];
  /** Horloge de l'apercu, en secondes. */
  getTime: () => number;
  /** Decalage global des paroles (secondes), comme dans le Chef. */
  offset?: number;
  /** Duree de la tablature (secondes), pour le calage sans horodatage. */
  duration: number;
  className?: string;
}

export default memo(function TabLyricsView({
  lines,
  getTime,
  offset = 0,
  duration,
  className,
}: TabLyricsViewProps) {
  const times = useMemo(() => {
    const timed = lines.some((line) => line.time !== null);
    if (timed) {
      return lines.map((line) => Math.max(0, (line.time ?? 0) + offset));
    }
    const step = duration > 0 ? duration / Math.max(1, lines.length) : 0;
    return lines.map((_, index) => Math.max(0, index * step + offset));
  }, [lines, offset, duration]);

  const [index, setIndex] = useState(-1);
  const indexRef = useRef(-1);

  useEffect(() => {
    let raf = 0;
    let last = Number.NaN;
    const frame = () => {
      const time = getTime();
      if (time !== last) {
        last = time;
        let next = -1;
        for (let i = 0; i < times.length; i++) {
          if (times[i] <= time) next = i;
          else break;
        }
        if (next !== indexRef.current) {
          indexRef.current = next;
          setIndex(next);
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [getTime, times]);

  if (lines.length === 0) return null;

  const current = index >= 0 ? lines[index] : null;
  const previous = index > 0 ? lines[index - 1] : null;
  const next =
    index >= 0
      ? index < lines.length - 1
        ? lines[index + 1]
        : null
      : lines[0];

  return (
    <div
      className={`rounded-xl border border-zinc-800 bg-zinc-950/80 px-4 py-2.5 ${className ?? ""}`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          Paroles
        </span>
        {current?.label && (
          <span className="text-[10px] text-zinc-600 truncate">
            {current.label}
          </span>
        )}
        <span className="ml-auto text-[10px] text-zinc-700 font-mono">
          {index >= 0 ? index + 1 : 0} / {lines.length}
        </span>
      </div>
      <p className="h-5 truncate text-xs text-zinc-600">{previous?.text ?? ""}</p>
      <p className="min-h-7 text-base sm:text-lg font-semibold text-amber-300 leading-7">
        {current?.text ?? (
          <span className="text-zinc-600 text-sm font-normal">
            {next ? "À venir…" : ""}
          </span>
        )}
      </p>
      <p className="h-5 truncate text-xs text-zinc-500">{next?.text ?? ""}</p>
    </div>
  );
});
