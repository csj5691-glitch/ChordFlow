"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.

// Lecteur de tablature animee (POC).
//
// Le composant ne possede ni horloge ni audio : il lit `getCurrentTime()` de
// playback-store, exactement comme les autres vues de ChordFlow. Le layout est
// calcule une fois ; chaque image ne fait que deplacer le curseur et basculer
// l'etat des notes du systeme actif, sans re-rendu React.

import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { getCurrentTime } from "@/lib/playback-store";
import {
  SYSTEM_PAD,
  buildLayout,
  type Layout,
  type LayoutBar,
  type LayoutNote,
  type LayoutSystem,
  type LayoutTrack,
} from "@/lib/tab-player/layout";
import type { TabPlayerSong } from "@/lib/tab-player/types";
import styles from "./TabPlaybackView.module.css";

interface TabPlaybackViewProps {
  song: TabPlayerSong;
  /** Mesures par systeme (4 par defaut). */
  measuresPerSystem?: number;
  /**
   * Tout afficher sur une seule ligne (defilement horizontal continu).
   * Utilise pendant « Ecouter tout » pour voir la tablature defiler.
   */
  singleLine?: boolean;
  /** Suivre la lecture en faisant defiler le conteneur. */
  follow?: boolean;
  /** Hauteur maximale du conteneur defilant, en pixels. */
  maxHeight?: number;
  className?: string;
  /** Appele au clic sur une mesure, avec le temps de reference en secondes. */
  onSeek?: (seconds: number) => void;
  /** Horloge optionnelle ; par defaut l'horloge partagee de ChordFlow. */
  getTime?: () => number;
}

interface ActiveSystem {
  system: number;
  /** Mesure suivie par la boucle d'animation (evite de parcourir toutes les notes). */
  barIndex: number;
  cursor: SVGUseElement | null;
  notes: { el: SVGGElement; t: number; tEnd: number }[];
}

const format = (value: number): string => value.toFixed(2);

/** Largeur d'une mesure sur une seule ligne (unites du viewBox). */
const SINGLE_LINE_MEASURE = 260;

