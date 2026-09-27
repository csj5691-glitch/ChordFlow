import type { SavedChordShape, SongTab } from "./types";
import { getChordShape, parseChordName } from "./chord-data";

export interface MidiTrackInfo {
  index: number;
  name: string;
  noteCount: number;
  isDrums: boolean;
  channel: number;
}

export interface MidiImportResult {
  song: SongTab;
  diagrams: SavedChordShape[];
  tracks: MidiTrackInfo[];
  bpm: number;
  ticksPerBeat: number;
}

interface MidiNote {
  pitch: number;
  velocity: number;
  startTick: number;
  durationTicks: number;
  channel: number;
}

interface ParsedTrack {
  name: string;
  notes: MidiNote[];
  channel: number;
  isDrums: boolean;
}

function readVarint(data: Uint8Array, pos: number): [number, number] {
  let result = 0;
  while (true) {
    const byte = data[pos++];
    result = (result << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) break;
  }
  return [result, pos];
}

function parseMidi(data: Uint8Array): {
  ticksPerBeat: number;
  bpm: number;
  tracks: ParsedTrack[];
} {
  let pos = 0;

  if (data[pos] !== 0x4d || data[pos + 1] !== 0x54 || data[pos + 2] !== 0x68 || data[pos + 3] !== 0x64) {
    throw new Error("not a MIDI file");
  }
  pos += 4;

  const headerLen = (data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3];
  pos += 4;
  pos += headerLen;

  let bpm = 120;
  const tracks: ParsedTrack[] = [];
  const ticksPerBeat = 480;

  while (pos < data.length - 4) {
    if (data[pos] === 0x4d && data[pos + 1] === 0x54 && data[pos + 2] === 0x72 && data[pos + 3] === 0x6b) {
      pos += 4;
      const trackLen = (data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3];
      pos += 4;
      const trackEnd = pos + trackLen;

      const notes: MidiNote[] = [];
      let runningStatus = 0;
      let currentTick = 0;
      let trackName = "";
      const channel = 0;
      const noteOnMap = new Map<string, { pitch: number; velocity: number; startTick: number }>();

      while (pos < trackEnd) {
        const [delta, newPos] = readVarint(data, pos);
        pos = newPos;
        currentTick += delta;

        let status = data[pos];
        if (status < 0x80) {
          status = runningStatus;
        } else {
          pos++;
          if (status < 0xf0) runningStatus = status;
        }

        const msgType = status & 0xf0;

        if (msgType === 0x90) {
          const pitch = data[pos];
          const velocity = data[pos + 1];
          pos += 2;
          if (velocity > 0) {
            const key = `${channel}-${pitch}`;
            noteOnMap.set(key, { pitch, velocity, startTick: currentTick });
          } else {
            const key = `${channel}-${pitch}`;
            const start = noteOnMap.get(key);
            if (start) {
              notes.push({
                pitch: start.pitch,
                velocity: start.velocity,
                startTick: start.startTick,
                durationTicks: currentTick - start.startTick,
                channel,
              });
              noteOnMap.delete(key);
            }
          }
        } else if (msgType === 0x80) {
          const pitch = data[pos];
          pos += 2;
          const key = `${channel}-${pitch}`;
          const start = noteOnMap.get(key);
          if (start) {
            notes.push({
              pitch: start.pitch,
              velocity: start.velocity,
              startTick: start.startTick,
              durationTicks: currentTick - start.startTick,
              channel,
            });
            noteOnMap.delete(key);
          }
        } else if (msgType === 0xa0 || msgType === 0xb0 || msgType === 0xe0) {
          pos += 2;
        } else if (msgType === 0xc0 || msgType === 0xd0) {
          pos += 1;
        } else if (status === 0xff) {
          const metaType = data[pos];
          pos++;
          const [len, nextPos] = readVarint(data, pos);
          pos = nextPos;
          if (metaType === 0x03) {
            trackName = new TextDecoder().decode(data.subarray(pos, pos + len));
          } else if (metaType === 0x51 && len === 3) {
            const microsPerBeat = (data[pos] << 16) | (data[pos + 1] << 8) | data[pos + 2];
            bpm = Math.round(60_000_000 / microsPerBeat);
          } else if (metaType === 0x58 && len === 4) {
            // time signature
          }
          pos += len;
        } else if (status === 0xf0 || status === 0xf7) {
          const [len, nextPos] = readVarint(data, pos);
          pos = nextPos + len;
        }
      }

      tracks.push({
        name: trackName,
        notes,
        channel,
        isDrums: false,
      });

      pos = trackEnd;
    } else {
      break;
    }
  }

  return { ticksPerBeat, bpm, tracks };
}

