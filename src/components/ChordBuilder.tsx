"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { useState, useCallback, useRef, useEffect } from "react";
import type { SavedChordShape } from "@/lib/types";

const STRING_NAMES = ["E", "A", "D", "G", "B", "e"];
const OPEN_PC = [4, 9, 2, 7, 11, 4];
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

const NOTE_NAMES = [
  "C",
  "C#/Db",
  "D",
  "D#/Eb",
  "E",
  "F",
  "F#/Gb",
  "G",
  "G#/Ab",
  "A",
  "A#/Bb",
  "B",
];

const FINGER_LABELS: Record<number, string> = {
  1: "Index",
  2: "Majeur",
  3: "Annulaire",
  4: "Auriculaire",
};

interface QualityDef {
  suffix: string;
  iv: number[];
}

const QUALITIES: QualityDef[] = [
  { suffix: "", iv: [0, 4, 7] },
  { suffix: "m", iv: [0, 3, 7] },
  { suffix: "+", iv: [0, 4, 8] },
  { suffix: "dim", iv: [0, 3, 6] },
  { suffix: "sus2", iv: [0, 2, 7] },
  { suffix: "sus4", iv: [0, 5, 7] },
  { suffix: "7", iv: [0, 4, 7, 10] },
  { suffix: "m7", iv: [0, 3, 7, 10] },
  { suffix: "maj7", iv: [0, 4, 7, 11] },
  { suffix: "dim7", iv: [0, 3, 6, 9] },
  { suffix: "m7b5", iv: [0, 3, 6, 10] },
  { suffix: "mMaj7", iv: [0, 3, 7, 11] },
  { suffix: "+7", iv: [0, 4, 8, 10] },
];

export interface PlacedFinger {
  string: number;
  fret: number;
  finger: number;
}

function noteName(pc: number): string {
  return NOTE_NAMES[((pc % 12) + 12) % 12];
}

function identifyChord(played: number[], bass: number): string | null {
  const set = new Set(played);
  if (set.size === 0) return null;

  let best: { name: string; score: number; exact: boolean } | null = null;
  for (const root of set) {
    for (const q of QUALITIES) {
      const tones = q.iv.map((i) => ((root + i) % 12 + 12) % 12);
      const chordSet = new Set(tones);
      const extra = [...set].filter((pc) => !chordSet.has(pc));
      const extraAllowed = extra.length === 0 || (extra.length === 1 && extra[0] === bass);
      const isExact = extraAllowed;
      if (!isExact) continue;

      const score =
        (extra.length === 0 ? 5 : 0) +
        (bass === root ? 10 : 0) +
        chordSet.size;
      if (!best || score > best.score) {
        const base = noteName(root) + q.suffix;
        best = {
          name: bass === root ? base : `${base}/${noteName(bass)}`,
          score,
          exact: true,
        };
      }
    }
  }
  if (best) return best.name;

  let approx: { name: string; score: number } | null = null;
  for (const root of set) {
    for (const q of QUALITIES) {
      const tones = q.iv.map((i) => ((root + i) % 12 + 12) % 12);
      const chordSet = new Set(tones);
      if (!chordSet.has(bass)) continue;
      let coverage = 0;
      for (const pc of set) {
        if (chordSet.has(pc)) coverage++;
      }
      const score = coverage * 10 + (bass === root ? 5 : 0) + chordSet.size;
      if (coverage >= 3 && (!approx || score > approx.score)) {
        const base = noteName(root) + q.suffix;
        approx = {
          name: bass === root ? base : `${base}/${noteName(bass)}`,
          score,
        };
      }
    }
  }
  return approx ? `≈ ${approx.name}` : null;
}

interface ChordBuilderProps {
  onChord?: (name: string) => void;
  onShape?: (shape: SavedChordShape) => void;
  onSaveShape?: (shape: SavedChordShape) => void;
}

type Tool = 1 | 2 | 3 | 4;

