// Copyright (c) 2026 Claude St-Jean. All rights reserved.

// Modele de donnees du moteur de tablature animee.
//
// Ce modele est volontairement independant de React et d'alphaTab : un morceau
// decrit des mesures en beats (1 beat = 1 noire), une carte de tempo, et des
// pistes avec leur accordage. L'adaptateur (from-alphaTab.ts) et le rendu
// (TabPlaybackView) sont les deux seuls consommateurs.

/** Technique affichee au-dessus (ou sur) la note. */
export type TabTechnique =
  | "hammer"
  | "pull"
  | "slide"
  | "bend"
  | "vibrato"
  | "dead"
  | null;

export interface PlayerNote {
  /** 0 = corde la plus aigue (ligne du haut), comme a l'affichage. */
  string: number;
  fret: number;
  technique: TabTechnique;
  /** Prolongation d'une note precedente : pas de nouvelle attaque. */
  tie: boolean;
}

export interface PlayerBeat {
  /** Duree en beats (0.5 = croche, 1 = noire, 1.5 = noire pointee). */
  duration: number;
  notes: PlayerNote[];
  /** Syllabe optionnelle ; ChordFlow garde son propre moteur de paroles. */
  lyric?: string | null;
}

export interface PlayerMeasure {
  beats: PlayerBeat[];
}

export interface PlayerBar {
  /** Longueur nominale de la mesure en beats (4/4 = 4). */
  beats: number;
  /** Signature affichee, par exemple "4/4". */
  time: string;
  section?: string;
}

export interface PlayerTrackMeta {
  id: string;
  name: string;
  short: string;
  /** Hauteurs MIDI, index 0 = corde la plus aigue. */
  tuning: number[];
  /** Libelles affiches, index 0 = corde la plus aigue. */
  labels: string[];
  color?: string;
}

export interface PlayerTrack {
  meta: PlayerTrackMeta;
  measures: PlayerMeasure[];
}

export interface TempoPoint {
  beat: number;
  bpm: number;
}

export interface TabPlayerSong {
  title: string;
  artist?: string;
  source?: string;
  bars: PlayerBar[];
  tempo: TempoPoint[];
  tracks: PlayerTrack[];
}
