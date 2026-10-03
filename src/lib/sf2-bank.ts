// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import type { SynthEvent } from "./chord-synth";
import { playGmEvent, type GmPlayOptions, GS_DRUM_NOTES } from "./gm-voice";
import type { Smplr } from "smplr";
import type {
  Instrument as Sf2Instrument,
  SoundFont2 as Sf2File,
} from "soundfont2";

// SoundFont2 bank loaded at runtime (Roland GS / GM .sf2 supplied by the user).
// The file is parsed once with "soundfont2"; every preset that is actually
// played gets its own smplr sampler bound to the instrument it references, so
// two different instruments can ring at the same time. The samplers live on a
// long-lived AudioContext owned by this module: the players create and close
// their own context on every playback, which would kill the loaded samples.
//
// smplr's built-in Soundfont2 loader drops the SF2 pitch/loop/attenuation
// generators, so a small converter turns each instrument into a smplr preset
// (regions + buffers) ourselves, honoring root key, tune, attenuation, loops,
// velocity ranges and exclusive classes. When no bank is loaded (or a preset
// is missing) the internal synthesizer is used instead.

const DRUM_BANK = 128;
const DRUM_PROGRAM = 0;
// Programs loaded in the background right after a bank is picked so the first
// guitar/bass notes are ready when the user presses play.
const WARMUP_PROGRAMS = [
  0, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39,
];

// Generator ids used by the converter (soundfont2 exports the GeneratorType
// enum at runtime, but importing the whole module for two-tone mappers would
// bloat the client bundle; these are the values we need).
const G_OVERIDING_ROOT_KEY = 58;
const G_COARSE_TUNE = 51;
const G_FINE_TUNE = 52;
const G_INITIAL_ATTENUATION = 48;
const G_VEL_RANGE = 44;
const G_SAMPLE_MODES = 54;
const G_INITIAL_FILTER_FC = 8;
const G_EXCLUSIVE_CLASS = 57;
const G_ATTACK_VOL_ENV = 34;
const G_RELEASE_VOL_ENV = 38;

type SmplrRegion = {
  sample: string;
  keyRange?: [number, number];
  velRange?: [number, number];
  pitch?: number;
  tune?: number;
  detune?: number;
  volume?: number;
  loop?: boolean;
  loopStart?: number;
  loopEnd?: number;
  lpfCutoffHz?: number;
  offBy?: number;
  ampAttack?: number;
  ampRelease?: number;
};

type Sf2PresetData = {
  preset: { samples: { baseUrl: string; formats: string[] }; groups: Array<{ regions: SmplrRegion[] }> };
  buffers: Map<string, AudioBuffer>;
};

type LoadedSamplerOptions = Sf2PresetData & { destination: AudioNode };

interface SamplerEntry {
  inst: Smplr;
  ready: boolean;
  loading: Promise<void>;
}

// Every scheduled note keeps the cancel handle returned by `start()`: smplr's
// `stop()` only silences voices that already fired, the future notes parked in
// its scheduler queue would keep sounding. Calling the handle removes the
// pending entry and stops the voice, so stop/pause really stop the sound.
interface PendingNote {
  when: number;
  cancel: () => void;
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let filter: BiquadFilterNode | null = null;
let soundfont: Sf2File | null = null;
let bankName = "";
let loadSampler: ((context: AudioContext, options: LoadedSamplerOptions) => Smplr) | null = null;
const samplers = new Map<string, SamplerEntry>();
const pendingNotes: PendingNote[] = [];

// Drops handles whose note has already started: their scheduler entry was
// fired, so keeping them around would only grow the array across long plays.
function prunePendingNotes(now: number): void {
  let i = 0;
  while (i < pendingNotes.length) {
    if (pendingNotes[i].when < now - 0.25) {
      pendingNotes.splice(i, 1);
    } else {
      i++;
    }
  }
}

export function sf2BankName(): string | null {
  return bankName || null;
}

export function sf2Ready(): boolean {
  return soundfont !== null;
}

function ensureContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx || ctx.state === "closed") {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.2;
    // Filtre passe-bas doux : atténue les aigus pour adoucir le
    // timbre des instruments GS (coupe au-dessus de ~5 kHz).
    filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 5000;
    filter.Q.value = 1;
    master.connect(filter);
    filter.connect(ctx.destination);
  }
  return ctx;
}