export default function ChordBuilder({ onChord, onShape, onSaveShape }: ChordBuilderProps) {
  const [fingers, setFingers] = useState<PlacedFinger[]>([]);
  const [barreOn, setBarreOn] = useState(false);
  const [barreCount, setBarreCount] = useState(6);
  const [muted, setMuted] = useState<boolean[]>(Array(STRING_COUNT).fill(false));
  const [tool, setTool] = useState<Tool>(1);
  const [autoMode, setAutoMode] = useState(true);
  const [baseFret, setBaseFret] = useState(1);
  const [capo, setCapo] = useState(0);
  const notifyRef = useRef(onChord);
  const shapeNotifyRef = useRef(onShape);
  const saveShapeRef = useRef(onSaveShape);

  useEffect(() => {
    notifyRef.current = onChord;
    shapeNotifyRef.current = onShape;
    saveShapeRef.current = onSaveShape;
  }, [onChord, onShape, onSaveShape]);

  const barreStrings = useCallback((): number[] => {
    if (!barreOn) return [];
    const out: number[] = [];
    for (let s = STRING_COUNT - barreCount; s < STRING_COUNT; s++) out.push(s);
    return out;
  }, [barreOn, barreCount]);

  const effectiveFret = useCallback(
    (s: number): number => {
      const fp = fingers.find((f) => f.string === s);
      const inBarre = barreStrings().includes(s);
      const barre = inBarre && barreOn ? baseFret : 0;
      const finger = fp ? baseFret + fp.fret : 0;
      if (finger > 0 && barre > 0) return Math.max(barre, finger);
      const pos = finger || barre;
      return Math.max(capo, pos);
    },
    [fingers, barreOn, barreStrings, baseFret, capo]
  );

  const buildState = useCallback(() => {
    const pcs: number[] = [];
    let bass: number | null = null;
    for (let s = 0; s < STRING_COUNT; s++) {
      if (muted[s]) continue;
      const fret = effectiveFret(s);
      const pc = ((OPEN_PC[s] + fret) % 12 + 12) % 12;
      pcs.push(pc);
      if (bass === null) bass = pc;
    }
    if (pcs.length === 0) {
      return { chordName: "", hint: "Poser des doigts sur le manche", pcs: [] };
    }
    const chordName = identifyChord(pcs, bass as number);
    const hint = !chordName
      ? "Accord non reconnu — ouvrez ou mutez les cordes avec les boutons sous le manche"
      : "";
    return { chordName, hint, pcs };
  }, [muted, effectiveFret]);

  const { chordName, hint, pcs } = buildState();

  const toggleMute = useCallback((s: number) => {
    setMuted((prev) => prev.map((m, i) => (i === s ? !m : m)));
  }, []);

  const toggleBarre = useCallback(() => {
    setBarreOn((prev) => {
      const next = !prev;
      if (next) setFingers((fps) => fps.filter((p) => p.finger !== 1));
      return next;
    });
  }, []);

  const toggleFinger = useCallback(
    (s: number, fret: number, finger: number) => {
      if (finger === 0) {
        setFingers((prev) => {
          const onThis = prev.find((p) => p.string === s);
          let next: PlacedFinger[];
          if (onThis) {
            next = prev.filter((p) => p.string !== s);
          } else {
            next = [...prev, { string: s, fret, finger: 0 }];
          }
          const sorted = [...next].sort(
            (a, b) => a.fret - b.fret || a.string - b.string
          );
          return sorted.map((p, i) => ({ ...p, finger: i + 1 }));
        });
        return;
      }
      setFingers((prev) => {
        const onThis = prev.find((p) => p.string === s && p.finger === finger);
        if (onThis) {
          return prev.filter((p) => !(p.string === s && p.finger === finger));
        }
        const others = prev.filter((p) => p.finger !== finger);
        return [...others, { string: s, fret, finger }];
      });
    },
    []
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const scale = rect.width / SVG_WIDTH;
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;

      if (x < PADDING - 8 || x > PADDING + 5 * STRING_SPACING + 8) return;

      if (y < NUT_Y) {
        const s = Math.round((x - PADDING) / STRING_SPACING);
        if (s >= 0 && s < STRING_COUNT) {
          const fretted =
            Boolean(fingers.find((f) => f.string === s)) ||
            barreStrings().includes(s);
          if (!fretted) toggleMute(s);
        }
        return;
      }
      if (y < NUT_Y || y > NUT_Y + FRET_COUNT * FRET_SPACING) return;

      const s = Math.round((x - PADDING) / STRING_SPACING);
      const f = Math.floor((y - NUT_Y) / FRET_SPACING);
      if (s < 0 || s >= STRING_COUNT || f < 0 || f >= FRET_COUNT) return;

      toggleFinger(s, f, autoMode ? 0 : tool);
    },
    [autoMode, tool, toggleFinger, toggleMute, fingers, barreStrings]
  );

  const clearAll = useCallback(() => {
    setFingers([]);
    setBarreOn(false);
    setMuted(Array(STRING_COUNT).fill(false));
    setCapo(0);
    setBaseFret(1);
  }, []);

  const fingerAt = (s: number) => fingers.find((f) => f.string === s);

  const syncName = () => {
    if (notifyRef.current && chordName) notifyRef.current(chordName);
  };

  const reportShape = useCallback(
    (shape: SavedChordShape | null) => {
      if (!shapeNotifyRef.current) return;
      if (!shape) {
        shapeNotifyRef.current({ id: "", label: "", fingers: [], barreOn: false, barreCount: 6, muted: [], baseFret, capo });
        return;
      }
      shapeNotifyRef.current(shape);
    },
    [baseFret, capo]
  );

  const buildShape = useCallback((): SavedChordShape | null => {
    const hasNotes = pcs.length > 0;
    if (!hasNotes) return null;
    return {
      id: `${chordName}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: chordName || "?",
      fingers: fingers.map((f) => ({ string: f.string, fret: f.fret + baseFret, finger: f.finger })),
      barreOn,
      barreCount,
      muted,
      baseFret,
      capo,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chordName, fingers, barreOn, barreCount, muted, baseFret, capo]);

  const saveShape = () => {
    const shape = buildShape();
    if (!shape) return;
    if (saveShapeRef.current) {
      saveShapeRef.current(shape);
    } else {
      reportShape(shape);
    }
  };

  useEffect(() => {
    if (notifyRef.current && chordName) {
      notifyRef.current(chordName);
    }
  }, [chordName]);

  useEffect(() => {
    const shape = buildShape();
    if (shape) {
      reportShape(shape);
    } else {
      reportShape(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chordName, fingers, barreOn, barreCount, muted, baseFret, capo]);

  const needsFingers = fingers.length === 0 && !barreOn;

  return (
    <div className="bg-zinc-800/40 border border-zinc-700/50 rounded-lg p-3">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div>
          <p className="text-sm font-bold text-amber-400 flex items-center gap-2">
            {chordName || "—"}
            {chordName && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-green-400 bg-green-500/10 border border-green-500/40 rounded-full px-2 py-0.5">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                Accord reconnu
              </span>
            )}
          </p>
          <p className="text-[10px] text-zinc-500">
            {hint || (needsFingers ? "Placez un barré ou des doigts sur le manche" : "Accord détecté")}
          </p>
          {pcs.length > 0 && (
            <p className="text-[10px] text-zinc-600 mt-0.5">
              Notes : {[...new Set(pcs)].map(noteName).join(" · ") || "—"}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {chordName && (
            <button
              onClick={saveShape}
              title={onSaveShape || onShape ? "Ajouter ce diagramme" : "Copier ce diagramme"}
              className="text-[10px] px-2 py-1 rounded bg-sky-500 text-black hover:bg-sky-400 transition-colors"
            >
              Ajouter
            </button>
          )}
          {onChord && chordName && (
            <button
              onClick={syncName}
              className="text-[10px] px-2 py-1 rounded bg-amber-500 text-black hover:bg-amber-400 transition-colors"
            >
              Utiliser
            </button>
          )}
          <button
            onClick={clearAll}
            className="text-[10px] px-2 py-1 rounded bg-zinc-700 text-zinc-300 hover:bg-zinc-600 transition-colors"
          >
            Effacer
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1.5 mb-2 flex-wrap">
        <button
          onClick={() => setAutoMode((v) => !v)}
          className={`px-2.5 py-1.5 rounded text-[10px] font-semibold transition-colors ${
            autoMode
              ? "bg-emerald-500 text-black"
              : "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
          }`}
        >
          Auto (main)
        </button>
        <label
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[10px] font-semibold cursor-pointer select-none transition-colors ${
            barreOn
              ? "bg-amber-500 text-black"
              : "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
          }`}
        >
          <input
            type="checkbox"
            checked={barreOn}
            onChange={() => toggleBarre()}
            className="accent-amber-500"
          />
          1· Barré (Index)
        </label>
        {barreOn && (
          <div className="flex items-center gap-1 ml-1">
            <span className="text-[10px] text-zinc-500 whitespace-nowrap">cordes :</span>
            {[2, 3, 4, 5, 6].map((n) => (
              <button
                key={n}
                onClick={() => setBarreCount(n)}
                className={`w-7 h-7 rounded text-[10px] font-bold transition-colors ${
                  barreCount === n
                    ? "bg-amber-500 text-black"
                    : "bg-zinc-700 text-zinc-400 hover:bg-zinc-600"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        )}
        {[1, 2, 3, 4].map((n) => (
          <button
            key={n}
            onClick={() => { setAutoMode(false); setTool(n as Tool); }}
            className={`px-2.5 py-1.5 rounded text-[10px] font-semibold transition-colors ${
              tool === n
                ? "bg-amber-500 text-black"
                : n === 1
                  ? "bg-zinc-700/40 text-zinc-400 hover:bg-zinc-600"
                  : "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
            }`}
          >
            {n}· {FINGER_LABELS[n]}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 mb-3">
        <span className="text-[10px] text-zinc-500 whitespace-nowrap">
          Manche : fr. {baseFret} – {Math.min(24, baseFret + FRET_COUNT - 1)}
        </span>
        <input
          type="range"
          min={1}
          max={Math.max(1, 24 - FRET_COUNT + 1)}
          step={1}
          value={baseFret}
          onChange={(e) => setBaseFret(parseInt(e.target.value, 10))}
          className="flex-1 h-3 accent-amber-500 cursor-pointer"
          style={{ touchAction: "none" }}
        />
        <span className="text-[10px] text-zinc-600 whitespace-nowrap">
          ↑ jusqu&apos;à 24
        </span>
      </div>

      <div className="flex items-center gap-3 mb-2">
        <span className="text-[10px] text-zinc-500 whitespace-nowrap w-24">
          {capo === 0 ? "Capo : off" : `Capo : frette ${capo}`}
        </span>
        <input
          type="range"
          min={0}
          max={12}
          step={1}
          value={capo}
          onChange={(e) => setCapo(parseInt(e.target.value, 10))}
          className="flex-1 h-3 accent-violet-500 cursor-pointer"
          style={{ touchAction: "none" }}
        />
        <span className="text-[10px] text-zinc-600 whitespace-nowrap">
          ↑ 12
        </span>
      </div>

      <svg
        width="100%"
        height="auto"
        viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
        className="max-w-full h-auto cursor-pointer select-none"
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={handlePointerDown}
      >
        {STRING_NAMES.map((name, sIdx) => {
          const x = PADDING + sIdx * STRING_SPACING;
          const isMutedStr = muted[sIdx];
          const isOpen = effectiveFret(sIdx) === 0;
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
              {!isMutedStr && isOpen && (
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

        {capo > 0 && capo >= baseFret && capo <= baseFret + FRET_COUNT - 1 && (() => {
          const capoRow = capo - baseFret;
          const x1 = PADDING - 2;
          const x2 = PADDING + 5 * STRING_SPACING + 2;
          return (
            <g>
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

        {barreOn && (() => {
          const first = STRING_COUNT - barreCount;
          const last = STRING_COUNT - 1;
          const x1 = PADDING + first * STRING_SPACING - 2;
          const x2 = PADDING + last * STRING_SPACING + 2;
          return (
            <g>
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

        {fingers.map((f) => {
          const x = PADDING + f.string * STRING_SPACING;
          const isMutedStr = muted[f.string];
          if (isMutedStr) return null;
          if (barreOn && f.fret === 0) return null;
          const cy = NUT_Y + f.fret * FRET_SPACING + FRET_SPACING / 2;
          return (
            <g key={`dot-${f.string}-${f.fret}-${f.finger}`}>
              <circle cx={x} cy={cy} r={9} fill="#f59e0b" />
              <text
                x={x}
                y={cy + 4}
                textAnchor="middle"
                className="fill-black"
                fontSize="11"
                fontWeight="bold"
              >
                {f.finger}
              </text>
            </g>
          );
        })}
      </svg>

      <p className="text-[10px] text-zinc-600 mt-1.5">
        Choisissez un outil (barré ou doigt 1‑4), puis cliquez sur une case · bouton corde ci-dessous = ouvrir/muter
      </p>

      <div className="flex items-center justify-center gap-2 mt-3 flex-wrap">
        {STRING_NAMES.map((name, sIdx) => {
          const isMutedStr = muted[sIdx];
          const fp = fingerAt(sIdx);
          const inBarre = barreStrings().includes(sIdx);
          const fretted = Boolean(fp) || inBarre;
          let label: string;
          let title: string;
          if (isMutedStr) {
            label = "X";
            title = "Corde mutée — clic pour ouvrir";
          } else if (fp) {
            label = `${fp.finger}`;
            title = `Corde jouée (doigt ${fp.finger})`;
          } else if (inBarre) {
            label = "1";
            title = "Corde barrée (index)";
          } else {
            label = "o";
            title = "Corde ouverte — clic pour muter";
          }
          return (
            <button
              key={`mute-${sIdx}`}
              onClick={() => !fretted && toggleMute(sIdx)}
              title={title}
              className={`w-9 h-9 rounded-lg text-[11px] font-mono font-bold border flex items-center justify-center transition-colors ${
                isMutedStr
                  ? "bg-red-900/50 border-red-500/50 text-red-300 hover:bg-red-900/70"
                  : fretted
                    ? "bg-amber-900/40 border-amber-500/40 text-amber-300 cursor-default"
                    : "bg-green-900/40 border-green-500/40 text-green-300 hover:bg-green-900/60"
              }`}
            >
              {name}
              <span className="ml-0.5">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}