"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import type { NavKind } from "@/lib/types";

export const NAV_KIND_TEXT: Record<NavKind, string> = {
  segno: "",
  coda: "",
  fine: "Fine",
  dc: "D.C.",
  ds: "D.S.",
  dcAlCoda: "D.C. al Coda",
  dsAlCoda: "D.S. al Coda",
  dcAlFine: "D.C. al Fine",
  dsAlFine: "D.S. al Fine",
};

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

function SegnoGlyph() {
  return (
    <g>
      <path
        d="M 18 14 C 14 10, 10 12, 14 17 C 18 21, 30 25, 34 30 C 38 35, 34 39, 28 37"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.4}
      />
      <line
        x1={12}
        y1={40}
        x2={38}
        y2={12}
        stroke="currentColor"
        strokeWidth={2.4}
      />
      <circle cx={8} cy={12} r={2.6} fill="currentColor" />
      <circle cx={40} cy={38} r={2.6} fill="currentColor" />
    </g>
  );
}

function CodaGlyph() {
  const cx = 24;
  const cy = 22;
  return (
    <g>
      <circle
        cx={cx}
        cy={cy}
        r={13}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.4}
      />
      <path
        d={`M ${cx - 8} ${cy - 8} L ${cx + 8} ${cy + 8} M ${cx + 8} ${cy - 8} L ${cx - 8} ${cy + 8}`}
        stroke="currentColor"
        strokeWidth={2.4}
      />
    </g>
  );
}

export function NavGlyph({
  kind,
  className,
}: {
  kind: NavKind;
  className?: string;
}) {
  if (kind === "segno") {
    return (
      <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
        <Staff />
        <SegnoGlyph />
      </svg>
    );
  }
  if (kind === "coda") {
    return (
      <svg viewBox="0 0 48 44" className={className} aria-hidden="true">
        <Staff />
        <CodaGlyph />
      </svg>
    );
  }
  return (
    <span className={`font-serif italic font-bold ${className ?? ""}`}>
      {NAV_KIND_TEXT[kind]}
    </span>
  );
}