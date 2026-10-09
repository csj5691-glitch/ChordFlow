// Démo « import GP → interprétation note-à-note » :
// lit une piste Guitar Pro (alphaTab), regroupe les notes en UNITÉS HARMONIQUES,
// mesure cluster/spread, classe l'articulation (arpège / plaqué / roulé / hybride /
// note) puis fusionne en SECTIONS. C'est la théorie du fil, appliquée à un vrai fichier.
//
// Usage : node scripts/gp-articulation.mjs <fichier.gp> [--track <index|nom>] [--list]

import { readFileSync } from "node:fs";
import { importer, model } from "@coderline/alphatab";
import { guessChordLabel } from "../src/lib/tab-view.ts";

const TPB = 480; // ticks par temps
const MAX_GAP = 1.25 * TPB; // au-delà, on coupe l'unité harmonique

const DURATION_TO_BEATS = {
  [model.Duration.QuadrupleWhole]: 16,
  [model.Duration.DoubleWhole]: 8,
  [model.Duration.Whole]: 4,
  [model.Duration.Half]: 2,
  [model.Duration.Quarter]: 1,
  [model.Duration.Eighth]: 0.5,
  [model.Duration.Sixteenth]: 0.25,
  [model.Duration.ThirtySecond]: 0.125,
  [model.Duration.SixtyFourth]: 0.0625,
  [model.Duration.OneHundredTwentyEighth]: 0.03125,
};

function beatBeats(beat) {
  let b = DURATION_TO_BEATS[beat.duration] ?? 1;
  for (let i = 0; i < beat.dots; i++) b += b * 0.5;
  if (beat.tupletNumerator > 0 && beat.tupletDenominator > 0) {
    b *= (3 * beat.tupletDenominator) / beat.tupletNumerator;
  }
  return b;
}

const args = process.argv.slice(2);
const gpPath = args[0];
if (!gpPath || gpPath.startsWith("--")) {
  console.error("Usage : node scripts/gp-articulation.mjs <fichier.gp> [--track <index|nom>] [--list]");
  process.exit(1);
}
const listOnly = args.includes("--list");
const tIdx = args.indexOf("--track");
const trackSel = tIdx >= 0 ? args[tIdx + 1] : null;

const bytes = new Uint8Array(readFileSync(gpPath));
const score = importer.ScoreLoader.loadScoreFromBytes(bytes);

function trackInfo(i) {
  const t = score.tracks[i];
  const st = t.staves[0];
  return {
    i,
    name: t.name || `Piste ${i + 1}`,
    strings: st?.tuning?.length ?? 0,
    perc: st?.isPercussion ?? false,
    program: t.playbackInfo?.program ?? null,
  };
}

const infos = score.tracks.map((_, i) => trackInfo(i));
console.log(`Fichier  : ${score.title || gpPath}  —  ${score.artist || "?"}`);
console.log(`Tempo    : ${score.tempo ?? 120} BPM  ·  ${score.masterBars.length} mesures`);
console.log("--- Pistes ---");
for (const t of infos) {
  console.log(
    `  [${t.i}] ${t.perc ? "[batterie] " : ""}${t.name}  (${t.strings} cordes, prog ${t.program})`
  );
}
if (listOnly) process.exit(0);

// Sélection de piste : index explicite, nom partiel, sinon 1re guitare 6 cordes.
let ti = 0;
if (trackSel !== null) {
  if (/^\d+$/.test(trackSel)) ti = Number(trackSel);
  else {
    const hit = infos.find((t) => t.name.toLowerCase().includes(trackSel.toLowerCase()));
    if (!hit) {
      console.error(`Piste « ${trackSel} » introuvable.`);
      process.exit(1);
    }
    ti = hit.i;
  }
} else {
  const g = infos.find((t) => !t.perc && t.strings === 6);
  ti = g ? g.i : 0;
}

const track = score.tracks[ti];
const staff = track.staves[0];
console.log(`\n=== Piste analysée : [${ti}] ${track.name} (${staff.tuning.length} cordes) ===`);

// --- Extraction note-à-note (tick global sur toute la piste) ---
const events = [];
let barStartBeats = 0;
for (let m = 0; m < score.masterBars.length; m++) {
  const bar = staff.bars[m];
  const mb = score.masterBars[m];
  if (bar) {
    for (let vi = 0; vi < bar.voices.length; vi++) {
      const voice = bar.voices[vi];
      let pos = 0;
      for (const beat of voice.beats) {
        const dur = beatBeats(beat);
        if (!beat.isRest && !beat.isEmpty && beat.notes.length > 0) {
          const startTick = Math.round((barStartBeats + pos) * TPB);
          for (const note of beat.notes) {
            if (note.isTieDestination) continue;
            events.push({
              startTick,
              durTicks: Math.round(dur * TPB),
              string: note.string,
              fret: note.fret,
              pitch: note.realValue,
              voice: vi,
              bar: m,
              dead: !!note.isDead,
              hammer: !!note.isHammerPullOrigin,
            });
          }
        }
        pos += dur;
      }
    }
  }
  const num = mb?.timeSignatureNumerator ?? 4;
  const den = mb?.timeSignatureDenominator ?? 4;
  barStartBeats += (4 * num) / den;
}

if (events.length === 0) {
  console.error("Aucune note.");
  process.exit(1);
}

