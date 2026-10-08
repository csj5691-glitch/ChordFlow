// Runner « partition → tablature » : lit des notes (JSON) ou une démo intégrée,
// rend la tablature ASCII (src/lib/notes-to-tab.ts, pur) et valide l'aller-retour
// avec asciiTabToMidi (parse + SMF). Usage :
//   node scripts/notation2tab.mjs [notes.json] [--out sortie.mid]
// notes.json : { title?, bpm?, notes: [{ pitch, startTick, durationTicks }] }
// (480 ticks = 1 temps, mesure = 1920 ticks = 4/4)

import { readFileSync, writeFileSync } from "node:fs";
import { notesToTab } from "../src/lib/notes-to-tab.ts";
import { asciiTabToMidi, parseAsciiTab } from "../src/lib/ascii-tab-midi.ts";

// Démo : Frère Jacques (2 portées en do majeur), un G7 entier conclut.
const DEMO = {
  title: "Frere Jacques (partition -> tab)",
  bpm: 100,
  notes: [
    { pitch: 60, startTick: 0, durationTicks: 480 },
    { pitch: 62, startTick: 480, durationTicks: 480 },
    { pitch: 64, startTick: 960, durationTicks: 480 },
    { pitch: 60, startTick: 1440, durationTicks: 480 },

    { pitch: 60, startTick: 1920, durationTicks: 480 },
    { pitch: 62, startTick: 2400, durationTicks: 480 },
    { pitch: 64, startTick: 2880, durationTicks: 480 },
    { pitch: 60, startTick: 3360, durationTicks: 480 },

    { pitch: 64, startTick: 3840, durationTicks: 480 },
    { pitch: 65, startTick: 4320, durationTicks: 480 },
    { pitch: 67, startTick: 4800, durationTicks: 960 },
    // accord à la louche d'une fin
    { pitch: 67, startTick: 6720, durationTicks: 1920 },
    { pitch: 64, startTick: 6720, durationTicks: 1920 },
    { pitch: 60, startTick: 6720, durationTicks: 1920 },
    // note hors guitare (trop grave pour l'accordage standard) : doit être rejetée
    { pitch: 33, startTick: 6758, durationTicks: 480 },
  ],
};

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const outPath = outIdx >= 0 ? args[outIdx + 1] : null;
const jsonIdx = outIdx >= 0 ? (outIdx === 0 ? -1 : args.indexOf("--out") === 0 ? -1 : 0) : 0;
const notesPath = args[0] && args[0] !== "--out" ? args[0] : null;

let input;
if (notesPath) {
  input = JSON.parse(readFileSync(notesPath, "utf8"));
} else {
  input = DEMO;
}

const result = notesToTab(input.notes, { title: input.title, bpm: input.bpm });
console.log("Mesures   :", result.measures);
console.log("Notes     :", result.noteCount);
console.log("Accords   :", result.chordCount);
console.log("Rejetées  :", result.dropped, result.outOfRange.length ? `(${result.outOfRange.join(", ")})` : "");
console.log("--- Tablature ---");
console.log(result.tab);

const parsed = parseAsciiTab(result.tab);
const lastEnd = parsed.events.reduce((m, e) => Math.max(m, e.startTick + e.durationTicks), 0);
const durationSec = (lastEnd / parsed.ticksPerBeat) * (60 / parsed.bpm);
console.log("--- Verif ---");
console.log(`Evenements MIDI : ${parsed.events.length} | fin à ${(lastEnd / parsed.ticksPerBeat).toFixed(1)} temps = ${durationSec.toFixed(2)} s`);

if (outPath) {
  writeFileSync(outPath, asciiTabToMidi(result.tab));
  console.log(`MIDI écrit : ${outPath}`);
}