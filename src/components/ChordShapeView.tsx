"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import type { SavedChordShape } from "@/lib/types";
import { BarGlyph } from "@/components/BarGlyph";
import { NavGlyph } from "@/components/NavGlyph";

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

interface ChordShapeViewProps {
  shape: SavedChordShape;
  onNoteClick?: (stringIndex: number) => void;
  legatoStrings?: number[];
}

function strIsMuted(shape: SavedChordShape, s: number): boolean {
  return shape.muted[s] === true;
}

export default function ChordShapeView({ shape, onNoteClick, legatoStrings }: ChordShapeViewProps) {
  const baseFret = shape.baseFret || 1;

  if (shape.silence) {
    const cx = SVG_WIDTH / 2;
    const y = SVG_HEIGHT / 2;
    return (
      <svg
        width="100%"
        height="auto"
        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
        className="mx-auto max-w-full h-auto"
        preserveAspectRatio="xMidYMid meet"
      >
        <text
          x={cx}
          y={14}
          textAnchor="middle"
          className="fill-white text-sm font-bold"
          fontSize="13"
        >
          {shape.label || "Silence"}
        </text>
        <line
          x1={cx - 26}
          y1={y - 10}
          x2={cx + 26}
          y2={y - 10}
          stroke="#52525b"
          strokeWidth={3}
        />
        <rect
          x={cx - 2}
          y={y - 8}
          width={18}
          height={16}
          rx={2}
          fill="#71717a"
        />
        <text
          x={cx}
          y={y + 40}
          textAnchor="middle"
          className="fill-zinc-600"
          fontSize="12"
        >
          Silence
        </text>
      </svg>
    );
  }

  if (shape.bar) {
    const kind = shape.barKind ?? "double";
    const isRepeat =
      kind === "beginRepeat" || kind === "endRepeat" || kind === "bothRepeat";
    return (
      <div className="flex flex-col items-center justify-center h-full gap-1 py-2">
        <BarGlyph
          kind={kind}
          className={isRepeat ? "text-amber-500 w-10 h-9" : "text-zinc-400 w-10 h-9"}
        />
        <span className="font-mono text-[10px] text-zinc-500">
          {shape.label || "||"}
        </span>
      </div>
    );
  }

  if (shape.navKind) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-1 py-2">
        <NavGlyph
          kind={shape.navKind}
          className="text-amber-500 w-10 h-9"
        />
      </div>
    );
  }

  const effectiveFret = (s: number): number => {
    let pos = 0;
    const fp = shape.fingers.find((f) => f.string === s);
    if (fp) pos = fp.fret;
    if (shape.barreOn) pos = Math.max(baseFret, pos);
    return Math.max(shape.capo || 0, pos);
  };

  return (
    <div className="relative">
      {shape.ending && (
        <span
          className={`absolute -top-1 right-0 text-[10px] font-mono font-bold px-1 rounded ${
            shape.ending === 1 ? "bg-sky-500/20 text-sky-300" : "bg-amber-500/20 text-amber-300"
          }`}
        >
          {shape.ending}.
        </span>
      )}
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
        {shape.label}
      </text>

      {STRING_NAMES.map((name, sIdx) => {
        const x = PADDING + sIdx * STRING_SPACING;
        const isMutedStr = strIsMuted(shape, sIdx);
        const isOpen = !isMutedStr && effectiveFret(sIdx) === 0;
        return (
          <g key={`top-${sIdx}`}>
            <text
              x={x}
              y={24}
              textAnchor="middle"
              className={isMutedStr ? "fill-red-400 font-bold" : "fill-zinc-400"}
              fontSize="12"
              fontFamily="monospace"
            >
              {isMutedStr ? "X" : name}
            </text>
            {isOpen && (
              <circle
                cx={x}
                cy={MARKER_Y}
                r={5}
                fill="none"
                stroke="#22c55e"
                strokeWidth="2"
              />
            )}
          </g>
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
            {baseFret + i}
          </text>
        );
      })}

      {shape.capo > 0 && shape.capo >= baseFret && shape.capo <= baseFret + FRET_COUNT - 1 && (() => {
        const capoRow = shape.capo - baseFret;
        const x1 = PADDING - 2;
        const x2 = PADDING + 5 * STRING_SPACING + 2;
        return (
          <g key="capo">
            <line
              x1={x1}
              y1={NUT_Y + (capoRow + 0.5) * FRET_SPACING}
              x2={x2}
              y2={NUT_Y + (capoRow + 0.5) * FRET_SPACING}
              stroke="#a78bfa"
              strokeWidth={3}
            />
            <text
              x={x2 + 6}
              y={NUT_Y + (capoRow + 0.5) * FRET_SPACING + 3}
              textAnchor="start"
              className="fill-violet-400"
              fontSize="10"
              fontWeight="bold"
            >
              Capo
            </text>
          </g>
        );
      })()}

      {shape.barreOn && (() => {
        const first = STRING_COUNT - (shape.barreCount || STRING_COUNT);
        const last = STRING_COUNT - 1;
        const x1 = PADDING + first * STRING_SPACING - 2;
        const x2 = PADDING + last * STRING_SPACING + 2;
        return (
          <g key="barre">
            <rect
              x={x1}
              y={NUT_Y + FRET_SPACING * 0.22}
              width={x2 - x1}
              height={FRET_SPACING * 0.56}
              rx={7}
              fill="#f59e0b"
              fillOpacity={0.35}
              stroke="#f59e0b"
              strokeWidth={1.5}
            />
            <text
              x={x1 - 8}
              y={NUT_Y + FRET_SPACING / 2 + 4}
              textAnchor="end"
              className="fill-black"
              fontSize="10"
              fontWeight="bold"
            >
              1
            </text>
          </g>
        );
      })()}

      {shape.fingers.map((f) => {
        const x = PADDING + f.string * STRING_SPACING;
        if (strIsMuted(shape, f.string)) return null;
        const row = f.fret - baseFret;
        if (row < 0 || row >= FRET_COUNT) return null;
        const cy = NUT_Y + row * FRET_SPACING + FRET_SPACING / 2;
        const isLegatoSrc = legatoStrings?.includes(f.string);
        return (
          <g
            key={`dot-${f.string}-${f.fret}-${f.finger}`}
            onClick={onNoteClick ? () => onNoteClick(f.string) : undefined}
            style={onNoteClick ? { cursor: "pointer" } : undefined}
          >
            <circle cx={x} cy={cy} r={9} fill="#f59e0b" />
            <text
              x={x}
              y={cy + 4}
              textAnchor="middle"
              className="fill-black"
              fontSize="11"
              fontWeight="bold"
            >
{f.finger === 5 ? "T" : f.finger}
            </text>
            {isLegatoSrc && (
              <circle cx={x} cy={cy} r={14} fill="none" stroke="#38bdf8" strokeWidth={2.5} />
            )}
          </g>
        );
      })}
    </svg>
    </div>
  );
}