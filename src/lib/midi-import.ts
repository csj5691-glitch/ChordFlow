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

interface MidiTempo {
  tick: number;
  microsPerBeat: number;
}

interface MidiProgramChange {
  tick: number;
  channel: number;
  program: number;
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
  tempos: MidiTempo[];
  programs: MidiProgramChange[];
} {
  let pos = 0;

  if (data[pos] !== 0x4d || data[pos + 1] !== 0x54 || data[pos + 2] !== 0x68 || data[pos + 3] !== 0x64) {
    throw new Error("not a MIDI file");
  }
  pos += 4;

  const headerLen = (data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3];
  pos += 4;
  // MThd payload: format (2 bytes), track count (2), division (2). Division =
  // ticks per quarter note; bit 15 set means SMPTE timing (unsupported → 480).
  const rawDivision = headerLen >= 6 ? ((data[pos + 4] << 8) | data[pos + 5]) : 0;
  pos += headerLen;

  let bpm = 120;
  const tracks: ParsedTrack[] = [];
  const tempos: MidiTempo[] = [];
  const programs: MidiProgramChange[] = [];
  const ticksPerBeat = rawDivision !== 0 && (rawDivision & 0x8000) === 0 ? rawDivision : 480;

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
          const channel = status & 0x0f;
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
          const channel = status & 0x0f;
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
          if (msgType === 0xc0) {
            programs.push({
              tick: currentTick,
              channel: status & 0x0f,
              program: data[pos],
            });
          }
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
            tempos.push({ tick: currentTick, microsPerBeat });
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
        channel: notes.length > 0 ? notes[0].channel : 0,
        // General MIDI puts the drum kit on channel 10 (index 9); a track whose
        // notes all come from that channel is percussion.
        isDrums: notes.length > 0 && notes.every((n) => n.channel === 9),
      });

      pos = trackEnd;
    } else {
      break;
    }
  }

  return { ticksPerBeat, bpm, tracks, tempos, programs };
}

export interface MidiPlaybackEvent {
  /** Start offset in seconds from the beginning of the file. */
  start: number;
  /** Note length in seconds. */
  duration: number;
  freq: number;
  /** GM program of the note's channel at that tick (0 for percussion). */
  program: number;
  /** Channel 10 (index 9): General MIDI drum kit. */
  percussion: boolean;
  /** Velocity mapped to 0..1 (floored so quiet passages stay audible). */
  gain: number;
  /** Index of the source MIDI track, so each track gets its own mixer strip. */
  track: number;
}

/** One mixer strip worth of MIDI content (a Songsterr tab track: guitar, bass, drums…). */
export interface MidiTrackSummary {
  index: number;
  name: string;
  channel: number;
  /** GM program shared by the track's notes (0 on the drum channel). */
  program: number;
  percussion: boolean;
  eventCount: number;
}

interface TempoSegment {
  tick: number;
  sec: number;
  microsPerBeat: number;
}

function tempoSegments(tempos: MidiTempo[], ticksPerBeat: number): TempoSegment[] {
  const sorted = [...tempos].sort((a, b) => a.tick - b.tick);
  const segs: TempoSegment[] = [{ tick: 0, sec: 0, microsPerBeat: 500_000 }];
  for (const t of sorted) {
    const last = segs[segs.length - 1];
    if (t.tick === last.tick) {
      last.microsPerBeat = t.microsPerBeat;
      continue;
    }
    const sec = last.sec + ((t.tick - last.tick) / ticksPerBeat) * (last.microsPerBeat / 1e6);
    segs.push({ tick: t.tick, sec, microsPerBeat: t.microsPerBeat });
  }
  return segs;
}

function tickToSeconds(tick: number, ticksPerBeat: number, segs: TempoSegment[]): number {
  let seg = segs[0];
  for (let i = segs.length - 1; i >= 0; i--) {
    if (segs[i].tick <= tick) {
      seg = segs[i];
      break;
    }
  }
  return seg.sec + ((tick - seg.tick) / ticksPerBeat) * (seg.microsPerBeat / 1e6);
}

