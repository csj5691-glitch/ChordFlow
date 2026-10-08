// Convertit un texte de tablature (export Guitar Pro / Songsterr) en fichier MIDI.
// Usage : node scripts/tab2midi.mjs <entrée.txt> <sortie.mid>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { asciiTabToMidi, parseAsciiTab } from "../src/lib/ascii-tab-midi.ts";

const input = resolve(process.argv[2] ?? "scripts/tab-weakness.txt");
const output = resolve(process.argv[3] ?? "public/tabs/weakness.mid");
const text = readFileSync(input, "utf8");
const parsed = parseAsciiTab(text);
const bytes = asciiTabToMidi(text);
const dir = dirname(output);
mkdirSync(dir, { recursive: true });
writeFileSync(output, bytes);

console.log(`Titre      : ${parsed.title}`);
console.log(`Tempo      : ${parsed.bpm} BPM`);
console.log(`Portées    : ${parsed.staffs}`);
console.log(`Mesures    : ${parsed.bars}`);
console.log(`Notes      : ${parsed.events.length}`);
const lastEnd = parsed.events.reduce((m, e) => Math.max(m, e.startTick + e.durationTicks), 0);
const seconds = (lastEnd / (parsed.ticksPerBeat * parsed.bpm)) * 60;
console.log(`Durée      : ~${seconds.toFixed(1)} s`);
console.log(`Fichier    : ${output} (${bytes.length} octets)`);
void _midiHeaderCheck(bytes);

function _midiHeaderCheck(b) {
  if (b.length < 14) throw new Error("SMF trop court");
  const magic = String.fromCharCode(...b.slice(0, 4));
  const fmt = (b[8] << 8) | b[9];
  const nTracks = (b[10] << 8) | b[11];
  const ppq = (b[12] << 8) | b[13];
  if (magic !== "MThd" || nTracks < 1 || ppq === 0) {
    throw new Error(`Entête SMF invalide (${magic}, ${nTracks} pistes, PPQ ${ppq})`);
  }
  const codes = [0x90, 0x80, 0xc0, 0xff];
  let noteOn = 0;
  let program = null;
  for (let i = 14; i < b.length; i++) {
    if (!codes.includes(b[i])) continue;
    const status = b[i];
    if (status === 0x90) {
      noteOn++;
      program = null;
    } else if (status === 0xc0) program = b[i + 1 >= b.length ? 0 : i + 1];
  }
  console.log(`Sanity SMF  : ${fmt === 0 ? "format 0" : fmt === 1 ? "format 1" : fmt} · ${nTracks} piste(s) · PPQ ${ppq} · virgule ${program ?? "?"} · noteOn ${noteOn}`);
}