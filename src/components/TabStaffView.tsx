"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { useCallback, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { parseAsciiTabModel, type AsciiTabModel, type TabToken } from "@/lib/ascii-tab-midi";
import type { TabRest } from "@/lib/notes-to-tab";
import {
  slotKind,
  slotFrets,
  guessChordLabel,
  measureSlots,
  padRows,
  serializeTabModel,
  detectRiffRuns,
  TAB_STRING_NAMES,
  parseTuningNotes,
  MAX_FRET,
} from "@/lib/tab-view";

const LINE_H = 15;
const COL_W = 34;
const PAD_TOP = 44; // étage : numéro de mesure + chips d'accords
const GUTTER = 26;

type CellEdit = { fret: number | null; tie: boolean };
type Edits = Map<string, CellEdit | null>; // null = repos (supprime la note)

interface Cell {
  m: number; // mesure
  s: number; // corde 0 (aiguë) → 5 (grave)
  slot: number; // colonne de temps
}

function cellKey(c: Cell): string {
  return `${c.m}|${c.s}|${c.slot}`;
}

// Liaison hammer-on (H) / pull-off (P) entre deux notes d'une même corde.
interface LegatoArc {
  from: { m: number; s: number; slot: number };
  to: { m: number; s: number; slot: number };
  type: "h" | "p";
}

// Applique les éditions à une copie du modèle (rangées complétées à `slots`) et
// la retourne prête à la sérialisation. Les trous (repos) restent `undefined`.
function buildEditedMeasures(model: AsciiTabModel, edits: Edits): (TabToken | undefined)[][][] {
  return model.measures.map((measure, m) => {
    // Une mesure vide (repos complet, 0 token) s'affiche comme 4 colonnes de
    // silence : c'est aussi la géométrie des générateurs pour une mesure au repos.
    const slots = measureSlots(measure) || 4;
    const padded = padRows(measure, slots);
    for (const [key, edit] of edits) {
      const [em, s, slot] = key.split("|").map(Number);
      if (edit === undefined || em !== m) continue;
      const row = padded[s];
      if (!row || slot < 0 || slot >= row.length) continue;
      row[slot] =
        edit === null
          ? undefined
          : { fret: edit.fret, tie: edit.tie, accent: false, soft: false, staccato: false };
    }
    return padded;
  });
}

const STRING_COLORS = ["#86efac", "#fbbf24", "#67e8f9", "#a78bfa", "#f472b6", "#f87171"];

// Symboles de silence (Unicode « Musical Symbols ») selon la durée en temps
// (1 temps = noire). 4 = pause, 2 = demi-pause, 1 = soupir, 0,5 = demi-soupir,
// 0,25 = quart de soupir, 0,125 = huitième de soupir, 0,0625 = seizième.
const RESTS: { beats: number; char: string }[] = [
  { beats: 4, char: "\u{1D13B}" },
  { beats: 2, char: "\u{1D13C}" },
  { beats: 1, char: "\u{1D13D}" },
  { beats: 0.5, char: "\u{1D13E}" },
  { beats: 0.25, char: "\u{1D13F}" },
  { beats: 0.125, char: "\u{1D140}" },
  { beats: 0.0625, char: "\u{1D141}" },
];

function restGlyph(beats: number): { char: string; dot: boolean } {
  for (const r of RESTS) {
    if (Math.abs(beats - r.beats) < 0.001) return { char: r.char, dot: false };
    if (Math.abs(beats - r.beats * 1.5) < 0.001) return { char: r.char, dot: true };
  }
  let best = RESTS[0];
  for (const r of RESTS) {
    if (Math.abs(beats - r.beats) < Math.abs(beats - best.beats)) best = r;
  }
  return { char: best.char, dot: false };
}

