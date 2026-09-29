// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import type { SynthEvent } from "./chord-synth";

// Official Roland GS / General MIDI program names (programs 0-127). These are
// exactly the GS bank-0 instrument names, shown wherever an instrument is
// displayed (import list, « Pistes » submenu, …).
const GM_PROGRAM_NAMES = [
  "Acoustic Grand Piano", "Bright Acoustic Piano", "Electric Grand Piano", "Honky-Tonk Piano",
  "Electric Piano 1", "Electric Piano 2", "Harpsichord", "Clavinet",
  "Celesta", "Glockenspiel", "Music Box", "Vibraphone",
  "Marimba", "Xylophone", "Tubular Bells", "Dulcimer",
  "Drawbar Organ", "Percussive Organ", "Rock Organ", "Church Organ",
  "Reed Organ", "Accordion", "Harmonica", "Tango Accordion",
  "Nylon String Guitar", "Steel String Guitar", "Jazz Electric Guitar", "Clean Electric Guitar",
  "Muted Electric Guitar", "Overdriven Guitar", "Distortion Guitar", "Guitar Harmonics",
  "Acoustic Bass", "Fingered Bass", "Picked Bass", "Fretless Bass",
  "Slap Bass 1", "Slap Bass 2", "Synth Bass 1", "Synth Bass 2",
  "Violin", "Viola", "Cello", "Contrabass",
  "Tremolo Strings", "Pizzicato Strings", "Orchestral Harp", "Timpani",
  "String Ensemble 1", "String Ensemble 2", "Synth Strings 1", "Synth Strings 2",
  "Choir Aahs", "Voice Oohs", "Synth Voice", "Orchestra Hit",
  "Trumpet", "Trombone", "Tuba", "Muted Trumpet",
  "French Horn", "Brass Section", "Synth Brass 1", "Synth Brass 2",
  "Soprano Sax", "Alto Sax", "Tenor Sax", "Baritone Sax",
  "Oboe", "English Horn", "Bassoon", "Clarinet",
  "Piccolo", "Flute", "Recorder", "Pan Flute",
  "Blown Bottle", "Shakuhachi", "Whistle", "Ocarina",
  "Lead 1 (square)", "Lead 2 (sawtooth)", "Lead 3 (calliope)", "Lead 4 (chiff)",
  "Lead 5 (charang)", "Lead 6 (voice)", "Lead 7 (fifths)", "Lead 8 (bass + lead)",
  "Pad 1 (new age)", "Pad 2 (warm)", "Pad 3 (polysynth)", "Pad 4 (choir)",
  "Pad 5 (bowed)", "Pad 6 (metallic)", "Pad 7 (halo)", "Pad 8 (sweep)",
  "FX 1 (rain)", "FX 2 (soundtrack)", "FX 3 (crystal)", "FX 4 (atmosphere)",
  "FX 5 (brightness)", "FX 6 (goblins)", "FX 7 (echoes)", "FX 8 (sci-fi)",
  "Sitar", "Banjo", "Shamisen", "Koto",
  "Kalimba", "Bagpipe", "Fiddle", "Shanai",
  "Tinkle Bell", "Agogo", "Steel Drums", "Woodblock",
  "Taiko Drum", "Melodic Tom", "Synth Drum", "Reverse Cymbal",
  "Guitar Fret Noise", "Breath Noise", "Seashore", "Bird Tweet",
  "Telephone Ring", "Helicopter", "Applause", "Gunshot",
];