export function sf2Resume(): void {
  const context = ensureContext();
  if (context && context.state !== "running") {
    void context.resume().catch(() => {});
  }
}

// Fréquence de coupure du filtre passe-bas master (en Hz).
// Plus la valeur est basse, plus le son est doux/masqué (défaut 5000).
export function setMasterFilter(cutoffHz: number): void {
  if (filter) filter.frequency.value = Math.max(200, Math.min(20000, cutoffHz));
}

export function getMasterFilter(): number {
  return filter?.frequency.value ?? 5000;
}

// A player's event timestamps live on the player's own AudioContext clock, so
// they are rebased onto ours before being scheduled.
function toBankTime(playerCtx: BaseAudioContext, when: number): number {
  if (!ctx) return 0;
  return Math.max(ctx.currentTime, ctx.currentTime + (when - playerCtx.currentTime));
}

function disposeSamplers(): void {
  for (const entry of samplers.values()) {
    try {
      entry.inst.dispose();
    } catch {
      // already disposed
    }
  }
  samplers.clear();
}

// Resolves the instrument a given (bank, program) preset points to.
function instrumentFor(bank: number, program: number): Sf2Instrument | null {
  const file = soundfont;
  if (!file) return null;
  const preset = file.presets.find((p) => p.header.bank === bank && p.header.preset === program);
  return preset?.zones?.[0]?.instrument ?? null;
}

// 1 centibel = 0.05 dB. SF2 timecents are relative to 1 second.
function tcToSeconds(timecents: number): number {
  return Math.pow(2, timecents / 1200);
}

// Converts one SF2 instrument into a smplr preset (regions + sample buffers).
function instrumentToPreset(instrument: Sf2Instrument, context: BaseAudioContext): Sf2PresetData {
  const buffers = new Map<string, AudioBuffer>();
  const regions: SmplrRegion[] = [];

  for (const zone of instrument.zones) {
    const sample = zone.sample;
    if (!sample) continue;
    const header = sample.header;
    const g = zone.generators ?? {};
    const genN = (id: number): number | undefined =>
      (g as Record<number, { value?: number; range?: { lo: number; hi: number } } | undefined>)[id]
        ?.value as number | undefined;

    let buffer = buffers.get(header.name);
    if (!buffer) {
      const frames = new Float32Array(sample.data.length);
      for (let i = 0; i < sample.data.length; i++) frames[i] = sample.data[i] / 32768;
      buffer = context.createBuffer(1, frames.length, header.sampleRate);
      buffer.getChannelData(0).set(frames);
      buffers.set(header.name, buffer);
    }

    const region: SmplrRegion = {
      sample: header.name,
      keyRange: zone.keyRange ? [zone.keyRange.lo, zone.keyRange.hi] : [0, 127],
      pitch: genN(G_OVERIDING_ROOT_KEY) ?? header.originalPitch,
      tune: genN(G_COARSE_TUNE) ?? 0,
      detune: (genN(G_FINE_TUNE) ?? 0) + header.pitchCorrection,
      volume: 100 * Math.pow(10, -(genN(G_INITIAL_ATTENUATION) ?? 0) / 200),
    };

    const velRange = (g as Record<number, { value?: number; range?: { lo: number; hi: number } } | undefined>)[
      G_VEL_RANGE
    ]?.range;
    if (velRange) region.velRange = [velRange.lo, velRange.hi];

    const modes = genN(G_SAMPLE_MODES) ?? 0;
    const hasLoop = header.endLoop > header.startLoop;
    if (hasLoop && (modes & 1) === 1) {
      region.loop = true;
      region.loopStart = header.startLoop / header.sampleRate;
      region.loopEnd = header.endLoop / header.sampleRate;
    }

    const filterFc = genN(G_INITIAL_FILTER_FC);
    if (filterFc !== undefined) {
      region.lpfCutoffHz = Math.min(22050, Math.round(440 * Math.pow(2, (filterFc - 6900) / 1200)));
    }

    const exclusive = genN(G_EXCLUSIVE_CLASS);
    if (exclusive) region.offBy = exclusive;

    const attack = genN(G_ATTACK_VOL_ENV);
    if (attack !== undefined) region.ampAttack = tcToSeconds(attack);
    const release = genN(G_RELEASE_VOL_ENV);
    if (release !== undefined) region.ampRelease = tcToSeconds(release);

    regions.push(region);
  }

  return {
    preset: { samples: { baseUrl: "", formats: [] }, groups: [{ regions }] },
    buffers,
  };
}

