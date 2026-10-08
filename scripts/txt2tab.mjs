// CLI : convertit un texte (grille d'accords / paroles) en tablature ASCII et,
// optionnellement, en fichier MIDI.
// Usage : node scripts/txt2tab.mjs <texte.txt> [sortie.mid]
import { readFileSync, writeFileSync } from "node:fs";
import { textToTab } from "../src/lib/text-to-tab.ts";
import { asciiTabToMidi } from "../src/lib/ascii-tab-midi.ts";

const [input, output] = process.argv.slice(2);
if (!input) {
  console.error("Usage : node scripts/txt2tab.mjs <texte.txt> [sortie.mid]");
  process.exit(1);
}

const result = textToTab(readFileSync(input, "utf8"));
console.log(`Mesures    : ${result.measures}`);
console.log(`Accords    : ${result.chordsDetected.join(", ") || "aucun"}`);
if (result.unknown.length > 0) {
  console.log(`Ignoré     : ${[...new Set(result.unknown)].join(", ")}`);
}
console.log("--- Tablature ---");
console.log(result.tab);
console.log("-----------------");

if (result.tab) {
  const bytes = asciiTabToMidi(result.tab);
  if (output) {
    writeFileSync(output, bytes);
    console.log(`Fichier    : ${output} (${bytes.length} octets)`);
    if (input === "scripts/tab-text-sample.txt") {
      console.log(
        "Astuce     : pour convertir cette tablature en MIDI, utilisez scripts/tab2midi.mjs."
      );
    }
  }
}