export default function TabPlaybackView({
  song,
  measuresPerSystem = 4,
  singleLine = false,
  follow = true,
  maxHeight = 560,
  className,
  onSeek,
  getTime,
}: TabPlaybackViewProps) {
  const layout = useMemo(() => {
    const barCount = Math.max(1, song.bars.length);
    return buildLayout(song, {
      measuresPerSystem: singleLine ? barCount : measuresPerSystem,
      measureWidth: singleLine ? SINGLE_LINE_MEASURE : undefined,
    });
  }, [song, measuresPerSystem, singleLine]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const svgEls = useRef(new Map<number, SVGSVGElement>());
  const active = useRef<ActiveSystem | null>(null);

  const registerSystem = useCallback((index: number, el: SVGSVGElement | null) => {
    if (el) svgEls.current.set(index, el);
    else svgEls.current.delete(index);
  }, []);

  // Suivi horizontal (une seule ligne) : le curseur reste a ~35 % de la
  // fenetre et la tablature defile en continu sous lui.
  const followX = useCallback((x: number) => {
    const container = scrollRef.current;
    if (!container) return;
    const view = container.clientWidth;
    if (!view) return;
    const target = Math.max(0, x - view * 0.35);
    const max = Math.max(0, container.scrollWidth - view);
    const next = Math.min(target, max);
    if (Math.abs(container.scrollLeft - next) > 0.5) container.scrollLeft = next;
  }, []);

  const scrollToSystem = useCallback((system: number) => {
    const container = scrollRef.current;
    const first = svgEls.current.get(0);
    if (!container || !first) return;
    const height = first.getBoundingClientRect().height;
    if (!height) return;
    const top = system * height;
    const view = container.clientHeight;
    const margin = Math.min(height * 0.5, view * 0.2);
    const visible =
      top >= container.scrollTop + margin &&
      top + height <= container.scrollTop + view - margin;
    if (visible) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    container.scrollTo({
      top: Math.max(0, top - 8),
      behavior: reduce ? "auto" : "smooth",
    });
  }, []);

  const draw = useCallback(
    (time: number) => {
      const beat = layout.timing.timeToBeat(time);
      const bar = layout.barAtBeat(beat);
      const previous = active.current;
      const systemChanged = !previous || previous.system !== bar.system;

      if (!previous || systemChanged || previous.barIndex !== bar.index) {
        if (previous && systemChanged) {
          const previousSvg = svgEls.current.get(previous.system);
          const previousCursor = previousSvg?.querySelector<SVGUseElement>(
            "use[data-playhead]"
          );
          if (previousCursor) previousCursor.style.visibility = "hidden";
        }

        const svg = svgEls.current.get(bar.system);
        const cursor =
          svg?.querySelector<SVGUseElement>("use[data-playhead]") ?? null;
        const notes: { el: SVGGElement; t: number; tEnd: number }[] = [];
        if (svg) {
          // Une seule passe par mesure (pas par image) : on remet a jour l'etat
          // des notes du systeme, puis la boucle d'animation ne suit que les
          // notes de la mesure courante.
          const members = String(bar.index);
          for (const el of svg.querySelectorAll<SVGGElement>("g[data-note]")) {
            const t = Number(el.dataset.t ?? 0);
            const tEnd = Number(el.dataset.e ?? 0);
            const played = time >= tEnd;
            if (el.dataset.played !== String(played)) {
              el.dataset.played = String(played);
            }
            el.dataset.on = "false";
            if (el.dataset.bar === members) notes.push({ el, t, tEnd });
          }
        }

        active.current = { system: bar.system, barIndex: bar.index, cursor, notes };
        if (follow && !singleLine) scrollToSystem(bar.system);
      }

      const current = active.current;
      if (!current) return;

      const x = bar.x + ((beat - bar.startBeat) / bar.beats) * bar.w;
      if (current.cursor) {
        current.cursor.setAttribute("transform", `translate(${format(x)} 0)`);
        current.cursor.style.visibility = "visible";
      }
      if (follow && singleLine) followX(x);

      for (const note of current.notes) {
        const on = time >= note.t && time < note.tEnd;
        const played = time >= note.tEnd;
        if (note.el.dataset.on !== String(on)) note.el.dataset.on = String(on);
        if (note.el.dataset.played !== String(played)) {
          note.el.dataset.played = String(played);
        }
      }
    },
    [layout, follow, singleLine, scrollToSystem, followX]
  );

  // Reactiver le suivi doit ramener immediatement la position courante a l'ecran.
  useEffect(() => {
    if (!follow) return;
    const current = active.current;
    if (!current) return;
    if (singleLine) {
      const bar = layout.bars[current.barIndex];
      if (bar) followX(bar.x);
    } else {
      scrollToSystem(current.system);
    }
  }, [follow, singleLine, scrollToSystem, followX, layout]);

  // Un nouveau morceau invalide le systeme actif, efface les etats du morceau
  // precedent (React reutilise les noeuds des premiers systemes) et remet le
  // defilement au debut. Le premier dessin vient de la boucle d'animation.
  useEffect(() => {
    active.current = null;
    for (const svg of svgEls.current.values()) {
      const cursor = svg.querySelector<SVGUseElement>("use[data-playhead]");
      if (cursor) cursor.style.visibility = "hidden";
      for (const el of svg.querySelectorAll<SVGGElement>("g[data-note]")) {
        el.dataset.on = "false";
        el.dataset.played = "false";
      }
    }
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
      scrollRef.current.scrollLeft = 0;
    }
  }, [layout]);

  useEffect(() => {
    let raf = 0;
    let last = Number.NaN;
    const clock = getTime ?? getCurrentTime;
    const frame = () => {
      const time = clock();
      if (time !== last) {
        last = time;
        draw(time);
      }
      raf = requestAnimationFrame(frame);
    };
    draw(clock());
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [draw, getTime]);

  return (
    <div
      ref={scrollRef}
      className={`${styles.scroller} ${singleLine ? styles.singleLine : ""} ${className ?? ""}`}
      style={{ maxHeight }}
    >
      <div className={styles.sheet}>
        {layout.systems.map((system) => (
          <SystemSvg
            key={system.index}
            system={system}
            layout={layout}
            register={registerSystem}
            onSeek={onSeek}
            pixelWidth={singleLine ? layout.systemWidth : undefined}
          />
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   Un systeme : portees, mesures, notes et curseur
   ============================================================ */

interface SystemSvgProps {
  system: LayoutSystem;
  layout: Layout;
  register: (index: number, el: SVGSVGElement | null) => void;
  onSeek?: (seconds: number) => void;
  /** Largeur en pixels (une seule ligne : 1 unite du viewBox = 1 px). */
  pixelWidth?: number;
}

const SystemSvg = memo(function SystemSvg({
  system,
  layout,
  register,
  onSeek,
  pixelWidth,
}: SystemSvgProps) {
  const width = layout.systemWidth;
  const height = layout.systemHeight;
  const first = layout.tracks[0];
  const last = layout.tracks[layout.tracks.length - 1];
  const playheadTop = (first?.geo.staffTop ?? 30) - 6;
  const playheadBottom = (last?.geo.staffBot ?? 96) + 6;
  const notes = layout.notesBySystem[system.index] ?? [];
  const firstBar = system.bars[0];
  const lastBar = system.bars[system.bars.length - 1];

  return (
    <div
      className={styles.system}
      style={{
        aspectRatio: `${width} / ${height}`,
        ...(pixelWidth ? { width: `${pixelWidth}px` } : null),
      }}
    >
      <svg
        ref={(el) => register(system.index, el)}
        viewBox={`0 0 ${width} ${height}`}
        className={styles.svg}
        role="img"
        aria-label={`Systeme ${system.index + 1}, mesures ${(firstBar?.index ?? 0) + 1} a ${(lastBar?.index ?? 0) + 1}`}
      >
        <defs>
          <symbol id={`tbp-ph-${system.index}`} overflow="visible">
            <rect
              className={styles.phBody}
              x={-4.5}
              y={playheadTop}
              width={9}
              height={playheadBottom - playheadTop}
              rx={4.5}
            />
            <line
              className={styles.phLine}
              x1={0}
              y1={playheadTop}
              x2={0}
              y2={playheadBottom}
            />
            <path
              className={styles.phCap}
              d={`M0,${playheadTop - 7} l4.5,5.5 h-9 Z`}
            />
          </symbol>
        </defs>

        {layout.tracks.map((track) => (
          <StaffLines key={track.index} track={track} width={width} />
        ))}

        {layout.tracks.map((track) => (
          <TuningLabels key={track.index} track={track} width={width} />
        ))}

        {system.bars.map((bar) => (
          <Measure
            key={bar.index}
            bar={bar}
            tracks={layout.tracks}
            playheadTop={playheadTop}
            playheadBottom={playheadBottom}
            onSeek={onSeek}
          />
        ))}

        {notes.map((note) => (
          <NoteGlyph key={note.id} note={note} />
        ))}

        <use
          data-playhead
          href={`#tbp-ph-${system.index}`}
          className={styles.playhead}
        />
      </svg>
    </div>
  );
});

function StaffLines({ track, width }: { track: LayoutTrack; width: number }) {
  const segments: string[] = [];
  for (let string = 0; string < track.meta.tuning.length; string++) {
    const y = track.geo.top + string * track.geo.gap;
    segments.push(`M${SYSTEM_PAD},${format(y)} H${format(width - SYSTEM_PAD)}`);
  }
  return <path className={styles.staffLine} d={segments.join(" ")} />;
}

function TuningLabels({ track, width }: { track: LayoutTrack; width: number }) {
  return (
    <g>
      {track.meta.labels.map((label, string) => (
        <text
          key={string}
          className={styles.tuningLabel}
          x={SYSTEM_PAD - 5}
          y={track.geo.top + string * track.geo.gap + 2.6}
          textAnchor="end"
        >
          {label}
        </text>
      ))}
      <text
        className={styles.trackLabel}
        x={width - SYSTEM_PAD}
        y={track.geo.staffTop - 4}
        textAnchor="end"
      >
        {track.meta.short}
      </text>
    </g>
  );
}

interface MeasureProps {
  bar: LayoutBar;
  tracks: LayoutTrack[];
  playheadTop: number;
  playheadBottom: number;
  onSeek?: (seconds: number) => void;
}

function Measure({
  bar,
  tracks,
  playheadTop,
  playheadBottom,
  onSeek,
}: MeasureProps) {
  return (
    <g>
      <text
        className={styles.measureNo}
        x={bar.x + bar.w - 3}
        y={11}
        textAnchor="end"
      >
        {bar.index + 1}
      </text>
      {bar.section && (
        <text className={styles.section} x={bar.x + 2} y={11}>
          {bar.section.toUpperCase()}
        </text>
      )}

      {tracks.map((track) => {
        const ticks: ReactNode[] = [];
        for (let beat = 1; beat < bar.beats; beat++) {
          const x = bar.x + (beat / bar.beats) * bar.w;
          ticks.push(
            <line
              key={beat}
              className={styles.beatTick}
              x1={x}
              y1={track.geo.staffBot - 5}
              x2={x}
              y2={track.geo.staffBot}
            />
          );
        }
        return (
          <g key={track.index}>
            <line
              className={styles.barLine}
              x1={bar.x}
              y1={track.geo.staffTop}
              x2={bar.x}
              y2={track.geo.staffBot}
            />
            <line
              className={styles.barLine}
              x1={bar.x + bar.w}
              y1={track.geo.staffTop}
              x2={bar.x + bar.w}
              y2={track.geo.staffBot}
            />
            {ticks}
          </g>
        );
      })}

      {onSeek && (
        <rect
          className={styles.hit}
          x={bar.x}
          y={playheadTop}
          width={bar.w}
          height={playheadBottom - playheadTop}
          onClick={() => onSeek(bar.t)}
        />
      )}
    </g>
  );
}

function NoteGlyph({ note }: { note: LayoutNote }) {
  return (
    <g className={styles.noteGroup} data-track={note.trackIndex % 2}>
      {techniqueGlyphs(note)}
      <g
        data-note
        data-bar={note.barIndex}
        data-t={note.t.toFixed(4)}
        data-e={note.tEnd.toFixed(4)}
        data-on="false"
        data-played="false"
        data-tied={note.tieFrom ? "true" : undefined}
        data-dead={note.technique === "dead" ? "true" : undefined}
        className={styles.note}
      >
        <text x={note.x} y={note.y + 3.1} textAnchor="middle">
          {note.technique === "dead" ? "×" : note.fret}
        </text>
      </g>
    </g>
  );
}

function techniqueGlyphs(note: LayoutNote): ReactNode[] {
  const glyphs: ReactNode[] = [];

  if (
    (note.technique === "hammer" ||
      note.technique === "pull" ||
      note.technique === "slide") &&
    note.prev &&
    note.prev.system === note.system &&
    note.prev.x < note.x - 3
  ) {
    const previous = note.prev;
    if (note.technique === "slide") {
      glyphs.push(
        <path
          key="slide-line"
          className={styles.techLine}
          d={`M${format(previous.x + 2)},${format(previous.y)} L${format(note.x - 4)},${format(note.y)}`}
        />
      );
      glyphs.push(
        <path
          key="slide-head"
          className={styles.techLine}
          d={`M${format(note.x - 7)},${format(note.y - 2.5)} l3.5,2.5 l-3.5,2.5`}
        />
      );
    } else {
      const midX = (previous.x + note.x) / 2;
      const midY = Math.min(previous.y, note.y) - 7;
      glyphs.push(
        <path
          key="hammer-arc"
          className={styles.techLine}
          d={`M${format(previous.x + 2)},${format(previous.y - 5)} Q${format(midX)},${format(midY)} ${format(note.x - 2)},${format(note.y - 5)}`}
        />
      );
    }
    glyphs.push(
      <text
        key="hammer-label"
        className={styles.techText}
        x={(previous.x + note.x) / 2}
        y={Math.min(previous.y, note.y) - 9}
        textAnchor="middle"
      >
        {note.technique === "hammer" ? "H" : note.technique === "pull" ? "P" : "sl"}
      </text>
    );
  }

  if (note.technique === "bend") {
    glyphs.push(
      <path
        key="bend-line"
        className={styles.techLine}
        d={`M${format(note.x - 6)},${format(note.y - 8)} q6,-7 11,-2`}
      />
    );
    glyphs.push(
      <path
        key="bend-head"
        className={styles.techLine}
        d={`M${format(note.x + 3)},${format(note.y - 13)} l2,2.4 l-3.2,.4`}
      />
    );
    glyphs.push(
      <text
        key="bend-label"
        className={styles.techText}
        x={note.x}
        y={note.y - 15}
        textAnchor="middle"
      >
        full
      </text>
    );
  }

  if (note.technique === "vibrato") {
    glyphs.push(
      <path
        key="vibrato"
        className={styles.techLine}
        d={`M${format(note.x - 7)},${format(note.y - 8)} q2.2,-3 4.4,0 t4.4,0 t4.4,0`}
      />
    );
  }

  if (note.tieFrom && note.tieFrom.system === note.system && note.tieFrom.x < note.x) {
    const source = note.tieFrom;
    const midX = (source.x + note.x) / 2;
    const midY = Math.min(source.y, note.y) - 6;
    glyphs.push(
      <path
        key="tie"
        className={styles.tieLine}
        d={`M${format(source.x + 2)},${format(source.y - 4)} Q${format(midX)},${format(midY)} ${format(note.x - 2)},${format(note.y - 4)}`}
      />
    );
  }

  return glyphs;
}