// Creates (and starts loading) the sampler for a preset. Returns the entry
// immediately so callers can wait on it; sample decoding happens on `ready`.
function startSampler(bank: number, program: number): SamplerEntry | null {
  const context = ensureContext();
  if (!context || !loadSampler || !master) return null;
  const key = `${bank}:${program}`;
  const existing = samplers.get(key);
  if (existing) return existing;

  const instrument = instrumentFor(bank, program);
  if (!instrument) return null;

  const inst = loadSampler(context, { ...instrumentToPreset(instrument, context), destination: master });
  const entry: SamplerEntry = { inst, ready: false, loading: Promise.resolve() };
  samplers.set(key, entry);
  entry.loading = inst.ready
    .then(() => {
      entry.ready = true;
    })
    .catch(() => {
      samplers.delete(key);
    });
  return entry;
}

// Returns a ready sampler for a preset, or null while it is being loaded or
// when the bank does not contain the requested preset: the caller then falls
// back to the internal synthesizer.
function samplerFor(bank: number, program: number): Smplr | null {
  const entry = startSampler(bank, program);
  return entry && entry.ready ? entry.inst : null;
}

async function warmUp(): Promise<void> {
  const entries: SamplerEntry[] = [];
  const add = (bank: number, program: number): void => {
    const entry = startSampler(bank, program);
    if (entry) entries.push(entry);
  };
  add(DRUM_BANK, DRUM_PROGRAM);
  for (const program of WARMUP_PROGRAMS) add(0, program);
  for (const entry of entries) await entry.loading;
}

export async function loadSf2Bank(file: File, name: string): Promise<void> {
  const [{ SoundFont2 }, { Instrument }] = await Promise.all([
    import("soundfont2"),
    import("smplr"),
  ]);
  const parsed = new SoundFont2(new Uint8Array(await file.arrayBuffer()));
  disposeSamplers();
  soundfont = parsed;
  bankName = name;
  loadSampler = Instrument((context, options: LoadedSamplerOptions, smplr) =>
    smplr.loadInstrument(options.preset, options.buffers)
  );
  sf2Resume();
  void warmUp();
}

export function unloadSf2Bank(): void {
  disposeSamplers();
  soundfont = null;
  bankName = "";
  loadSampler = null;
}

export function sf2StopAll(): void {
  for (const note of pendingNotes) {
    try {
      note.cancel();
    } catch {
      // note already gone
    }
  }
  pendingNotes.length = 0;
  for (const entry of samplers.values()) {
    try {
      entry.inst.scheduler.stop();
    } catch {
      // scheduler already stopped
    }
    try {
      entry.inst.stop();
    } catch {
      // nothing playing
    }
  }
}

export function freqToMidi(freq: number): number {
  return Math.round(69 + 12 * Math.log2(freq / 440));
}

function velocityFor(gain: number): number {
  const v = Math.round(96 * gain);
  return Math.min(127, Math.max(40, v));
}