// Converts a parsed MIDI file into flat, time-sorted note events ready to be
// scheduled on the WebAudio engine (one note per event, per-channel program
// resolved at the note's tick, tempo map honoured).
export function midiPlaybackEvents(data: Uint8Array): {
  events: MidiPlaybackEvent[];
  tracks: MidiTrackSummary[];
  durationSec: number;
} {
  const { ticksPerBeat, tracks, tempos, programs } = parseMidi(data);
  const segs = tempoSegments(tempos, ticksPerBeat);

  const byChannel = new Map<number, MidiProgramChange[]>();
  for (const p of programs) {
    const list = byChannel.get(p.channel);
    if (list) list.push(p);
    else byChannel.set(p.channel, [p]);
  }
  for (const list of byChannel.values()) list.sort((a, b) => a.tick - b.tick);
  const programAt = (channel: number, tick: number): number => {
    const list = byChannel.get(channel);
    if (!list) return 0;
    let prog = 0;
    for (const p of list) {
      if (p.tick <= tick) prog = p.program;
      else break;
    }
    return prog;
  };

  const events: MidiPlaybackEvent[] = [];
  const summaries: MidiTrackSummary[] = [];
  for (let t = 0; t < tracks.length; t++) {
    const track = tracks[t];
    if (track.notes.length === 0) continue;
    const percussion = track.channel === 9;
    for (const note of track.notes) {
      const start = tickToSeconds(note.startTick, ticksPerBeat, segs);
      const end = tickToSeconds(note.startTick + note.durationTicks, ticksPerBeat, segs);
      events.push({
        start,
        duration: Math.max(0.05, end - start),
        freq: 440 * Math.pow(2, (note.pitch - 69) / 12),
        program: percussion ? 0 : programAt(note.channel, note.startTick),
        percussion,
        gain: Math.max(0.3, Math.min(1, note.velocity / 127)),
        track: summaries.length,
      });
    }
    const first = track.notes[0];
    summaries.push({
      index: summaries.length,
      name: track.name,
      channel: track.channel,
      program: percussion ? 0 : programAt(first.channel, first.startTick),
      percussion,
      eventCount: track.notes.length,
    });
  }
  events.sort((a, b) => a.start - b.start);
  const durationSec = events.reduce((m, e) => Math.max(m, e.start + e.duration), 0);
  return { events, tracks: summaries, durationSec };
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
  const { bpm, tracks, ticksPerBeat } = parseMidi(data);

  const perTrackDiagrams: SavedChordShape[][] = [];
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

    const trackDiagrams: SavedChordShape[] = [];
    const notesByBeat = new Map<number, MidiNote[]>();
    for (const note of track.notes) {
      const beat = Math.floor(note.startTick / ticksPerBeat);
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

      // String indices are 0-based app-wide (shapeNotes, gp-import STRING_INDEX).
      const fingers = frets.map((f, i) => ({
        string: i,
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

      if (lastChordId && trackDiagrams.length > 0) {
        const prev = trackDiagrams[trackDiagrams.length - 1];
        if (
          prev.id === lastChordId &&
          prev.label === chordName &&
          (prev.duration ?? 1) >= 2 &&
          duration >= 2
        ) {
          prev.duration = (prev.duration ?? 1) + duration;
          continue;
        }
      }

      trackDiagrams.push(diagram);
      lastChordId = diagram.id;
    }

    perTrackDiagrams.push(trackDiagrams);
  });

  // Multi-track files (Songsterr tabs ship guitars, bass, vocals, drums…) would
  // repeat the whole song if every track's chords were concatenated: keep only
  // the richest track — the chord source — like picking one track in the
  // Guitar Pro import.
  const diagrams = perTrackDiagrams.reduce(
    (best, cur) => (cur.length > best.length ? cur : best),
    [] as SavedChordShape[]
  );

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

  return { song, diagrams, tracks: trackInfos, bpm, ticksPerBeat };
}
