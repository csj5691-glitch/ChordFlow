// Convertisseur « texte de tablature (export Guitar Pro / Songsterr) → MIDI ».
// Auto-suffisant (aucun import) : exécutable en Node (type stripping) et côté client.

export interface AsciiTabEvent {
  pitch: number;
  velocity: number;
  startTick: number;
  durationTicks: number;
}

export interface AsciiTabParseResult {
  bpm: number;
  ticksPerBeat: number;
  events: AsciiTabEvent[];
  bars: number;
  staffs: number;
  title: string;
}

const OPEN_NOTES = [64, 59, 55, 50, 45, 40]; // position : corde 1 (aiguë) → 6 (grave)
const DEFAULT_BPM = 120;
export const DEFAULT_PROGRAM = 27; // Clean Electric Guitar

interface Token {
  fret: number | null; // null => note étouffée (x)
  tie: boolean;
  accent: boolean;
  soft: boolean;
  staccato: boolean;
}

const TARGET_FLAGS = new Set(["h", "b", "s", "t", "p"]);
const SOFT_FLAGS = new Set(["g", "m"]);
const ACCENT_FLAGS = new Set([">", "^"]);

function tokenizeCell(cell: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < cell.length) {
    const ch = cell[i];
    if (ch >= "0" && ch <= "9") {
      let j = i;
      let fretRaw = "";
      while (j < cell.length && cell[j] >= "0" && cell[j] <= "9") {
        fretRaw += cell[j];
        j++;
      }
      const fret = fretRaw === "" ? null : parseInt(fretRaw, 10);
      const tok: Token = { fret, tie: false, accent: false, soft: false, staccato: false };
      let k = j;
      while (k < cell.length) {
        const c = cell[k].toLowerCase();
        if (c === "l") {
          tok.tie = true;
          k++;
        } else if (ACCENT_FLAGS.has(cell[k])) {
          tok.accent = true;
          k++;
        } else if (SOFT_FLAGS.has(c)) {
          tok.soft = true;
          k++;
        } else if (c === ".") {
          tok.staccato = true;
          k++;
        } else if (TARGET_FLAGS.has(c)) {
          // technique avec cible ("3h5", "5b7", "5s7") : avale les chiffres suivants
          let q = k + 1;
          while (q < cell.length && cell[q] >= "0" && cell[q] <= "9") q++;
          k = q;
        } else {
          break; // séparateur ("-", "." hors flag, etc.) → fin du token
        }
      }
      out.push(tok);
      i = k;
      continue;
    }
    if (ch === "x" || ch === "X") {
      out.push({ fret: null, tie: false, accent: false, soft: true, staccato: true });
      i++;
      continue;
    }
    i++;
  }
  return out;
}

function trimCell(cell: string): string {
  return cell.replace(/[oO]/g, "").replace(/^-+/, "").replace(/-+$/, "");
}

// Rangée de tablature : commence par `-`, une lettre de corde (E/B/G/D/A) ou un
// indicateur `o`, contient une `|` et au moins un `-`. Les rangées vides (repos,
// cordes muettes) comptent aussi : elles font partie du bloc de 6 lignes d'une
// portée — sinon l'alignement des mesures dérive.
function isTabRow(line: string): boolean {
  return /^[-\soEBGDAebgda]/.test(line) && line.includes("|") && line.includes("-");
}