// GS percussion: the melodic programs above are played by channel 9 (bank 128)
// in MIDI. This maps the GS standard kit (GM percussion note names).
const GS_DRUM_NAMES: Record<number, string> = {
  35: "Acoustic Bass Drum",
  36: "Bass Drum 1",
  38: "Acoustic Snare",
  39: "Hand Clap",
  40: "Electric Snare",
  41: "Low Floor Tom",
  42: "Closed High Hat",
  43: "High Floor Tom",
  44: "Pedal High-Hat",
  45: "Low Tom",
  46: "Open High-Hat",
  47: "Low-Mid Tom",
  48: "Hi-Mid Tom",
  49: "Crash Cymbal 1",
  50: "High Tom",
  51: "Ride Cymbal 1",
  52: "Chinese Cymbal",
  53: "Ride Bell",
  54: "Tambourine",
  55: "Splash Cymbal",
  56: "Cowbell",
  57: "Crash Cymbal 2",
  59: "Ride Cymbal 2",
  60: "Hi Bongo",
  61: "Low Bongo",
  62: "Mute Hi Conga",
  63: "Open Hi Conga",
  64: "Low Conga",
  65: "High Timbale",
  66: "Low Timbale",
  67: "High Agogo",
  68: "Low Agogo",
  69: "Cabasa",
  70: "Maracas",
  71: "Short Whistle",
  72: "Long Whistle",
  73: "Short Guiro",
  74: "Long Guiro",
  75: "Claves",
  76: "Hi Wood Block",
  77: "Low Wood Block",
  78: "Mute Cuica",
  79: "Open Cuica",
  80: "Mute Triangle",
  81: "Open Triangle",
};

export function gmProgramName(program: number | null | undefined): string | null {
  if (program === null || program === undefined) return null;
  if (program < 0 || program >= GM_PROGRAM_NAMES.length) return null;
  return GM_PROGRAM_NAMES[program];
}

export function gmDrumName(note: number): string | null {
  return GS_DRUM_NAMES[note] ?? null;
}

// ---------------------------------------------------------------------------
// Internal synthesizer. Each GS program is rendered with a per-family timbre
// (waveform + harmonic partials + optional detune ensemble, noise transient,
// filter shape and envelope) so instruments stay distinguishable, GS-style.
// ---------------------------------------------------------------------------

interface GmVoice {
  wave: OscillatorType;
  attack: number;
  peak: number;
  lowpassStart: number;
  lowpassEnd: number;
  filterType?: BiquadFilterType;
  harmonics: { ratio: number; gain: number }[];
  detune?: { ratio: number; gain: number };
  noise?: { amount: number; decay: number; highpass: number };
  release?: number;
}

const GUITAR_HARMONICS = [
  { ratio: 2, gain: 0.22 },
  { ratio: 3, gain: 0.08 },
];