// Figure de rythme « Songsterr/GP » : une tige par attaque + des barres
// horizontales reliant les attaques d'un même temps. En 4/4 on groupe les
// notes dont les débuts tombent dans la fenêtre d'un temps et dont la somme
// des valeurs ≤ 1 temps (2 croches, ou 4 doubles, ou 1 croche + 2 doubles…).
// Chaque tige part d'une barre horizontale et monte vers la tête (en haut) ;
// la barre de niveau 1 est le socle tout en bas, les niveaux supérieurs sont
// empilés au-dessus : croche = 1 barre (le socle), double croche = 2, triple
// = 3, quadruple = 4… Peu importe la valeur, des divisions différentes se
// combinent sur la même barre : une barre de niveau n relie toutes les notes
// du groupe qui subdivisent au moins n fois.
//   blanche : petite tige, sans barre   noire : tige longue, sans barre
const HEAD_Y = 8; // ligne haute des têtes de notes
const BAR_Y_OF_LEVEL = (level: number): number => 30 - 4 * level; // 1 → 26 (bas/socle), 2 → 22, 3 → 18, 4 → 14
const SOCLE_Y = BAR_Y_OF_LEVEL(1); // barre la plus basse, d'où partent les tiges

function divisionLevel(beats: number): number {
  if (beats >= 0.999) return 0;
  if (beats >= 0.499) return 1; // croche
  if (beats >= 0.249) return 2; // double croche
  if (beats >= 0.124) return 3; // triple croche
  return 4; // quadruple et plus
}

export interface RhythmGroup {
  startSlot: number;
  endSlot: number;
  cols: number[];
  tops: number[];
  bars: { y: number; x0: number; x1: number }[];
}

export function rhythmBeams(
  notes: { slot: number; beats: number }[],
  slots: number
): RhythmGroup[] {
  const colsPerTemps = slots / 4; // signature 4/4 : 4 temps par mesure
  const sorted = notes
    .filter((n) => n.slot >= 0 && n.slot < slots && n.beats > 0)
    .map((n) => ({ slot: n.slot, beats: n.beats, level: divisionLevel(n.beats) }))
    .sort((a, b) => a.slot - b.slot);
  // Groupement par temps : débuts dans la même fenêtre d'un temps ET somme des
  // durées ≤ 1 temps.
  const groups: { cols: number[]; beats: number[]; levels: number[]; cum: number }[] = [];
  for (const n of sorted) {
    const g = groups[groups.length - 1];
    if (
      g &&
      n.slot - g.cols[0] < colsPerTemps &&
      g.cum + n.beats <= 1.001
    ) {
      g.cols.push(n.slot);
      g.beats.push(n.beats);
      g.levels.push(n.level);
      g.cum += n.beats;
    } else {
      groups.push({ cols: [n.slot], beats: [n.beats], levels: [n.level], cum: n.beats });
    }
  }
  const out: RhythmGroup[] = [];
  for (const g of groups) {
    const maxLevel = Math.max(...g.levels);
    // Barres de bas en haut : une barre de niveau `lv` relie la 1re à la
    // dernière note du groupe qui subdivisent au moins `lv` fois. Une croche
    // seule n'a que la barre 1 ; une croche + 2 doubles partagent la barre 1,
    // et les 2 doubles la barre 2 par-dessus.
    const bars: { y: number; x0: number; x1: number }[] = [];
    for (let lv = 1; lv <= maxLevel; lv++) {
      const idxs: number[] = [];
      for (let i = 0; i < g.levels.length; i++) if (g.levels[i] >= lv) idxs.push(i);
      if (idxs.length === 0) continue;
      bars.push({
        x0: g.cols[idxs[0]],
        x1: g.cols[idxs[idxs.length - 1]],
        y: BAR_Y_OF_LEVEL(lv),
      });
    }
    // Tige de chaque attaque : elle part de la barre (socle, en bas) et monte
    // jusqu'à la tête de note (en haut). Noire longue, blanche plus courte,
    // sans barre.
    const tops = g.levels.map((l, i) =>
      l >= 1 ? SOCLE_Y : g.beats[i] >= 2 ? HEAD_Y + 6 : HEAD_Y + 12
    );
    out.push({
      startSlot: g.cols[0],
      endSlot: g.cols[g.cols.length - 1],
      cols: g.cols,
      tops,
      bars,
    });
  }
  return out;
}