function identifyChord(pitches: number[]): string | null {
  if (pitches.length < 2) return null;

  const pitchSet = [...new Set(pitches)].sort((a, b) => a - b);
  if (pitchSet.length < 2) return null;

  const root = pitchSet[0] % 12;
  const intervals = pitchSet.map((p) => (p - root) % 12);

  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const rootName = NOTE_NAMES[root] as "C" | "C#" | "D" | "D#" | "E" | "F" | "F#" | "G" | "G#" | "A" | "A#" | "B";

  if (intervals.includes(4) && intervals.includes(7)) {
    if (intervals.includes(10)) return `${rootName}m7`;
    if (intervals.includes(11)) return `${rootName}maj7`;
    return `${rootName}`;
  }
  if (intervals.includes(3) && intervals.includes(7)) {
    if (intervals.includes(10)) return `${rootName}m7`;
    if (intervals.includes(11)) return `${rootName}maj7`;
    return `${rootName}m`;
  }
  if (intervals.includes(4) && intervals.includes(7) && intervals.includes(10)) {
    return `${rootName}7`;
  }
  if (intervals.includes(7)) {
    return `${rootName}5`;
  }

  return null;
}

let midiIdCounter = 0;
function midiId(): string {
  midiIdCounter += 1;
  return `midi-${Date.now().toString(36)}-${midiIdCounter.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function importMidi(
  _fileName: string,
  data: Uint8Array,
  baseSong?: SongTab | null
): MidiImportResult {
  const { bpm, tracks } = parseMidi(data);

  const diagrams: SavedChordShape[] = [];
  const trackInfos: MidiTrackInfo[] = [];

  const sortedTracks = tracks
    .filter((t) => !t.isDrums && t.notes.length > 0)
    .sort((a, b) => {
      const aMin = Math.min(...a.notes.map((n) => n.pitch), 999);
      const bMin = Math.min(...b.notes.map((n) => n.pitch), 999);
      return bMin - aMin;
    });

  sortedTracks.forEach((track, trackIdx) => {
    trackInfos.push({
      index: trackIdx,
      name: track.name || `Track ${trackIdx + 1}`,
      noteCount: track.notes.length,
      isDrums: track.isDrums,
      channel: track.channel,
    });

    const notesByBeat = new Map<number, MidiNote[]>();
    for (const note of track.notes) {
      const beat = Math.floor(note.startTick / 480);
      if (!notesByBeat.has(beat)) notesByBeat.set(beat, []);
      notesByBeat.get(beat)!.push(note);
    }

    const sortedBeats = [...notesByBeat.keys()].sort((a, b) => a - b);
    let lastChordId: string | null = null;

    for (let i = 0; i < sortedBeats.length; i++) {
      const beat = sortedBeats[i];
      const beatNotes = notesByBeat.get(beat)!;
      const pitches = beatNotes.map((n) => n.pitch);
      const chordName = identifyChord(pitches);

      if (!chordName) {
        lastChordId = null;
        continue;
      }

      const nextBeat = i + 1 < sortedBeats.length ? sortedBeats[i + 1] : beat + 1;
      const durationBeats = nextBeat - beat;
      const duration = Math.max(0.25, durationBeats);

      const { note, quality } = parseChordName(chordName) ?? {};
      if (!note || !quality) {
        lastChordId = null;
        continue;
      }

      const shape = getChordShape(note, quality);
      if (!shape) {
        lastChordId = null;
        continue;
      }

      const frets = shape.frets;
      const barreOn = frets.some((f) => f > 0) && frets.every((f) => f === -1 || f >= 3);
      const muted = frets.map((f) => f === -1);
      const barreCount = barreOn
        ? frets.reduce((acc, f) => (f > 0 ? Math.max(acc, f) : acc), 0)
        : 0;

      const fingers = frets.map((f, i) => ({
        string: i + 1,
        fret: f,
        finger: shape.fingers[i] || 0,
      })).filter((f) => f.fret > 0);

      const diagram: SavedChordShape = {
        id: midiId(),
        label: chordName,
        fingers,
        barreOn,
        barreCount,
        muted,
        baseFret: shape.baseFret,
        capo: 0,
        duration,
      };

      if (lastChordId && diagrams.length > 0) {
        const prev = diagrams[diagrams.length - 1];
        if (prev.id === lastChordId) {
          prev.duration = (prev.duration ?? 1) + duration;
          continue;
        }
      }

      diagrams.push(diagram);
      lastChordId = diagram.id;
    }
  });

  const song: SongTab = {
    ...(baseSong ?? {
      id: "midi-import",
      title: "MIDI Import",
      artist: "",
      type: "custom",
      bpm,
      diagrams,
      content: "",
    }),
    bpm,
    diagrams,
  };

  return { song, diagrams, tracks: trackInfos, bpm, ticksPerBeat: 480 };
}