function voiceForProgram(program: number | null | undefined): GmVoice {
  const p = program ?? 25;

  // Basses : sombres, tenues, octave claire.
  if (p >= 32 && p <= 39) {
    const slap = p === 36 || p === 37;
    return {
      wave: "sine",
      attack: 0.006,
      peak: 0.92,
      lowpassStart: slap ? 2400 : 1500,
      lowpassEnd: 400,
      harmonics: [{ ratio: 2, gain: slap ? 0.34 : 0.28 }],
      noise: slap ? { amount: 0.18, decay: 0.05, highpass: 2500 } : undefined,
    };
  }

  // Guitares acoustiques / électriques propres (GS 24-28).
  if (p === 24 || p === 25 || p === 26 || p === 27 || p === 28) {
    const neon =
      p === 27
        ? { lowpassStart: 7200, lowpassEnd: 2400 }
        : p === 24
          ? { lowpassStart: 5200, lowpassEnd: 1500 }
          : p === 26
            ? { lowpassStart: 6500, lowpassEnd: 1800 }
            : { lowpassStart: 6000, lowpassEnd: 2000 };
    return {
      wave: "sine",
      attack: 0.005,
      peak: 0.85,
      lowpassStart: neon.lowpassStart,
      lowpassEnd: neon.lowpassEnd,
      harmonics: GUITAR_HARMONICS,
      noise: { amount: 0.1, decay: 0.04, highpass: 3000 },
    };
  }

  // Guitares saturées (GS 29-30), harmoniques (31).
  if (p === 29 || p === 30) {
    return {
      wave: "sawtooth",
      attack: 0.004,
      peak: 0.55,
      lowpassStart: p === 30 ? 4200 : 5000,
      lowpassEnd: p === 30 ? 800 : 1000,
      harmonics: [
        { ratio: 2, gain: 0.3 },
        { ratio: 3, gain: 0.16 },
      ],
    };
  }
  if (p === 31) {
    return {
      wave: "sine",
      attack: 0.002,
      peak: 0.7,
      lowpassStart: 9000,
      lowpassEnd: 6000,
      harmonics: [],
    };
  }

  // Pianos à queue / électriques : corps + harmoniques frappées + bruit de
  // marteau. High-pass stays low.
  if (p >= 0 && p <= 7) {
    const fm = p === 4 || p === 5; // E-Piano FM métallique
    const hammer = p === 6 || p === 7; // clavecin / clavinet agressifs
    return {
      wave: fm ? "sine" : "triangle",
      attack: 0.002,
      peak: 0.8,
      lowpassStart: hammer ? 6500 : 8000,
      lowpassEnd: fm ? 800 : 1200,
      harmonics: fm
        ? [
            { ratio: 2, gain: 0.16 },
            { ratio: 3, gain: 0.16 },
            { ratio: 4, gain: 0.1 },
          ]
        : [
            { ratio: 2, gain: 0.2 },
            { ratio: 3, gain: 0.1 },
          ],
      noise: { amount: hammer ? 0.22 : 0.1, decay: 0.04, highpass: 4000 },
    };
  }

  // Cloches / lames / marimbas (GS 8-14) et dulcimer (15) : coups rapides,
  // riches en partiels éteints.
  if (p >= 8 && p <= 15) {
    return {
      wave: "triangle",
      attack: 0.002,
      peak: 0.75,
      lowpassStart: 9000,
      lowpassEnd: 2200,
      harmonics: [
        { ratio: 2, gain: 0.3 },
        { ratio: 3, gain: 0.16 },
        { ratio: 4.2, gain: 0.12 },
      ],
      noise: p === 15 ? { amount: 0.14, decay: 0.05, highpass: 3500 } : undefined,
    };
  }

  // Orgues (GS 16-19) : harmoniques continues (tirants), tenues.
  if (p >= 16 && p <= 23) {
    const church = p === 19;
    return {
      wave: "sawtooth",
      attack: church ? 0.05 : 0.02,
      peak: church ? 0.55 : 0.4,
      lowpassStart: church ? 5200 : 4500,
      lowpassEnd: church ? 1600 : 2800,
      harmonics: [
        { ratio: 1, gain: 0.35 },
        { ratio: 2, gain: 0.22 },
        { ratio: 3, gain: 0.14 },
        { ratio: 4, gain: 0.08 },
      ],
      release: 0.6,
    };
  }

  // Cordes et orchestre (GS 40-51) : attaque douce, ensemble légèrement
  // détuné ; pizzicato et harpe en pincé clair.
  if (p >= 40 && p <= 51) {
    const pluck = p === 45 || p === 46;
    const timpani = p === 47;
    return {
      wave: "triangle",
      attack: timpani ? 0.004 : pluck ? 0.002 : 0.05,
      peak: 0.75,
      lowpassStart: timpani ? 3000 : 5000,
      lowpassEnd: timpani ? 700 : 1500,
      harmonics: pluck
        ? [
            { ratio: 2, gain: 0.24 },
            { ratio: 3, gain: 0.1 },
          ]
        : [{ ratio: 2, gain: 0.12 }],
      detune: p !== 45 && p !== 46 ? { ratio: 1, gain: 0.06 } : undefined,
      noise: pluck || timpani ? { amount: 0.16, decay: 0.05, highpass: 2000 } : undefined,
      release: pluck ? undefined : 0.8,
    };
  }

  // Voix / chœur (GS 52-55 et 80-81).
  if ((p >= 52 && p <= 55) || p === 80 || p === 81) {
    if (p === 55) {
      // Orchestra Hit : accord percussif brillant.
      return {
        wave: "sawtooth",
        attack: 0.002,
        peak: 0.7,
        lowpassStart: 7000,
        lowpassEnd: 2600,
        harmonics: [
          { ratio: 2, gain: 0.3 },
          { ratio: 3, gain: 0.18 },
        ],
        noise: { amount: 0.2, decay: 0.05, highpass: 3500 },
      };
    }
    return {
      wave: "sawtooth",
      attack: 0.04,
      peak: 0.45,
      lowpassStart: 3500,
      lowpassEnd: 1500,
      harmonics: [
        { ratio: 2, gain: 0.18 },
        { ratio: 3, gain: 0.1 },
      ],
      detune: { ratio: 1.006, gain: 0.05 },
      release: 0.7,
    };
  }

  // Cuivres (GS 56-63) : brillants, légèrement détunés ; trompette bouchée
  // filtrée ; cor en adouci.
  if (p >= 56 && p <= 63) {
    const muted = p === 59;
    return {
      wave: "sawtooth",
      attack: p === 60 ? 0.06 : muted ? 0.012 : 0.03,
      peak: muted ? 0.5 : 0.5,
      lowpassStart: muted ? 1800 : 3200,
      lowpassEnd: muted ? 600 : 750,
      harmonics: [
        { ratio: 2, gain: 0.22 },
        { ratio: 3, gain: 0.12 },
      ],
      detune: { ratio: 1, gain: 0.05 },
      release: 0.5,
    };
  }

  // Bois / anches (GS 64-71) : saxes et clarinette riches en impaires.
  if (p >= 64 && p <= 71) {
    return {
      wave: "sawtooth",
      attack: 0.02,
      peak: 0.65,
      lowpassStart: 3600,
      lowpassEnd: 900,
      harmonics: [
        { ratio: 2, gain: 0.18 },
        { ratio: 3, gain: 0.14 },
      ],
      noise: p >= 68 ? { amount: 0.08, decay: 0.08, highpass: 1800 } : undefined,
      release: 0.5,
    };
  }

  // Flûtes / tuyaux (GS 72-79) : souffle adouci, sons clairs.
  if (p >= 72 && p <= 79) {
    return {
      wave: "sine",
      attack: p === 73 || p === 75 ? 0.06 : 0.02,
      peak: 0.7,
      lowpassStart: 4200,
      lowpassEnd: 1100,
      harmonics: [{ ratio: 2, gain: 0.08 }],
      noise: { amount: p === 73 ? 0.12 : 0.06, decay: 0.12, highpass: 1600 },
      release: 0.5,
    };
  }

  // Lead synthés (GS 80-87).
  if (p >= 80 && p <= 87) {
    const wave: OscillatorType = p === 80 ? "square" : "sawtooth";
    return {
      wave,
      attack: 0.01,
      peak: 0.5,
      lowpassStart: 4000,
      lowpassEnd: 1100,
      harmonics: [
        { ratio: 2, gain: 0.22 },
        { ratio: 3, gain: 0.1 },
      ],
      release: 0.35,
    };
  }

  // Pads (GS 88-95) : nappes évolutives.
  if (p >= 88 && p <= 95) {
    return {
      wave: "triangle",
      attack: 0.1,
      peak: 0.65,
      lowpassStart: 3400,
      lowpassEnd: 900,
      harmonics: [{ ratio: 2, gain: 0.1 }],
      detune: { ratio: 1.004, gain: 0.08 },
      release: 1.0,
    };
  }

  // FX (GS 96-103) : balayages simples.
  if (p >= 96 && p <= 103) {
    return {
      wave: "sawtooth",
      attack: p >= 100 ? 0.04 : 0.01,
      peak: 0.4,
      lowpassStart: 500,
      lowpassEnd: 6000,
      harmonics: [{ ratio: 2, gain: 0.2 }],
    };
  }

  // Ethnique / percussions mélodiques (GS 104-119) : pincés rapides.
  if (p >= 104 && p <= 119) {
    return {
      wave: "triangle",
      attack: 0.002,
      peak: 0.75,
      lowpassStart: 6000,
      lowpassEnd: 1600,
      harmonics: [
        { ratio: 2, gain: 0.26 },
        { ratio: 3, gain: 0.12 },
      ],
      noise: { amount: 0.12, decay: 0.04, highpass: 3000 },
    };
  }

  // Effets sonores (GS 120-127).
  if (p >= 120 && p <= 127) {
    return {
      wave: "sawtooth",
      attack: 0.001,
      peak: 0.35,
      lowpassStart: 8000,
      lowpassEnd: 900,
      harmonics: [],
      noise: { amount: 0.3, decay: 0.15, highpass: 1200 },
    };
  }

  // Repli générique.
  return {
    wave: "sine",
    attack: 0.005,
    peak: 0.8,
    lowpassStart: 6000,
    lowpassEnd: 2000,
    harmonics: GUITAR_HARMONICS,
  };
}

