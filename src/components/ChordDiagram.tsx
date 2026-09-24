"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import {
  getChordShape,
  formatChordName,
  type NoteName,
  type ChordQuality,
} from "@/lib/chord-data";

interface ChordDiagramProps {
  note: NoteName;
  quality: ChordQuality;
  label?: string;
}

const STRING_NAMES = ["E", "A", "D", "G", "B", "e"];
const STRING_COUNT = 6;
const STRING_SPACING = 28;
const FRET_COUNT = 5;
const FRET_SPACING = 40;
const PADDING = 50;
const PADDING_TOP = 54;
const SVG_WIDTH = PADDING + STRING_SPACING * 5 + PADDING;
const SVG_HEIGHT = PADDING_TOP + FRET_COUNT * FRET_SPACING + 20;
const NUT_Y = PADDING_TOP;
const MARKER_Y = PADDING_TOP - 16;

export default function ChordDiagram({ note, quality, label }: ChordDiagramProps) {
  const shape = getChordShape(note, quality);
  const chordName = label ?? formatChordName(note, quality);

  return (
    <svg
      width="100%"
      height="auto"
      viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
      className="mx-auto max-w-full h-auto"
      preserveAspectRatio="xMidYMid meet"
    >
      <text
        x={SVG_WIDTH / 2}
        y={14}
        textAnchor="middle"
        className="fill-white text-sm font-bold"
        fontSize="13"
      >
        {chordName}
      </text>

      {STRING_NAMES.map((name, sIdx) => {
        const x = PADDING + sIdx * STRING_SPACING;
        return (
          <text
            key={`name-${sIdx}`}
            x={x}
            y={30}
            textAnchor="middle"
            className="fill-zinc-400"
            fontSize="11"
            fontFamily="monospace"
          >
            {name}
          </text>
        );
      })}

      {Array.from({ length: 6 }, (_, i) => {
        const x = PADDING + i * STRING_SPACING;
        return (
          <line
            key={`string-${i}`}
            x1={x}
            y1={MARKER_Y - 4}
            x2={x}
            y2={NUT_Y + FRET_COUNT * FRET_SPACING}
            stroke="#52525b"
            strokeWidth={1 + i * 0.2}
          />
        );
      })}

      <line
        x1={PADDING}
        y1={NUT_Y}
        x2={PADDING + 5 * STRING_SPACING}
        y2={NUT_Y}
        stroke="#71717a"
        strokeWidth={3}
      />

      {Array.from({ length: FRET_COUNT }, (_, i) => {
        const y = NUT_Y + (i + 1) * FRET_SPACING;
        return (
          <line
            key={`fret-${i}`}
            x1={PADDING}
            y1={y}
            x2={PADDING + 5 * STRING_SPACING}
            y2={y}
            stroke="#3f3f46"
            strokeWidth={1}
          />
        );
      })}

      {Array.from({ length: FRET_COUNT }, (_, i) => {
        const y = NUT_Y + i * FRET_SPACING + FRET_SPACING / 2;
        return (
          <text
            key={`fretnum-${i}`}
            x={PADDING - 16}
            y={y + 3}
            textAnchor="end"
            className="fill-zinc-600"
            fontSize="11"
          >
            {shape.baseFret + i}
          </text>
        );
      })}

      {STRING_NAMES.map((name, sIdx) => {
        const x = PADDING + sIdx * STRING_SPACING;
        const fretValue = shape.frets[sIdx];
        const isMuted = fretValue === -1;
        const isOpen = fretValue === 0;

        if (isMuted) {
          return (
            <text
              key={`marker-${sIdx}`}
              x={x}
              y={MARKER_Y + 4}
              textAnchor="middle"
              className="fill-red-400"
              fontSize="13"
              fontWeight="bold"
            >
              X
            </text>
          );
        }

        if (isOpen) {
          return (
            <circle
              key={`marker-${sIdx}`}
              cx={x}
              cy={MARKER_Y}
              r={5}
              fill="none"
              stroke="#22c55e"
              strokeWidth="2"
            />
          );
        }

        const fretIdx = fretValue - shape.baseFret;
        if (fretIdx >= 0 && fretIdx < FRET_COUNT) {
          const cy = NUT_Y + fretIdx * FRET_SPACING + FRET_SPACING / 2;
          return (
            <circle key={`dot-${sIdx}`} cx={x} cy={cy} r={9} fill="#f59e0b" />
          );
        }

        return null;
      })}

      {STRING_NAMES.map((name, sIdx) => {
        const x = PADDING + sIdx * STRING_SPACING;
        const fretValue = shape.frets[sIdx];
        const isMuted = fretValue === -1;
        const isOpen = fretValue === 0;
        const fretIdx = fretValue - shape.baseFret;

        if (
          !isMuted &&
          !isOpen &&
          fretIdx >= 0 &&
          fretIdx < FRET_COUNT
        ) {
          const cy = NUT_Y + fretIdx * FRET_SPACING + FRET_SPACING / 2;
          return (
            <text
              key={`finger-${sIdx}`}
              x={x}
              y={cy + 4}
              textAnchor="middle"
              className="fill-black"
              fontSize="11"
              fontWeight="bold"
            >
              {shape.fingers[sIdx]}
            </text>
          );
        }
        return null;
      })}
    </svg>
  );
}
