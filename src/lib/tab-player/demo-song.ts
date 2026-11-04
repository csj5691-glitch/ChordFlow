// Copyright (c) 2026 Claude St-Jean. All rights reserved.

// Morceau de demonstration du POC : contenu original, 8 mesures, deux pistes,
// changement de metre (3/4) et de tempo, hammer-on, pull-off, glisse, bend,
// vibrato, note etouffee et liaison. Il sert a verifier le moteur sans avoir a
// charger un fichier externe.

import type { PlayerBeat, PlayerMeasure, TabPlayerSong } from "./types";

const GUITAR = {
  id: "gtr",
  name: "Guitare",
  short: "GTR",
  tuning: [64, 59, 55, 50, 45, 40], // e B G D A E (index 0 = aigu)
  labels: ["e", "B", "G", "D", "A", "E"],
};

const BASS = {
  id: "bass",
  name: "Basse",
  short: "BAS",
  tuning: [43, 38, 33, 28], // G D A E (index 0 = aigu)
  labels: ["G", "D", "A", "E"],
};

const n = (string: number, fret: number, technique: PlayerBeat["notes"][number]["technique"] = null, tie = false) => ({
  string,
  fret,
  technique,
  tie,
});

const q = (...notes: PlayerBeat["notes"]): PlayerBeat => ({ duration: 1, notes });
const e = (...notes: PlayerBeat["notes"]): PlayerBeat => ({ duration: 0.5, notes });
const h = (...notes: PlayerBeat["notes"]): PlayerBeat => ({ duration: 2, notes });

const guitar: PlayerMeasure[] = [
  { beats: [q(n(5, 0)), q(n(3, 2)), q(n(2, 0)), q(n(1, 0))] },
  { beats: [q(n(0, 0)), q(n(0, 2, "hammer")), q(n(0, 0, "pull")), q(n(1, 0))] },
  { beats: [q(n(0, 0)), q(n(0, 3, "slide")), q(n(1, 3, "bend")), q(n(2, 4, "vibrato"))] },
  { beats: [q(n(0, 0, "dead")), q(n(1, 1)), q(n(1, 1, null, true)), q(n(2, 2))] },
  { beats: [q(n(0, 0)), q(n(0, 2, "hammer")), q(n(0, 0, "pull"))] },
  {
    beats: [
      e(n(3, 2)), e(), e(n(3, 2)), e(),
      e(n(2, 0)), e(), e(n(1, 0)), e(),
    ],
  },
  {
    beats: [
      q(n(0, 3), n(1, 5), n(2, 5), n(3, 5)),
      q(n(0, 3), n(1, 5), n(2, 5), n(3, 5)),
      q(n(0, 5), n(1, 7), n(2, 7), n(3, 7)),
      q(n(0, 5), n(1, 7), n(2, 7), n(3, 7)),
    ],
  },
  {
    beats: [
      h(n(0, 3), n(1, 5), n(2, 5), n(3, 5)),
      h(n(0, 3, null, true), n(1, 5), n(2, 5), n(3, 5)),
    ],
  },
];

const bass: PlayerMeasure[] = [
  { beats: [q(n(3, 0)), q(n(3, 0)), q(n(3, 0)), q(n(3, 0))] },
  { beats: [q(n(3, 0)), q(n(3, 0)), q(n(2, 2)), q(n(2, 2))] },
  { beats: [q(n(2, 0)), q(n(2, 0)), q(n(1, 2)), q(n(1, 2))] },
  { beats: [q(n(3, 0)), q(n(3, 0)), q(n(3, 0)), q(n(3, 0))] },
  { beats: [q(n(3, 0)), q(n(3, 0)), q(n(3, 0))] },
  {
    beats: [e(n(3, 0)), e(n(3, 0)), e(n(3, 0)), e(n(3, 0)),
      e(n(3, 0)), e(n(3, 0)), e(n(3, 0)), e(n(3, 0))],
  },
  { beats: [q(n(2, 0)), q(n(2, 0)), q(n(1, 2)), q(n(1, 2))] },
  { beats: [h(n(3, 0)), h(n(3, 0))] },
];

export const demoSong: TabPlayerSong = {
  title: "Demi-jour",
  artist: "demonstration",
  source: "demo locale",
  bars: [
    { beats: 4, time: "4/4", section: "Intro" },
    { beats: 4, time: "4/4" },
    { beats: 4, time: "4/4", section: "Couplet" },
    { beats: 4, time: "4/4" },
    { beats: 3, time: "3/4", section: "Pont" },
    { beats: 4, time: "4/4" },
    { beats: 4, time: "4/4", section: "Refrain" },
    { beats: 4, time: "4/4" },
  ],
  tempo: [
    { beat: 0, bpm: 92 },
    { beat: 16, bpm: 104 },
    { beat: 19, bpm: 92 },
  ],
  tracks: [
    { meta: GUITAR, measures: guitar },
    { meta: BASS, measures: bass },
  ],
};