function pluckNote(
  ctx: AudioContext,
  voice: GmVoice,
  freq: number,
  when: number,
  dur: number,
  gainScale: number,
  master: GainNode
) {
  const release = voice.release ?? 0.35;
  const end = when + dur + release;
  const sustainEnd = when + Math.max(voice.attack, dur - 0.05);

  const lp = ctx.createBiquadFilter();
  lp.type = voice.filterType ?? "lowpass";
  lp.frequency.setValueAtTime(voice.lowpassStart, when);
  lp.frequency.linearRampToValueAtTime(voice.lowpassEnd, end);
  lp.Q.value = 0.4;
  lp.connect(master);

  const osc = ctx.createOscillator();
  osc.type = voice.wave;
  osc.frequency.value = freq;
  const gate = ctx.createGain();
  gate.gain.setValueAtTime(0, when);
  gate.gain.linearRampToValueAtTime(voice.peak * gainScale, when + voice.attack);
  gate.gain.setValueAtTime(voice.peak * gainScale, sustainEnd);
  gate.gain.linearRampToValueAtTime(0, end);
  osc.connect(gate);
  gate.connect(lp);
  osc.start(when);
  osc.stop(end + 0.05);

  for (const h of voice.harmonics) {
    const ho = ctx.createOscillator();
    ho.type = "sine";
    ho.frequency.value = freq * h.ratio;
    const hg = ctx.createGain();
    hg.gain.setValueAtTime(0, when);
    hg.gain.linearRampToValueAtTime(voice.peak * gainScale * h.gain, when + voice.attack);
    hg.gain.setValueAtTime(voice.peak * gainScale * h.gain, sustainEnd);
    hg.gain.linearRampToValueAtTime(0, end);
    ho.connect(hg);
    hg.connect(lp);
    ho.start(when);
    ho.stop(end + 0.05);
  }

  if (voice.detune) {
    const det = ctx.createOscillator();
    det.type = "sine";
    det.frequency.value = freq * voice.detune.ratio * 1.004;
    const dg = ctx.createGain();
    dg.gain.setValueAtTime(0, when);
    dg.gain.linearRampToValueAtTime(voice.peak * gainScale * voice.detune.gain, when + voice.attack + 0.03);
    dg.gain.setValueAtTime(voice.peak * gainScale * voice.detune.gain, sustainEnd);
    dg.gain.linearRampToValueAtTime(0, end);
    det.connect(dg);
    dg.connect(lp);
    det.start(when);
    det.stop(end + 0.05);
  }

  if (voice.noise) {
    const nLen = Math.max(1, Math.ceil(ctx.sampleRate * voice.noise.decay));
    const nBuf = ctx.createBuffer(1, nLen, ctx.sampleRate);
    const nd = nBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = (Math.random() * 2 - 1) * (1 - i / nd.length);
    const ns = ctx.createBufferSource();
    ns.buffer = nBuf;
    const np = ctx.createBiquadFilter();
    np.type = "highpass";
    np.frequency.value = voice.noise.highpass;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(voice.noise.amount * gainScale, when);
    ng.gain.exponentialRampToValueAtTime(0.0001, when + voice.noise.decay);
    ns.connect(np);
    np.connect(ng);
    ng.connect(lp);
    ns.start(when);
    ns.stop(when + voice.noise.decay + 0.02);
  }
}

