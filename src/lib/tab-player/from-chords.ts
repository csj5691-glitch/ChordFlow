// Copyright (c) 2026 Claude St-Jean. All rights reserved.

// Adaptateur grille d'accords -> modele du lecteur de tablature.
//
// La saisie reste la grille existante (`SavedChordShape[]`) : ce module ne fait
// que la projeter sur le modele de `types.ts`, exactement comme
// `from-alphaTab.ts` le fait pour un fichier Guitar Pro. Aucune donnee n'est
// modifiee ni persistee.
//
// Regles de conversion :
// - 1 beat = 1 noire ; la duree d'un diagramme vient de `beatsForShape`.
// - Les marqueurs structurels (barre, renvoi, section) ne consomment pas de
//   temps. Une barre ferme la mesure courante ; un libelle de section est
//   reporte sur la mesure suivante.
// - Les mesures suivent la signature de la chanson ; un accord qui franchit
//   une barre est coupe en deux, la seconde partie etant une liaison (aucune
//   nouvelle attaque).
// - Les cordes qui sonnent suivent `fretForString` : doigtes, barre, capo, puis
//   cordes a vide dans la limite de `sounding` (comme le moteur audio).

import {
  beatsForShape,
  fretForString,
  measureInfoFromSignature,
} from "@/lib/chord-synth";
import type { SavedChordShape } from "@/lib/types";
import { createTiming } from "./timing";
import type {
  PlayerBar,
  PlayerBeat,
  PlayerMeasure,
  PlayerNote,
  PlayerTrack,
  TabPlayerSong,
  TabTechnique,
  TempoPoint,
} from "./types";

/** Accordage standard, index 0 = corde la plus aigue. */
const STANDARD_TUNING = [64, 59, 55, 50, 45, 40];
const STANDARD_LABELS = ["e", "B", "G", "D", "A", "E"];
const STRINGS = 6;
const EPS = 1e-6;

export interface ChordsTabStats {
  bars: number;
  beats: number;
  notes: number;
  /** Notes de continuation (liaisons) produites par un changement de mesure. */
  ties: number;
  /** Nombre de fois ou un accord a ete coupe par une barre. */
  splits: number;
  /** Diagrammes sans note affichable (percussion, instrument non fretté). */
  skipped: number;
  /** Frappes entierement etouffees (aucune corde ne sonne) : silencieuses. */
  mutedHits: number;
  duration: number;
}

export interface ChordsTabResult {
  song: TabPlayerSong;
  stats: ChordsTabStats;
  warnings: string[];
}

export interface ChordsTabOptions {
  title: string;
  artist?: string;
  /** Tempo de reference ; 120 par defaut. */
  bpm?: number;
  timeSignature?: { top: number; bottom: 2 | 4 | 8 } | null;
  /** Libelle d'accordage ("D A F C G C", "Drop D (DADGBE)"...). */
  tuning?: string;
}

const NOTE_PITCH: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

function normalizeTuningToken(token: string): string {
  const accidental = token[1];
  if (accidental === "#" || accidental === "♯") return `${token[0].toUpperCase()}#`;
  if (accidental === "b" || accidental === "♭") return `${token[0].toUpperCase()}b`;
  return token[0].toUpperCase();
}

// Accordage nominal (haut -> bas) a partir des six notes d'un libelle. Les
// octaves sont deduites de l'accordage standard : on garde la hauteur la plus
// proche, puis on verifie que les cordes descendent bien. Un libelle ecrit
// grave -> aigu est reessaye dans l'autre sens.
function tuningFromTokens(tokens: string[]): number[] | null {
  const tuning: number[] = [];
  for (let i = 0; i < STRINGS; i++) {
    const token = tokens[i];
    const pitch = NOTE_PITCH[token[0].toUpperCase()];
    if (pitch === undefined) return null;
    let pc = pitch;
    if (token[1] === "#" || token[1] === "♯") pc += 1;
    if (token[1] === "b" || token[1] === "♭") pc -= 1;
    pc = ((pc % 12) + 12) % 12;

    const base = STANDARD_TUNING[i];
    const diff = (((pc - (base % 12) + 6) % 12) + 12) % 12 - 6;
    tuning.push(base + diff);
  }
  const descending = tuning.every((value, i) => i === 0 || value < tuning[i - 1]);
  return descending ? tuning : null;
}

