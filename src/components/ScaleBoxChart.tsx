"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import type { PentBox } from "@/lib/pentatonic";
import { pitchClassName } from "@/lib/pentatonic";

const ROW_H = 22; // hauteur d'une corde
const COL_W = 30; // largeur d'une case
const LEFT = 34; // noms de cordes
const TOP = 24; // numéros de cases
const COLS = 5;
const ROWS = 6;
const WIDTH = LEFT + COLS * COL_W + 6;
const HEIGHT = TOP + ROWS * ROW_H + 4;

// Corde affichée en haut = mi aigu (index 5 → ligne 0).
const LINE_LABELS = ["e", "B", "G", "D", "A", "E"];

export default function ScaleBoxChart({ box }: { box: PentBox }) {
  const { fretStart, positions } = box;

  const positionByCell = (s: number, col: number) =>
    positions.find((p) => p.string === s && p.fret === fretStart + col);

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="mx-auto max-w-full h-auto"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Position ${fretStart}`}
    >
      {/* cordes (lignes horizontales) */}
      {[0, 1, 2, 3, 4, 5].map((row) => {
        const s = 5 - row;
        const y = TOP + row * ROW_H + ROW_H / 2;
        return (
          <g key={`row-${s}`}>
            <line
              x1={LEFT}
              y1={y}
              x2={LEFT + COLS * COL_W}
              y2={y}
              stroke="#52525b"
              strokeWidth={1 + 0.2 * row}
            />
            <text
              x={LEFT - 6}
              y={y + 3}
              textAnchor="end"
              className="fill-zinc-500"
              fontSize="10"
              fontFamily="monospace"
            >
              {LINE_LABELS[row]}
            </text>
          </g>
        );
      })}

      {/* cases (lignes verticales) */}
      {[0, 1, 2, 3, 4, 5].map((col) => {
        const x = LEFT + col * COL_W;
        return (
          <line
            key={`col-${col}`}
            x1={x}
            y1={TOP}
            x2={x}
            y2={TOP + ROWS * ROW_H}
            stroke={col === 0 ? "#71717a" : "#3f3f46"}
            strokeWidth={col === 0 ? 3 : 1}
          />
        );
      })}

      {/* numéros de cases */}
      {[0, 1, 2, 3, 4].map((col) => (
        <text
          key={`fret-${col}`}
          x={LEFT + col * COL_W + COL_W / 2}
          y={TOP - 6}
          textAnchor="middle"
          className="fill-zinc-600"
          fontSize="9"
          fontFamily="monospace"
        >
          {fretStart + col}
        </text>
      ))}

      {/* notes */}
      {[0, 1, 2, 3, 4, 5].map((row) => {
        const s = 5 - row;
        const y = TOP + row * ROW_H + ROW_H / 2;
        return [0, 1, 2, 3, 4].map((col) => {
          const pos = positionByCell(s, col);
          if (!pos) return null;
          const x = LEFT + col * COL_W + COL_W / 2;
          return (
            <g key={`dot-${s}-${col}`}>
              <circle
                cx={x}
                cy={y}
                r={pos.isRoot ? 10 : 8}
                fill={pos.isRoot ? "#f59e0b" : "#3f3f46"}
                stroke={pos.isRoot ? "#fbbf24" : "#52525b"}
                strokeWidth={1}
              />
              <text
                x={x}
                y={y + 3}
                textAnchor="middle"
                className={pos.isRoot ? "fill-black" : "fill-zinc-200"}
                fontSize={pos.isRoot ? "9.5" : "8.5"}
                fontWeight={pos.isRoot ? "bold" : "normal"}
              >
                {pitchClassName(pos.pc)}
              </text>
            </g>
          );
        });
      })}
    </svg>
  );
}