export interface GmPlayOptions {
  strum: "down" | "up" | "off";
  gain?: number;
  percussion?: boolean;
}

// Plays one synthesized chord event with the timbre of the given GS instrument
// program (alphaTab `track.playbackInfo.program`), so each imported GP track
// sounds like its GS instrument (as in Songsterr's MIDI playback).
export function playGmEvent(
  ctx: AudioContext,
  ev: SynthEvent,
  master: GainNode,
  when: number,
  program?: number | null,
  opts: GmPlayOptions = { strum: "off" }
): void {
  const dur = Math.max(0.35, ev.duration);
  const gain = opts.gain ?? 1;

  // Batterie : chaque forme percussion déclenche un coup de batterie.
  if (opts.percussion) {
    playDrums(ctx, master, when, dur, ev.drumHits ?? 1, gain);
    return;
  }

  const isSilence =
    ev.silence ||
    ((ev.notes.length === 0 || ev.notes[0] === 0) &&
      !(ev.mutedNotes && ev.mutedNotes.length > 0));
  if (isSilence) return;

  const voice = voiceForProgram(program);
  const chordNotes = ev.notes.filter((f) => f > 0);
  if (chordNotes.length > 0) {
    const strumDelay = opts.strum === "off" ? 0 : 0.025;
    const sortedNotes =
      opts.strum === "up"
        ? [...chordNotes].sort((a, b) => b - a)
        : [...chordNotes].sort((a, b) => a - b);
    sortedNotes.forEach((freq, i) => {
      pluckNote(ctx, voice, freq, when + i * strumDelay, dur, gain, master);
    });
  }

  if (ev.mutedNotes && ev.mutedNotes.length > 0) {
    const mutedVoice = { ...voice, attack: 0.004, peak: 0.4 };
    for (const f of ev.mutedNotes) {
      pluckNote(ctx, mutedVoice, f, when, 0.18, gain, master);
    }
  }
}