function ChordMini({ frets }: { frets: (number | null)[] }) {
  // La tablature ordonne les rangées du mi aigu vers le mi grave ; un diagramme
  // standard montre le mi grave à gauche. On retourne donc l'ordre des cordes.
  const ordered = [...frets].reverse();
  const strings = ordered.length;
  const spacingX = 9;
  const spacingY = 10;
  const pad = 6;
  const top = 12;
  const width = pad * 2 + (strings - 1) * spacingX;
  const maxFretOpts = frets.filter((f): f is number => f !== null && f > 0);
  const rows = 5;
  const maxFret = maxFretOpts.length > 0 ? Math.max(...maxFretOpts) : 0;
  const base = maxFret <= rows ? 1 : (Math.min(...maxFretOpts) || 1);
  const height = top + rows * spacingY + 6;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="block">
      {Array.from({ length: strings }, (_, i) => (
        <line
          key={`s${i}`}
          x1={pad + i * spacingX}
          x2={pad + i * spacingX}
          y1={top}
          y2={top + rows * spacingY}
          stroke="#71717a"
          strokeWidth={1.2}
        />
      ))}
      {Array.from({ length: rows + 1 }, (_, i) => (
        <line
          key={`f${i}`}
          x1={pad}
          x2={pad + (strings - 1) * spacingX}
          y1={top + i * spacingY}
          y2={top + i * spacingY}
          stroke="#52525b"
          strokeWidth={i === 0 ? 4 : 1}
        />
      ))}
      {base > 1 && (
        <text x={2} y={top + spacingY * 0.5 + 2} fontSize="6" fill="#a1a1aa" textAnchor="middle">
          {base}
        </text>
      )}
      {ordered.map((f, i) => {
        const x = pad + i * spacingX;
        if (f === null) {
          return (
            <text key={`m${i}`} x={x} y={top - 2} fontSize="7" fill="#f87171" textAnchor="middle">
              ×
            </text>
          );
        }
        if (f === 0) {
          return (
            <circle key={`o${i}`} cx={x} cy={top - 3} r={2.2} fill="none" stroke="#22c55e" strokeWidth={1.4} />
          );
        }
        const fret = f - base;
        if (fret < 0 || fret >= rows) return null;
        return <circle key={`n${i}`} cx={x} cy={top + (fret + 0.5) * spacingY} r={3} fill="#e4e4e7" />;
      })}
    </svg>
  );
}

function chunked(list: number[], size: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < list.length; i += size) {
    out.push(list.slice(i, i + size));
  }
  return out;
}

