"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import type { ReactNode } from "react";
import type { BarKind } from "@/lib/types";

const THIN = 2;
const THICK = 6;
const DOT = 4;

function Dot({ x, y }: { x: number; y: number }) {
  return (
    <circle
      cx={x}
      cy={y}
      r={DOT / 2}
      fill="currentColor"
    />
  );
}

function Line({
  x,
  y1,
  y2,
  w,
}: {
  x: number;
  y1: number;
  y2: number;
  w: number;
}) {
  return (
    <rect
      x={x - w / 2}
      y={y1}
      width={w}
      height={y2 - y1}
      fill="currentColor"
    />
  );
}

function Staff() {
  const ys = [10, 16, 22, 28, 34];
  return (
    <g stroke="currentColor" strokeWidth={1} opacity={0.35}>
      {ys.map((y) => (
        <rect key={y} x={2} y={y} width={44} height={0.8} rx={0.4} />
      ))}
    </g>
  );
}

export function BarGlyph({
  kind,
  className,
}: {
  kind: BarKind;
  className?: string;
}) {
  const y1 = 8;
  const y2 = 36;

  let glyphs: ReactNode | null = null;

  switch (kind) {
    case "standard":
      glyphs = <Line x={16} y1={y1} y2={y2} w={THIN} />;
      break;
    case "double":
      glyphs = (
        <>
          <Line x={13} y1={y1} y2={y2} w={THIN} />
          <Line x={21} y1={y1} y2={y2} w={THIN} />
        </>
      );
      break;
    case "end":
      glyphs = (
        <>
          <Line x={12} y1={y1} y2={y2} w={THIN} />
          <Line x={26} y1={y1} y2={y2} w={THICK} />
        </>
      );
      break;
    case "beginRepeat":
      glyphs = (
        <>
          <Line x={8} y1={y1} y2={y2} w={THICK} />
          <Line x={18} y1={y1} y2={y2} w={THIN} />
          <Dot x={29} y={18} />
          <Dot x={29} y={26} />
        </>
      );
      break;
    case "endRepeat":
      glyphs = (
        <>
          <Dot x={15} y={18} />
          <Dot x={15} y={26} />
          <Line x={26} y1={y1} y2={y2} w={THIN} />
          <Line x={36} y1={y1} y2={y2} w={THICK} />
        </>
      );
      break;
    case "bothRepeat":
      glyphs = (
        <>
          <Line x={8} y1={y1} y2={y2} w={THICK} />
          <Line x={18} y1={y1} y2={y2} w={THIN} />
          <Dot x={27} y={18} />
          <Dot x={27} y={26} />
          <Dot x={33} y={18} />
          <Dot x={33} y={26} />
          <Line x={42} y1={y1} y2={y2} w={THIN} />
        </>
      );
      break;
  }

  return (
    <svg
      viewBox="0 0 48 44"
      width="48"
      height="44"
      className={className}
      aria-hidden="true"
    >
      <Staff />
      {glyphs}
    </svg>
  );
}