// ---------------------------------------------------------------------------
// Drums (fallback when no SF2 bank is loaded). Simple GS-style kit synthesis:
// kick, snare and hats derived from the number of strokes on a drum shape.
// ---------------------------------------------------------------------------

function playDrumHit(
  ctx: AudioContext,
  master: GainNode,
  when: number,
  kind: "kick" | "snare" | "hat",
  gain: number
): void {
  if (kind === "kick") {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(160, when);
    o.frequency.exponentialRampToValueAtTime(50, when + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9 * gain, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.32);
    o.connect(g);
    g.connect(master);
    o.start(when);
    o.stop(when + 0.4);
    return;
  }

  const hitDur = kind === "snare" ? 0.18 : 0.09;
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * hitDur), ctx.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = kind === "snare" ? 1200 : 6000;
  const g = ctx.createGain();
  g.gain.setValueAtTime((kind === "snare" ? 0.7 : 0.5) * gain, when);
  g.gain.exponentialRampToValueAtTime(0.001, when + hitDur);
  src.connect(hp);
  hp.connect(g);
  g.connect(master);
  src.start(when);
  src.stop(when + hitDur + 0.01);

  if (kind === "snare") {
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = 190;
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.5 * gain, when);
    og.gain.exponentialRampToValueAtTime(0.001, when + 0.12);
    o.connect(og);
    og.connect(master);
    o.start(when);
    o.stop(when + 0.15);
  }
}

function playDrums(
  ctx: AudioContext,
  master: GainNode,
  when: number,
  dur: number,
  hits: number,
  gain: number
): void {
  const pattern: ("kick" | "snare" | "hat")[] = ["kick", "snare", "hat", "hat"];
  const n = Math.max(1, hits);
  const step = Math.min(dur / Math.max(1, n), 0.09);
  for (let i = 0; i < n; i++) {
    playDrumHit(ctx, master, when + i * step, pattern[i % pattern.length], gain);
  }
}

// Export for the SF2 engine: GS drum note names for labels.
export const GS_DRUM_NOTES: Record<string, number> = {
  kick: 36,
  snare: 38,
  hat: 42,
  openHat: 46,
  crash: 49,
  lowTom: 43,
  midTom: 45,
  highTom: 48,
};