function nearestClusterIdx(clusters: number[], col: number): number {
  let best = 0;
  let bestD = Math.abs(clusters[0] - col);
  for (let i = 1; i < clusters.length; i++) {
    const d = Math.abs(clusters[i] - col);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// Découpe une portée de 6 rangées en mesures, alignées sur les colonnes des barreaux
// `|` (les indicateurs `o` des reprises créent des cellules de tailles différentes
// selon les cordes : alignement par colonne et non par simple split).
function parseStaff(rows: string[]): Token[][][] {
  const cleanedRows = rows.map((line) =>
    line.replace(/^[EBGDAebgda]\s*\|\|?/, "").replace(/\s+/g, "")
  );
  const delimCols = cleanedRows.map((s) => {
    const cols: number[] = [];
    for (let i = 0; i < s.length; i++) if (s[i] === "|") cols.push(i);
    return cols;
  });
  const clusters: number[] = [];
  for (const cols of delimCols) {
    for (const col of cols) {
      let found = false;
      for (const c of clusters) {
        if (Math.abs(c - col) <= 4) {
          found = true;
          break;
        }
      }
      if (!found) clusters.push(col);
    }
  }
  clusters.sort((a, b) => a - b);
  const measures = clusters.length + 1;
  const out: Token[][][] = Array.from({ length: measures }, () =>
    Array.from({ length: 6 }, () => [] as Token[])
  );

  cleanedRows.forEach((s, ri) => {
    const cols = delimCols[ri];
    const cellPieces: { start: number; end: number }[] = [];
    let prev = 0;
    for (const c of cols) {
      cellPieces.push({ start: prev, end: c });
      prev = c + 1;
    }
    if (prev < s.length) cellPieces.push({ start: prev, end: s.length });
    for (const piece of cellPieces) {
      // La cellule se termine au barreau colonne `end` ; la mesure correspondante est
      // indexée par le cluster le plus proche de ce barreau (ou la dernière mesure si
      // la cellule est après le dernier barreau).
      const endIsDelim = cols.some((c) => piece.end === c);
      let measureIdx: number;
      if (!endIsDelim) {
        measureIdx = measures - 1; // cellule de fin (pas de `|` après)
      } else {
        const cIdx = nearestClusterIdx(clusters, piece.end);
        measureIdx = cIdx; // mesure dont la borne finale est ce cluster
      }
      if (measureIdx >= measures) measureIdx = measures - 1;
      const cell = trimCell(s.slice(piece.start, piece.end));
      if (cell.length === 0) continue;
      out[measureIdx][ri] = tokenizeCell(cell);
    }
  });
  return out;
}

export function parseAsciiTab(data: string): AsciiTabParseResult {
  const lines = data.split(/\r?\n/);
  let bpm = DEFAULT_BPM;
  let title = "MIDI";

  for (const line of lines) {
    const t = line.trim();
    const mT = t.match(/Tempo\s*[=:]\s*(\d+)/i);
    if (mT) bpm = Math.min(400, Math.max(20, parseInt(mT[1], 10)));
    const mTitle = t.match(/Title\s*[=:]\s*(.+)/i);
    if (mTitle && mTitle[1].trim().length > 0) title = mTitle[1].trim();
  }

  const staffs: Token[][][][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (isTabRow(line)) {
      current.push(line);
      if (current.length === 6) {
        staffs.push(parseStaff(current));
        current = [];
      }
    }
  }

  const ppq = 480;
  const events: AsciiTabEvent[] = [];
  // Dernier dépôt par corde : permet les liaisons inter-mesures (croche tenue).
  const lastEventByString: (AsciiTabEvent | null)[] = Array(6).fill(null);
  const lastMeasureByString: number[] = Array(6).fill(-1);

  let measureIdx = 0;
  for (const staff of staffs) {
    for (const m of staff) {
      const strings = m;
      const numSlots = Math.max(0, ...strings.map((toks) => toks.length));
      const unit =
        numSlots > 0
          ? Math.min(2 * ppq, Math.max(60, Math.round((4 * ppq) / numSlots)))
          : 4 * ppq;
      const measureStart = measureIdx * 4 * ppq;

      for (let sIdx = 0; sIdx < 6; sIdx++) {
        const toks = strings[sIdx];
        let prevTok: Token | null = null;
        let prevEvent: AsciiTabEvent | null = null;
        for (let s = 0; s < toks.length; s++) {
          const tok = toks[s];
          const start = measureStart + s * unit;
          const end = start + unit;
          // Liaison interne : même manche, token précédent lié → prolonger.
          if (prevEvent && prevTok && prevTok.tie && tok.fret === prevTok.fret) {
            prevEvent.durationTicks = end - prevEvent.startTick;
            prevTok = tok;
            continue;
          }
          // Liaison inter-mesures : premier token de la mesure lié (L) et qui
          // reprend le manche de la note en chaîne de la mesure précédente.
          if (
            s === 0 &&
            tok.tie &&
            prevEvent === null &&
            lastEventByString[sIdx] &&
            lastMeasureByString[sIdx] === measureIdx - 1 &&
            tok.fret !== null &&
            lastEventByString[sIdx]!.pitch === OPEN_NOTES[sIdx] + tok.fret
          ) {
            lastEventByString[sIdx]!.durationTicks =
              end - lastEventByString[sIdx]!.startTick;
            prevTok = tok;
            continue;
          }
          if (tok.fret === null) {
            prevTok = tok;
            prevEvent = null;
            continue;
          }
          const pitch = OPEN_NOTES[sIdx] + tok.fret;
          let velocity = 82;
          if (tok.soft) velocity = 40;
          if (tok.accent) velocity = 110;
          const durationTicks = tok.staccato ? Math.max(48, Math.round(unit / 2)) : unit;
          const ev: AsciiTabEvent = { pitch, velocity, startTick: start, durationTicks };
          events.push(ev);
          lastEventByString[sIdx] = ev;
          lastMeasureByString[sIdx] = measureIdx;
          prevTok = tok;
          prevEvent = ev;
        }
      }
      measureIdx++;
    }
  }

  return { bpm, ticksPerBeat: ppq, events, bars: measureIdx, staffs: staffs.length, title };
}

// --- Écriture SMF ---

// Varint à groupes de 7 bits, du plus significatif au moins significatif
// (chaque groupe sauf le dernier est préfixé du bit de continuation).
function vlq(n: number): number[] {
  let x = Math.max(0, Math.trunc(n));
  const groups: number[] = [];
  do {
    groups.unshift(x & 0x7f);
    x = Math.trunc(x / 128);
  } while (x > 0);
  for (let i = 0; i < groups.length - 1; i++) groups[i] |= 0x80;
  return groups;
}

export function asciiTabToMidi(data: string): Uint8Array<ArrayBuffer> {
  const parsed = parseAsciiTab(data);
  const ppq = parsed.ticksPerBeat;

  const micros = Math.round(60000000 / parsed.bpm);
  const titleBytes = Array.from(new TextEncoder().encode(parsed.title));

  const order: { tick: number; on: boolean; bytes: number[] }[] = [];
  for (const ev of parsed.events) {
    order.push({ tick: ev.startTick, on: true, bytes: [0x90, ev.pitch, ev.velocity] });
    order.push({ tick: ev.startTick + Math.max(1, ev.durationTicks), on: false, bytes: [0x80, ev.pitch, 64] });
  }
  order.sort((a, b) => a.tick - b.tick || (a.on ? 1 : -1));

  const chunks: number[] = [];
  // Chaque événement (même au tick 0) doit être précédé de son delta-time (0x00).
  chunks.push(0x00, 0xff, 0x03, titleBytes.length, ...titleBytes);
  chunks.push(0x00, 0xff, 0x51, 0x03, (micros >> 16) & 0xff, (micros >> 8) & 0xff, micros & 0xff);
  chunks.push(0x00, 0xc0, DEFAULT_PROGRAM);
  let prevTick = 0;
  for (const o of order) {
    chunks.push(...vlq(Math.max(0, o.tick - prevTick)), ...o.bytes);
    prevTick = o.tick;
  }
  chunks.push(0x00, 0xff, 0x2f, 0x00);

  const mthd = [0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06, 0x00, 0x00, 0x00, 0x01, (ppq >> 8) & 0xff, ppq & 0xff];
  const track = [0x4d, 0x54, 0x72, 0x6b, (chunks.length >> 24) & 0xff, (chunks.length >> 16) & 0xff, (chunks.length >> 8) & 0xff, chunks.length & 0xff, ...chunks];
  const raw = new Uint8Array(mthd.length + track.length);
  raw.set(mthd, 0);
  raw.set(track, mthd.length);
  return raw;
}