// --- Regroupement en attaques (même onset) ---
const byTick = new Map();
for (const e of events) {
  if (!byTick.has(e.startTick)) byTick.set(e.startTick, []);
  byTick.get(e.startTick).push(e);
}
const attacks = [...byTick.entries()]
  .sort((a, b) => a[0] - b[0])
  .map(([tick, notes]) => ({ tick, notes, count: notes.length }));

// --- Unités harmoniques (continuité + écart max) ---
// union des frets par corde (index OPEN_NOTES : 0 = corde aiguë) pour guessChordLabel
function labelFor(notes) {
  const frets = Array(6).fill(null);
  for (const n of notes) {
    const tabIdx = 6 - n.string; // gpString 1 = grave -> index 5
    if (tabIdx >= 0 && tabIdx < 6) frets[tabIdx] = n.fret;
  }
  return guessChordLabel(frets);
}

const units = [];
let cur = null;
for (const atk of attacks) {
  const gap = cur ? atk.tick - cur.lastTick : Infinity;
  const cand = cur ? [...cur.notes, ...atk.notes] : atk.notes;
  const candLabel = labelFor(cand);
  const sameHarmony = !cur || candLabel === cur.label || cur.label === null || candLabel === null;
  if (cur && gap <= MAX_GAP && sameHarmony) {
    cur.notes.push(...atk.notes);
    cur.attacks.push(atk);
    cur.lastTick = atk.tick;
    cur.label = candLabel;
  } else {
    cur = {
      notes: [...atk.notes],
      attacks: [atk],
      firstTick: atk.tick,
      lastTick: atk.tick,
      label: labelFor(atk.notes),
      bar: atk.notes[0].bar,
    };
    units.push(cur);
  }
}

// --- Classification de l'articulation ---
// note   : une seule note (1 attaque)
// plaque : attaque(s) en bloc (cluster >= 2) — accord plaqué, éventuellement répété (rythmique)
// roule  : pas d'accord en bloc, mais des notes très serrées (<= 1/2 temps) formant un accord "roulé"
// arpege : notes successives étalées (mélodie / arpège brisé)
// hybride: mélange bloc + note isolée dans la même unité
function classify(u) {
  const counts = u.attacks.map((a) => a.count);
  const cluster = Math.max(...counts);
  const spread = u.lastTick - u.firstTick;
  const spreadBeats = spread / TPB;
  const block = counts.filter((c) => c >= 2).length;
  const single = counts.filter((c) => c === 1).length;
  let art;
  if (u.notes.length === 1) art = "note";
  else if (block > 0 && single > 0) art = "hybride";
  else if (block > 0) art = "plaque";
  else if (counts.length >= 3 && spreadBeats <= 0.5) art = "roule";
  else art = "arpege";
  return { cluster, spread, spreadBeats, art };
}
for (const u of units) Object.assign(u, classify(u));

// --- Fusion en sections (runs d'articulation homogène) ---
const sections = [];
for (const u of units) {
  const last = sections[sections.length - 1];
  if (last && last.art === u.art) {
    last.endBar = u.bar;
    last.units += 1;
    if (u.label && !last.chords.includes(u.label)) last.chords.push(u.label);
  } else {
    sections.push({
      art: u.art,
      startBar: u.bar,
      endBar: u.bar,
      units: 1,
      chords: u.label ? [u.label] : [],
    });
  }
}

// --- Lissage : absorbe les fragments d'1 unité dans leurs voisins, puis recolle ---
function smooth(sections) {
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i];
      if (s.units > 1) continue;
      const prev = sections[i - 1]?.art ?? null;
      const next = sections[i + 1]?.art ?? null;
      const pick = prev && prev === next ? prev : next ?? prev;
      if (pick && pick !== s.art) s.art = pick;
    }
    for (let i = sections.length - 1; i > 0; i--) {
      if (sections[i].art === sections[i - 1].art) {
        sections[i - 1].endBar = sections[i].endBar;
        sections[i - 1].units += sections[i].units;
        for (const c of sections[i].chords) {
          if (!sections[i - 1].chords.includes(c)) sections[i - 1].chords.push(c);
        }
        sections.splice(i, 1);
      }
    }
  }
}
smooth(sections);

const ACCENT = {
  arpege: "ARPÈGE",
  plaque: "PLAQUÉ",
  roule: "ROULÉ",
  hybride: "HYBRIDE",
  note: "NOTE",
};

console.log(`\nÉvènements : ${events.length} notes · ${attacks.length} attaques · ${units.length} unités`);
console.log("\n--- Unités (extrait) ---");
console.log("  mes.  accord  cluster  spread  articulation");
for (const u of units.slice(0, 40)) {
  console.log(
    `  ${String(u.bar + 1).padStart(4)}  ${(u.label ?? "·").padEnd(6)}  ${String(u.cluster).padStart(4)}  ${(u.spread / TPB).toFixed(2).padStart(5)}  ${ACCENT[u.art]}`
  );
}
if (units.length > 40) console.log(`  … ${units.length - 40} unités de plus`);

console.log("\n--- Interprétation : sections ---");
for (const s of sections) {
  const range = s.startBar === s.endBar ? `mes. ${s.startBar + 1}` : `mes. ${s.startBar + 1}–${s.endBar + 1}`;
  console.log(`  [${ACCENT[s.art].padEnd(7)}] ${range.padEnd(14)} ${s.units} unités   ${s.chords.join("  ") || ""}`);
}

const timeline = sections.map((s) => ACCENT[s.art]).join("  →  ");
console.log(`\nForme : ${timeline}`);