// Plays a melodic event through the SF2 bank. Returns false when the bank is
// absent or does not contain the requested program (caller falls back to the
// internal synthesizer).
export function sf2PlayEvent(
  playerCtx: AudioContext,
  ev: SynthEvent,
  when: number,
  program?: number | null,
  gain = 1
): boolean {
  if (!soundfont) return false;
  const isSilence =
    ev.silence ||
    ((ev.notes.length === 0 || ev.notes[0] === 0) &&
      !(ev.mutedNotes && ev.mutedNotes.length > 0));
  if (isSilence) return false;

  const inst = samplerFor(0, program ?? 0);
  if (!inst) return false;

  const time = toBankTime(playerCtx, when);
  const duration = Math.max(0.3, ev.duration);
  const vel = velocityFor(gain);
  prunePendingNotes(time);

  let count = 0;
  for (const f of ev.notes) {
    if (f <= 0) continue;
    const cancel = inst.start({ note: freqToMidi(f), time, duration, velocity: vel });
    pendingNotes.push({ when: time, cancel });
    count++;
  }
  for (const f of ev.mutedNotes ?? []) {
    if (f <= 0) continue;
    const cancel = inst.start({
      note: freqToMidi(f),
      time,
      duration: 0.16,
      velocity: Math.min(vel, 64),
    });
    pendingNotes.push({ when: time, cancel });
    count++;
  }
  return count > 0;
}

// Plays a drum shape through the SF2 percussion kit (bank 128). Falls back to
// false when the bank holds no percussion kit or isn't loaded. When `pitch`
// (GM drum note) is given, plays that single drum instead of the pattern.
export function sf2PlayDrumEvent(
  playerCtx: AudioContext,
  ev: SynthEvent,
  when: number,
  gain = 1,
  pitch?: number
): boolean {
  if (!soundfont) return false;
  const inst = samplerFor(DRUM_BANK, DRUM_PROGRAM);
  if (!inst) return false;

  const time = toBankTime(playerCtx, when);
  const vel = velocityFor(gain);
  prunePendingNotes(time);

  if (pitch !== undefined) {
    const cancel = inst.start({ note: pitch, time, duration: 0.2, velocity: vel });
    pendingNotes.push({ when: time, cancel });
    return true;
  }

  const n = Math.max(1, ev.drumHits ?? 1);
  const step = Math.min(Math.max(180, ev.duration * 1000) / n, 180) / 1000;

  const pattern: number[] = [
    GS_DRUM_NOTES.kick,
    GS_DRUM_NOTES.snare,
    GS_DRUM_NOTES.hat,
    GS_DRUM_NOTES.openHat,
    GS_DRUM_NOTES.hat,
    GS_DRUM_NOTES.snare,
    GS_DRUM_NOTES.kick,
    GS_DRUM_NOTES.crash,
  ];
  for (let i = 0; i < n; i++) {
    const when = time + i * step;
    const cancel = inst.start({ note: pattern[i % pattern.length], time: when, duration: 0.2, velocity: vel });
    pendingNotes.push({ when, cancel });
  }
  return true;
}

// Shared dispatch used by both players: an event goes to the SF2 bank when one
// is loaded AND it can satisfy the event (program present / percussion kit
// present); otherwise it falls back to the built-in synthesizer.
export function playEngineEvent(
  ctx: AudioContext,
  ev: SynthEvent,
  master: GainNode,
  when: number,
  program: number | null | undefined,
  opts: GmPlayOptions
): void {
  if (sf2Ready()) {
    if (opts.percussion) {
      if (sf2PlayDrumEvent(ctx, ev, when, opts.gain ?? 1, opts.drumPitch)) return;
    } else if (sf2PlayEvent(ctx, ev, when, program, opts.gain ?? 1)) {
      return;
    }
  }
  playGmEvent(ctx, ev, master, when, program, opts);
}