export default function TabStaffView({
  title,
  bpm,
  tab,
  editable = false,
  maxMeasuresPerLine = 4,
  showMutes = true,
  highlight,
  rests,
  ghosts,
  legatos,
  slides,
  graces,
  beats,
  measureOffset = 0,
  measures,
  tuning,
  onChange,
}: {
  title?: string;
  bpm?: number;
  tab: string;
  editable?: boolean;
  maxMeasuresPerLine?: number;
  showMutes?: boolean;
  highlight?: Set<string>;
  rests?: TabRest[];
  // Clés de cellules (mesure|corde|colonne) des notes fantômes → entre parenthèses.
  ghosts?: Set<string>;
  // Arcs hammer-on / pull-off au-dessus des notes liées.
  legatos?: LegatoArc[];
  // Clés de cellules → direction du slide (« / » ou « \ ») dessinée à côté.
  slides?: Map<string, "/" | "\\">;
  // Notes d'agrément : clés de cellules → case de grâce, dessinée en petit avant l'attaque.
  graces?: Map<string, number>;
  // Réglette des temps + valeurs de notes : grille rythmique par mesure.
  beats?: { unit: number; slots: number; notes: { slot: number; beats: number }[] }[];
  // N° (0-based) de la première mesure affichée dans la chanson : décale les
  // numéros pour qu'un riff affiche les mesures réelles (ex. 6, 7…).
  measureOffset?: number;
  // Nombre de mesures RÉELLES (ignoré si strictement supérieur à celui du modèle) :
  // masque la mesure vide synthétique ajoutée pour le dernier barreau `|`.
  measures?: number;
  // Libellé d'accordage (ex. « D A F C G C ») : remplace les noms de cordes
  // standard affichés à gauche de la portée.
  tuning?: string;
  onChange?: (ascii: string) => void;
}) {
  const model = useMemo(() => parseAsciiTabModel(tab), [tab]);
  const [edits, setEdits] = useState<Edits>(new Map());
  const [sel, setSel] = useState<Cell | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);

  const stringNames = useMemo(
    () => parseTuningNotes(tuning) ?? TAB_STRING_NAMES,
    [tuning]
  );

  const currentMeasures = useMemo(
    () =>
      buildEditedMeasures(model, edits).map((measure) => {
        const slots = measureSlots(measure);
        const rows = padRows(measure, slots);
        return { slots, rows };
      }),
    [model, edits]
  );

  const getTok = useCallback(
    (cell: Cell): TabToken | undefined => {
      const mm = currentMeasures[cell.m];
      if (!mm) return undefined;
      const row = mm.rows[cell.s];
      return row ? row[cell.slot] : undefined;
    },
    [currentMeasures]
  );

  const commit = useCallback(
    (next: Edits) => {
      setEdits(next);
      if (onChange) {
        onChange(
          serializeTabModel({
            title: title ?? (model.title === "MIDI" ? undefined : model.title),
            bpm: bpm ?? model.bpm,
            measures: buildEditedMeasures(model, next),
          })
        );
      }
    },
    [model, title, bpm, onChange]
  );

  const setEdit = useCallback(
    (cell: Cell, value: CellEdit | null) => {
      const next = new Map(edits);
      const key = cellKey(cell);
      if (value === null) {
        next.set(key, null);
      } else {
        next.set(key, value);
      }
      commit(next);
    },
    [edits, commit]
  );

  const changeFret = useCallback(
    (cell: Cell, delta: 1 | -1) => {
      const tok = getTok(cell);
      const kind = slotKind(tok);
      if (kind === "note") {
        const cur = tok?.fret ?? 0;
        if (delta === -1 && cur === 0) {
          setEdit(cell, null); // case 0 + « moins » → repos
        } else {
          setEdit(cell, { fret: Math.min(MAX_FRET, Math.max(0, cur + delta)), tie: tok?.tie ?? false });
        }
      } else {
        setEdit(cell, delta === 1 ? { fret: 0, tie: false } : null);
      }
      setSel(cell);
    },
    [getTok, setEdit]
  );

  const toggleMute = useCallback(
    (cell: Cell) => {
      const kind = slotKind(getTok(cell));
      if (kind === "note") setEdit(cell, { fret: null, tie: false });
      else if (kind === "mute") setEdit(cell, null);
      else setEdit(cell, { fret: null, tie: false });
      setSel(cell);
    },
    [getTok, setEdit]
  );

  const toggleTie = useCallback(
    (cell: Cell) => {
      const tok = getTok(cell);
      if (!tok || tok.fret === null) return;
      setEdit(cell, { fret: tok.fret, tie: !tok.tie });
      setSel(cell);
    },
    [getTok, setEdit]
  );

  const select = useCallback(
    (cell: Cell, dir?: "left" | "right" | "up" | "down") => {
      if (!dir) {
        setSel(cell);
        if (gridRef.current) gridRef.current.focus();
        return;
      }
      setSel((prev) => {
        if (!prev) return cell;
        const mm = currentMeasures[prev.m];
        const slots = mm ? mm.slots : 0;
        let next: Cell = prev;
        if (dir === "left") next = { ...prev, slot: Math.max(0, prev.slot - 1) };
        if (dir === "right") next = { ...prev, slot: Math.min(Math.max(0, slots - 1), prev.slot + 1) };
        if (dir === "up") next = { ...prev, s: Math.max(0, prev.s - 1) };
        if (dir === "down") next = { ...prev, s: Math.min(5, prev.s + 1) };
        return next;
      });
    },
    [currentMeasures]
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (!editable || !sel) return;
      const k = e.key;
      if (k === "ArrowUp" || k === "ArrowDown") {
        e.preventDefault();
        changeFret(sel, k === "ArrowUp" ? 1 : -1);
      } else if (k === "ArrowLeft" || k === "ArrowRight") {
        e.preventDefault();
        select(sel, k === "ArrowLeft" ? "left" : "right");
      } else if (k === "m" || k === "M") {
        e.preventDefault();
        toggleMute(sel);
      } else if (k === "t" || k === "T") {
        e.preventDefault();
        toggleTie(sel);
      } else if (k === "Backspace" || k === "Delete") {
        e.preventDefault();
        setEdit(sel, null);
      } else if (k === "Escape") {
        setSel(null);
      }
    },
    [editable, sel, changeFret, select, toggleMute, toggleTie, setEdit]
  );

  const measureIndices = Array.from(
    { length: Math.max(0, Math.min(measures ?? currentMeasures.length, currentMeasures.length)) },
    (_, i) => i
  );
  const visibleMeasures = Math.max(0, Math.min(measures ?? currentMeasures.length, currentMeasures.length));

  const riffCount = useMemo(
    () =>
      currentMeasures.reduce(
        (acc, mm) => acc + detectRiffRuns(mm.rows, mm.slots).length,
        0
      ),
    [currentMeasures]
  );

  return (
    <div className="select-none">
      <div className="text-[10px] text-zinc-500 mb-1.5 px-1">
        {title ?? (model.title === "MIDI" ? "" : model.title)}
        {((bpm ?? model.bpm) > 0) && ` · ${bpm ?? model.bpm} BPM`}
        {visibleMeasures > 0 && ` · ${visibleMeasures} mesure${visibleMeasures > 1 ? "s" : ""}`}
        {riffCount > 0 && ` · ${riffCount} riff${riffCount > 1 ? "s" : ""}`}
      </div>
      <div
        ref={gridRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="outline-none focus-visible:ring-1 focus-visible:ring-amber-400/40 rounded-lg overflow-x-auto"
      >
        {currentMeasures.length === 0 ? (
          <p className="text-[11px] text-zinc-600">Aucune portée détectée.</p>
        ) : (
          <div className="flex flex-col gap-3 py-1 pr-1">
            {chunked(measureIndices, maxMeasuresPerLine).map((group, gi) => (
              <div key={gi} className="flex items-start">
                <div
                  className="relative shrink-0 border-r-2 border-white/25"
                  style={{ width: GUTTER, height: PAD_TOP + 6 * LINE_H }}
                >
                  {stringNames.map((name, s) => (
                    <span
                      key={s}
                      className="absolute right-1.5 text-[9px] font-mono text-zinc-500 leading-none"
                      style={{ top: PAD_TOP + s * LINE_H - 5 }}
                    >
                      {name}
                    </span>
                  ))}
                </div>
                {group.map((m, i) => (
                  <MeasureBox
                    key={m}
                    index={m}
                    firstInStaff={i === 0}
                    lastInStaff={i === group.length - 1}
                    measureNumber={m + 1 + measureOffset}
                    measure={currentMeasures[m]}
                    editable={editable}
                    showMutes={showMutes}
                    highlight={highlight}
                    rests={rests ? rests.filter((r) => r.m === m) : undefined}
                    ghosts={ghosts}
                    legatos={legatos ? legatos.filter((l) => l.from.m === m) : undefined}
                    slides={slides}
                    graces={graces}
                    beats={beats ? beats[m] : undefined}
                    sel={sel && sel.m === m ? sel : null}
                    onSelect={select}
                    onFret={changeFret}
                    onMute={toggleMute}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
      {editable && (
        <p className="text-[10px] text-zinc-600 mt-1.5 px-1">
          ↑/↓ = case · ←/→ = colonne · M = étouffée · T = liaison · Suppr = repos · Échap = désélectionner
        </p>
      )}
    </div>
  );
}

function MeasureBox({
  index,
  firstInStaff,
  lastInStaff,
  measureNumber,
  measure,
  editable,
  showMutes,
  highlight,
  rests,
  ghosts,
  legatos,
  slides,
  graces,
  beats,
  sel,
  onSelect,
  onFret,
  onMute,
}: {
  index: number;
  firstInStaff: boolean;
  lastInStaff: boolean;
  measureNumber: number;
  measure: { slots: number; rows: (TabToken | undefined)[][] };
  editable: boolean;
  showMutes: boolean;
  highlight?: Set<string>;
  rests?: TabRest[];
  ghosts?: Set<string>;
  legatos?: LegatoArc[];
  slides?: Map<string, "/" | "\\">;
  graces?: Map<string, number>;
  beats?: { unit: number; slots: number; notes: { slot: number; beats: number }[] };
  sel: Cell | null;
  onSelect: (cell: Cell, dir?: "left" | "right" | "up" | "down") => void;
  onFret: (cell: Cell, delta: 1 | -1) => void;
  onMute: (cell: Cell) => void;
}) {
  const { slots, rows } = measure;
  const width = slots * COL_W;
  const height = PAD_TOP + 6 * LINE_H;
  const VALUE_H = 30; // hauteur de la bande « figure de rythme » sous la portée

  // Riffs : passages de notes seules → bande teintée + étiquette « RIFF ».
  const riffRuns = detectRiffRuns(rows, slots);

  // Valeur de chaque attaque (figure de rythme « Songsterr ») sous sa colonne.
  const valueMarks = rhythmBeams(beats?.notes ?? [], slots);

  // Accords plaqués : chaque colonne avec ≥ 2 notes → nom au-dessus + diagramme
  // au survol (strumming).
  const chords: { slot: number; label: string; frets: (number | null)[] }[] = [];
  for (let t = 0; t < slots; t++) {
    const frets = slotFrets(rows, t);
    const notes = frets.filter((f): f is number => f !== null && f >= 0);
    if (notes.length < 2) continue;
    const label = guessChordLabel(frets);
    if (!label) continue;
    chords.push({ slot: t, label, frets });
  }

  return (
    <div className="relative shrink-0 bg-zinc-950/40" style={{ width: width + 2, height: height + (beats ? VALUE_H : 0) + (riffRuns.length > 0 ? 14 : 0) }}>
      {/* barres de mesure : fins traits blancs (même texture que la réglette)
          aux limites de chaque mesure, sur la hauteur de la portée */}
      {!firstInStaff && (
        <div
          className="absolute pointer-events-none"
          style={{ left: 0, top: PAD_TOP, width: 1, height: 6 * LINE_H, background: "rgba(255,255,255,0.3)" }}
        />
      )}
      {lastInStaff && (
        <div
          className="absolute pointer-events-none"
          style={{ right: 0, top: PAD_TOP, width: 1, height: 6 * LINE_H, background: "rgba(255,255,255,0.3)" }}
        />
      )}

      {/* lignes de la portée (6 cordes, l'aiguë en haut) */}
      {Array.from({ length: 6 }, (_, s) => (
        <div
          key={`l${s}`}
          className="absolute left-0 right-0 pointer-events-none"
          style={{ top: PAD_TOP + s * LINE_H, borderTop: "1px solid #3f3f46" }}
        />
      ))}

      {/* Riffs : bande teintée derrière les cordes + étiquette sous la portée */}
      {riffRuns.map((r) => (
        <div
          key={`riff-${r.start}`}
          className="absolute pointer-events-none"
          style={{
            left: r.start * COL_W,
            top: PAD_TOP,
            width: (r.end - r.start + 1) * COL_W,
            height: 6 * LINE_H,
          }}
        >
          <div className="absolute inset-0 bg-cyan-400/[0.06] rounded-sm" />
          <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-cyan-400/40" />
        </div>
      ))}
      {/* numéro de mesure */}
      <span className="absolute left-1/2 -translate-x-1/2 top-0.5 text-[9px] text-zinc-500 leading-none">
        {measureNumber}
      </span>
      {/* étiquette de riff, sous la portée */}
      {riffRuns.map((r) => (
        <span
          key={`riff-label-${r.start}`}
          className="absolute text-[8px] font-bold tracking-widest text-cyan-300/90 leading-none"
          style={{ left: r.start * COL_W + 3, top: PAD_TOP + 6 * LINE_H + (beats ? VALUE_H : 0) + 3 }}
        >
          RIFF
        </span>
      ))}

      {/* noms d'accords & diagrammes */}
      {chords.map((c) => (
        <div
          key={c.slot}
          className="absolute flex flex-col items-center"
          style={{ left: c.slot * COL_W + COL_W / 2 - 15, top: 16, width: 30 }}
        >
          <span className="group relative text-[10px] font-bold text-amber-300 leading-none whitespace-nowrap">
            {c.label}
            <span className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-20 hidden group-hover:block bg-zinc-900 border border-zinc-700 rounded-md p-1 shadow-xl">
              <ChordMini frets={c.frets} />
            </span>
          </span>
        </div>
      ))}

      {/* liaisons hammer-on / pull-off */}
      <svg
        className="absolute inset-0 pointer-events-none"
        width={width}
        height={height}
      >
        {(legatos ?? [])
          .filter((l) => l.to.m === index)
          .map((leg, i) => {
            const x1 = leg.from.slot * COL_W + COL_W / 2;
            const x2 = leg.to.slot * COL_W + COL_W / 2;
            const y = PAD_TOP + leg.from.s * LINE_H - 14;
            const midX = (x1 + x2) / 2;
            return (
              <g key={`leg-${i}`}>
                <path
                  d={`M ${x1} ${y} Q ${midX} ${y - 8} ${x2} ${y}`}
                  fill="none"
                  stroke="#fbbf24"
                  strokeWidth={1.4}
                  strokeLinecap="round"
                />
                <text
                  x={midX}
                  y={y - 9}
                  textAnchor="middle"
                  fontSize={9}
                  fontWeight={700}
                  fill="#fbbf24"
                >
                  {leg.type === "h" ? "H" : "P"}
                </text>
              </g>
            );
          })}
      </svg>

      {/* silences (pause, demi-pause, soupir, demi-soupir, ...) */}
      {rests && rests.length > 0 && (
        <div className="absolute inset-0 pointer-events-none">
          {rests.map((r, i) => {
            const g = restGlyph(r.beats);
            return (
              <span
                key={`rest-${i}`}
                className="absolute select-none"
                style={{
                  left: r.slot * COL_W + COL_W / 2,
                  top: PAD_TOP + 2.5 * LINE_H,
                  transform: "translate(-50%, -50%)",
                  fontSize: 34,
                  lineHeight: 1,
                  color: "#e4e4e7",
                  fontFamily:
                    "'Bravura','Noto Music','Segoe UI Symbol','Symbola','DejaVu Sans',serif",
                }}
              >
                {g.char}
                {g.dot ? <span style={{ fontSize: 20, verticalAlign: "top" }}>·</span> : null}
              </span>
            );
          })}
        </div>
      )}

      {/* cases (notes / étouffées / repos) */}
      {rows.map((row, s) =>
        row.map((tok, t) => {
          const cell: Cell = { m: index, s, slot: t };
          const k = slotKind(tok);
          const isSel = sel !== null && sel.s === s && sel.slot === t;
          const isHit = highlight?.has(cellKey(cell)) ?? false;
          const isGhost = ghosts?.has(cellKey(cell)) ?? false;
          const slideDir = slides?.get(cellKey(cell));
          const graceFret = graces?.get(cellKey(cell));
          const fretted = k === "note";
          const label = fretted
            ? isGhost
              ? `(${tok?.fret ?? 0})`
              : String(tok?.fret ?? 0)
            : k === "mute"
              ? (showMutes ? "×" : "")
              : "";
          return (
            <div
              key={`${s}-${t}`}
              className="absolute group/cell"
              style={{ left: t * COL_W, top: PAD_TOP + s * LINE_H - LINE_H / 2, width: COL_W, height: LINE_H }}
            >
              {isHit && (
                <span
                  data-highlight="1"
                  className="absolute inset-0 rounded pointer-events-none"
                  style={{ background: "rgba(34,211,238,0.28)", boxShadow: "0 0 0 1px rgba(103,232,249,0.9), 0 0 8px rgba(34,211,238,0.7)" }}
                />
              )}
              {graceFret !== undefined && (
                <span
                  className="absolute pointer-events-none select-none"
                  style={{
                    left: -7,
                    top: "50%",
                    transform: "translateY(-50%)",
                    fontSize: 8,
                    fontWeight: 700,
                    color: isHit ? "#ffffff" : STRING_COLORS[s],
                    opacity: 0.85,
                    zIndex: 5,
                  }}
                >
                  {graceFret}
                </span>
              )}
              <button
                type="button"
                tabIndex={-1}
                onClick={() => onSelect(cell)}
                onMouseDown={(e) => e.preventDefault()}
                className={
                  "absolute inset-0 flex items-center justify-center rounded text-[13px] font-mono font-bold leading-none transition-colors " +
                  (isHit
                    ? "relative z-10 text-white drop-shadow "
                    : isSel
                      ? "bg-amber-400/20 ring-1 ring-amber-300"
                      : "hover:bg-white/5")
                }
                style={fretted ? { color: isHit ? "#ffffff" : STRING_COLORS[s] } : undefined}
              >
                {label}
                {slideDir && (
                  <span className="text-[8px] opacity-80" style={{ color: isHit ? "#d0fbf6" : "#f0fdf4" }}>
                    {slideDir}
                  </span>
                )}
              </button>
              {editable && (
                <div className="absolute left-1/2 -translate-x-1/2 top-full mt-0.5 z-10 hidden group-hover/cell:flex gap-0.5">
                  <SmallBtn onClick={() => onFret(cell, 1)}>+</SmallBtn>
                  <SmallBtn onClick={() => onFret(cell, -1)}>−</SmallBtn>
                  <SmallBtn onClick={() => onMute(cell)}>×</SmallBtn>
                </div>
              )}
            </div>
          );
        })
      )}

      {/* figure de rythme sous la portée : tiges + barres verticales groupées
          par temps (2+2+2+2 en 4/4) */}
      {valueMarks.length > 0 && (
        <div
          className="absolute inset-x-0 pointer-events-none"
          style={{ top: PAD_TOP + 6 * LINE_H + 1, height: VALUE_H }}
        >
          {valueMarks.map((m, i) => {
            const xs = m.cols.map((slot) => slot * COL_W + COL_W / 2);
            const left = Math.min(...xs) - 6;
            const right = Math.max(...xs) + 6;
            return (
              <svg
                key={`val-${i}`}
                className="absolute"
                style={{ left, top: 0 }}
                width={right - left}
                height={VALUE_H}
                viewBox={`0 0 ${right - left} ${VALUE_H}`}
              >
                {/* barres horizontales de bas en haut : 1=croche basse,
                    2=double au-dessus, etc. — la barre de niveau n relie les
                    notes du groupe qui subdivisent au moins n fois */}
                {m.bars.map((bar, bi) => {
                  const bx0 = bar.x0 * COL_W + COL_W / 2 - left;
                  const bx1 = bar.x1 * COL_W + COL_W / 2 - left;
                  return (
                    <rect
                      key={`vb${bi}`}
                      x={bx0 - 3}
                      y={bar.y - 2.5}
                      width={bx1 - bx0 + 6}
                      height={3}
                      fill="#a1a1aa"
                    />
                  );
                })}
                {/* tiges verticales de chaque attaque : de la barre (bas)
                    jusqu'à la tête de note (haut) */}
                {m.cols.map((slot, ci) => (
                  <line
                    key={`vs${ci}`}
                    x1={slot * COL_W + COL_W / 2 - left}
                    y1={m.tops[ci]}
                    x2={slot * COL_W + COL_W / 2 - left}
                    y2={HEAD_Y}
                    stroke="#a1a1aa"
                    strokeWidth={1.4}
                  />
                ))}
                {/* petite tête de note sur la ligne haute */}
                <ellipse
                  cx={m.cols[0] * COL_W + COL_W / 2 - left}
                  cy={HEAD_Y}
                  rx={3}
                  ry={2.2}
                  fill="#a1a1aa"
                />
              </svg>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SmallBtn({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="h-[18px] min-w-[18px] flex items-center justify-center rounded bg-zinc-800 border border-zinc-600 text-[10px] text-zinc-200 hover:bg-zinc-700 cursor-pointer"
    >
      {children}
    </button>
  );
}