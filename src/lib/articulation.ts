// Copyright (c) 2026 Claude St-Jean. All rights reserved.

// Découpe une séquence de diagrammes en « séquences » d'articulation : suites
// d'arpèges (notes isolées), suites d'accords (blocs), ou passages hybrides.
// Aucune hypothèse sur le début ou la fin du morceau : on étiquette seulement
// chaque séquence l'une après l'autre, dans l'ordre.

import type { SavedChordShape } from "./types";

export type ArticulationKind = "arpeges" | "accords" | "hybride";

export interface ArticulationSequence {
  kind: ArticulationKind;
  start: number; // index du premier diagramme de la séquence
  end: number; // index du dernier diagramme (inclus)
}

export const ARTICULATION_SHORT: Record<ArticulationKind, string> = {
  arpeges: "Arpèges",
  accords: "Accords",
  hybride: "Hybride",
};

export const ARTICULATION_LABEL: Record<ArticulationKind, string> = {
  arpeges: "Suite d'arpèges (notes isolées)",
  accords: "Suite d'accords (blocs)",
  hybride: "Hybride (arpèges + accords)",
};

// Classes Tailwind par articulation (bandeau + liseré des cartes).
export const ARTICULATION_CHIP: Record<ArticulationKind, string> = {
  arpeges: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30",
  accords: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  hybride: "bg-violet-500/10 text-violet-300 border-violet-500/30",
};

export const ARTICULATION_BORDER: Record<ArticulationKind, string> = {
  arpeges: "border-l-cyan-400/70",
  accords: "border-l-amber-400/70",
  hybride: "border-l-violet-400/70",
};

// Nombre de cordes qui sonnent sur un diagramme. On privilégie le champ
// explicite posé à l'import GP ; sinon on retombe sur les doigtés (cordes à
// vide incluses pour les formes construites à la main ou extraites note à note).
export function soundingNotes(shape: SavedChordShape): number {
  if (typeof shape.sounding === "number") return shape.sounding;
  if (shape.fingers.length === 0 && shape.pitchFrequencies) {
    return shape.pitchFrequencies.length;
  }
  return shape.fingers.length;
}

// Un diagramme « neutre » (barre, renvoi, section, silence, batterie) ne
// participe pas à l'articulation : il coupe la séquence.
export function isNeutralDiagram(shape: SavedChordShape): boolean {
  if (shape.bar || shape.navKind || shape.silence) return true;
  if (shape.sectionLabel !== undefined) return true;
  if (shape.drumHits) return true;
  if (soundingNotes(shape) > 0) return false;
  // Aucune corde qui sonne : un strum entièrement étouffé reste un accord
  // rythmique ; sinon le diagramme est neutre.
  return !shape.muted?.some(Boolean);
}

// Demi-fenêtre de la moyenne glissante qui produit les passages « hybrides ».
const WINDOW = 3;

function windowKind(roles: ("single" | "chord")[], i: number): ArticulationKind {
  let chords = 0;
  let singles = 0;
  const from = Math.max(0, i - WINDOW);
  const to = Math.min(roles.length - 1, i + WINDOW);
  for (let j = from; j <= to; j++) {
    if (roles[j] === "chord") chords += 1;
    else singles += 1;
  }
  const total = chords + singles;
  if (total === 0) return "arpeges";
  const fraction = chords / total;
  if (fraction <= 1 / 3) return "arpeges";
  if (fraction >= 2 / 3) return "accords";
  return "hybride";
}

// Absorbe les îlots d'un seul diagramme dont les deux voisins s'accordent.
function smoothKinds(kinds: ArticulationKind[]): void {
  for (let pass = 0; pass < 3; pass++) {
    for (let k = 1; k < kinds.length - 1; k++) {
      if (kinds[k] !== kinds[k - 1] && kinds[k - 1] === kinds[k + 1]) {
        kinds[k] = kinds[k - 1];
      }
    }
  }
}

function appendRun(
  diagrams: SavedChordShape[],
  start: number,
  end: number,
  out: ArticulationSequence[]
): void {
  const roles: ("single" | "chord")[] = [];
  for (let i = start; i <= end; i++) {
    roles.push(soundingNotes(diagrams[i]) >= 2 ? "chord" : "single");
  }
  const kinds = roles.map((_, i) => windowKind(roles, i));
  smoothKinds(kinds);

  let seqStart = start;
  let cur = kinds[0];
  for (let k = 1; k < kinds.length; k++) {
    if (kinds[k] !== cur) {
      out.push({ kind: cur, start: seqStart, end: start + k - 1 });
      seqStart = start + k;
      cur = kinds[k];
    }
  }
  out.push({ kind: cur, start: seqStart, end });
}

export function detectArticulationSequences(
  diagrams: SavedChordShape[]
): ArticulationSequence[] {
  const sequences: ArticulationSequence[] = [];
  let runStart = -1;
  for (let i = 0; i <= diagrams.length; i++) {
    const neutral = i >= diagrams.length || isNeutralDiagram(diagrams[i]);
    if (!neutral && runStart === -1) {
      runStart = i;
      continue;
    }
    if (neutral && runStart !== -1) {
      appendRun(diagrams, runStart, i - 1, sequences);
      runStart = -1;
    }
  }
  return sequences;
}

// Carte index de diagramme → articulation, pour colorer la liste.
export function articulationByIndex(
  sequences: ArticulationSequence[]
): Map<number, ArticulationKind> {
  const map = new Map<number, ArticulationKind>();
  for (const seq of sequences) {
    for (let i = seq.start; i <= seq.end; i++) map.set(i, seq.kind);
  }
  return map;
}