export function parseTuningLabel(
  label?: string
): { tuning: number[]; labels: string[] } | null {
  if (!label) return null;
  const inner = label.match(/\(([^)]*)\)/);
  const source = inner ? inner[1] : label;
  const tokens = source.match(/[A-Ga-g][#b♯♭]?/g) ?? [];
  if (tokens.length !== STRINGS) return null;

  const forward = tuningFromTokens(tokens);
  if (forward) {
    return { tuning: forward, labels: tokens.map(normalizeTuningToken) };
  }

  const reversed = [...tokens].reverse();
  const backward = tuningFromTokens(reversed);
  if (backward) {
    return { tuning: backward, labels: reversed.map(normalizeTuningToken) };
  }
  return null;
}

// Un diagramme purement structurel (barre, renvoi, libelle seul) ne sonne pas.
function isMarker(shape: SavedChordShape): boolean {
  if (shape.bar || shape.navKind) return true;
  if (shape.sectionLabel === undefined) return false;
  return shape.fingers.length === 0 && !shape.pitchFrequencies?.length;
}

function isTimed(shape: SavedChordShape): boolean {
  return !isMarker(shape);
}

/** Duree totale (en beats) de la sequence, marqueurs exclus. */
export function chordSequenceBeats(diagrams: SavedChordShape[]): number {
  let beats = 0;
  for (const shape of diagrams) {
    if (!isTimed(shape)) continue;
    beats += beatsForShape(shape);
  }
  return beats;
}

// Cordes jouees par un diagramme, en convention flow (0 = mi grave), avec leur
// case. Reprend la logique du moteur audio : doigtes + barre, puis cordes a
// vide seulement si `sounding` en demande (import GP) ou si le diagramme n'a
// aucune information de nombre de cordes (accords de la bibliotheque).
function stringFrets(shape: SavedChordShape): Map<number, number> {
  const out = new Map<number, number>();
  if (shape.silence || shape.drumHits) return out;
  if (shape.fingers.length === 0 && shape.pitchFrequencies?.length) return out;

  const barreCount = shape.barreOn ? shape.barreCount || STRINGS : 0;
  const fingered = new Set<number>();
  for (let s = 0; s < STRINGS; s++) {
    const hasFinger = shape.fingers.some((f) => f.string === s && f.fret >= 0);
    const inBarre = barreCount > 0 && s >= STRINGS - barreCount;
    if (hasFinger || inBarre) fingered.add(s);
  }

  const sounding =
    typeof shape.sounding === "number" ? Math.max(0, shape.sounding) : null;
  let budget =
    sounding === null ? Number.POSITIVE_INFINITY : Math.max(0, sounding - fingered.size);

  for (let s = 0; s < STRINGS; s++) {
    if (fingered.has(s)) {
      out.set(s, Math.max(0, fretForString(shape, s)));
      continue;
    }
    if (budget <= 0 || shape.muted?.[s]) continue;
    out.set(s, Math.max(0, fretForString(shape, s)));
    budget -= 1;
  }

  return out;
}

function notesOf(
  shape: SavedChordShape,
  previous: SavedChordShape | null
): PlayerNote[] {
  const frets = stringFrets(shape);
  if (frets.size === 0) return [];

  const previousFrets = previous ? stringFrets(previous) : null;
  const legato = new Set(previous?.legatoTo ?? []);
  const slides = new Set((shape.slides ?? []).map((s) => s.string));

  const notes: PlayerNote[] = [];
  // Ordre stable : corde la plus aigue d'abord (0..5 cote lecteur).
  for (let flow = 0; flow < STRINGS; flow++) {
    const fret = frets.get(flow);
    if (fret === undefined) continue;

    let technique: TabTechnique = null;
    if (slides.has(flow)) {
      technique = "slide";
    } else if (legato.has(flow)) {
      const from = previousFrets?.get(flow);
      if (from !== undefined && from !== fret) {
        technique = fret > from ? "hammer" : "pull";
      }
    }

    notes.push({
      string: STRINGS - 1 - flow,
      fret,
      technique,
      tie: false,
    });
  }
  return notes;
}

interface DraftMeasure {
  beats: PlayerBeat[];
  filled: number;
  section?: string;
}

// Construit la suite de mesures en coupant les accords aux barres.
class MeasureWriter {
  readonly bars: PlayerBar[] = [];
  readonly measures: PlayerMeasure[] = [];
  notes = 0;
  ties = 0;
  splits = 0;
  private current: DraftMeasure | null = null;
  private pendingSection: string | undefined;

  constructor(
    private readonly beatsPerMeasure: number,
    private readonly time: string
  ) {}

  close(): void {
    const current = this.current;
    if (!current) return;
    if (current.beats.length > 0) {
      this.bars.push({
        beats: +current.filled.toFixed(6),
        time: this.time,
        section: current.section,
      });
      this.measures.push({ beats: current.beats });
    }
    this.current = null;
  }

  /** Une barre ferme la mesure ; son libelle annonce la section suivante. */
  bar(sectionLabel?: string): void {
    this.close();
    if (sectionLabel !== undefined) this.pendingSection = sectionLabel;
  }

  /** Libelle porte par un accord : mesure courante si elle est vide. */
  section(label: string): void {
    if (this.current && this.current.beats.length === 0) {
      this.current.section = label;
      return;
    }
    this.pendingSection = label;
  }

  /** Ecrit une duree en la coupant aux barres. */
  emit(duration: number, shapeNotes: PlayerNote[]): void {
    let remaining = duration;
    let tie = false;
    let wrote = false;

    while (remaining > EPS) {
      const current = this.ensure();
      const capacity = this.beatsPerMeasure - current.filled;
      if (capacity <= EPS) {
        this.close();
        continue;
      }

      const take = Math.min(remaining, capacity);
      const copied = shapeNotes.map((note) => ({ ...note, tie }));
      current.beats.push({ duration: +take.toFixed(6), notes: copied });
      current.filled = +(current.filled + take).toFixed(6);
      this.notes += copied.length;
      if (tie) this.ties += copied.length;
      remaining = +(remaining - take).toFixed(6);
      wrote = true;

      if (remaining > EPS) {
        this.splits += 1;
        this.close();
        tie = true;
      }
    }

    if (wrote && this.current && this.current.filled >= this.beatsPerMeasure - EPS) {
      this.close();
    }
  }

  private ensure(): DraftMeasure {
    if (!this.current) {
      this.current = {
        beats: [],
        filled: 0,
        section: this.pendingSection,
      };
      this.pendingSection = undefined;
    }
    return this.current;
  }
}

export function fromChords(
  diagrams: SavedChordShape[],
  options: ChordsTabOptions
): ChordsTabResult {
  const warnings: string[] = [];
  const info = measureInfoFromSignature(options.timeSignature);
  const time = `${info.top}/${info.bottom}`;
  const writer = new MeasureWriter(Math.max(EPS, info.beatsPerMeasure), time);
  const bpm =
    options.bpm && Number.isFinite(options.bpm) && options.bpm > 0
      ? options.bpm
      : 120;

  let previous: SavedChordShape | null = null;
  let skipped = 0;
  let mutedHits = 0;

  for (const shape of diagrams) {
    if (shape.bar) {
      writer.bar(shape.sectionLabel);
      continue;
    }
    if (shape.navKind) continue;

    if (!isTimed(shape)) {
      if (shape.sectionLabel !== undefined) writer.section(shape.sectionLabel);
      continue;
    }

    if (shape.sectionLabel !== undefined && shape.fingers.length > 0) {
      writer.section(shape.sectionLabel);
    }

    const shapeNotes = notesOf(shape, previous);
    if (shapeNotes.length === 0 && !shape.silence) {
      if (shape.sounding === 0 || (shape.fingers.length === 0 && shape.muted?.some(Boolean))) {
        mutedHits += 1;
      } else {
        skipped += 1;
      }
    }

    // Une percussion ou un instrument non fretté occupe quand meme le temps :
    // la mesure avance avec des temps vides plutot que de decaler la suite.
    writer.emit(beatsForShape(shape), shapeNotes);
    previous = shape;
  }

  writer.close();

  if (writer.bars.length === 0) {
    warnings.push("Aucun diagramme jouable : la sequence est vide.");
  }
  if (skipped > 0) {
    warnings.push(
      `${skipped} diagramme(s) sans note de guitare (percussion ou instrument non fretté).`
    );
  }

  const tempo: TempoPoint[] = [{ beat: 0, bpm }];
  const totalBeats = writer.bars.reduce((sum, bar) => sum + bar.beats, 0);
  const parsedTuning = parseTuningLabel(options.tuning);
  const track: PlayerTrack = {
    meta: {
      id: "chords",
      name: "Guitare",
      short: "GTR",
      tuning: parsedTuning?.tuning ?? STANDARD_TUNING,
      labels: parsedTuning?.labels ?? STANDARD_LABELS,
    },
    measures: writer.measures,
  };

  const song: TabPlayerSong = {
    title: options.title,
    artist: options.artist,
    source: [options.artist, options.title].filter(Boolean).join(" - "),
    bars: writer.bars,
    tempo,
    tracks: [track],
  };

  return {
    song,
    stats: {
      bars: writer.bars.length,
      beats: +totalBeats.toFixed(6),
      notes: writer.notes,
      ties: writer.ties,
      splits: writer.splits,
      skipped,
      mutedHits,
      duration: createTiming(tempo, totalBeats).duration,
    },
    warnings,
  };
}
