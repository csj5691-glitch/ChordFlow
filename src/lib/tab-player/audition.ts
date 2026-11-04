// Copyright (c) 2026 Claude St-Jean. All rights reserved.

// Son de controle du POC : une petite synthese locale qui suit l'horloge
// partagee, sans jamais la posseder.
//
// Le transport (la page) reste le seul maitre du temps. L'audition ne fait que
// programmer des notes a `audioAnchor + (t - clockAnchor)`, en avancant par
// fenetre glissante pour ne pas saturer le graphe audio sur un long morceau.
// Ce n'est pas le moteur audio final de ChordFlow : c'est un retour sonore
// suffisant pour verifier la synchronisation du curseur.

import { collectNoteEvents, type NoteEvent } from "./events";
import type { TabPlayerSong } from "./types";

/** Fenetre de programmation, en secondes. */
const LOOKAHEAD = 0.25;
/** Periode du planificateur, en millisecondes. */
const TICK_MS = 90;
/** Retard par defaut avant la premiere note (laisse au contexte le temps de demarrer). */
export const AUDITION_LEAD = 0.08;

export interface Audition {
  /**
   * Demarre a `position` (secondes du morceau). `lead` est le delai, en
   * secondes, entre l'appel et la premiere note audible : le transport doit
   * utiliser le meme decalage pour que l'image et le son partent ensemble.
   */
  start(position: number, lead?: number): void;
  stop(): void;
  dispose(): void;
}

export function createAudition(song: TabPlayerSong): Audition {
  const events = collectNoteEvents(song);

  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let buses: GainNode[] = [];
  let timer: number | null = null;
  let anchorClock = 0;
  let anchorAudio = 0;
  let cursor = 0;
  const live = new Set<OscillatorNode>();

  function ensureContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (ctx && ctx.state !== "closed") {
      if (ctx.state === "suspended") void ctx.resume().catch(() => {});
      return ctx;
    }

    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;

    const created = new Ctor();
    const output = created.createGain();
    output.gain.value = 0.55;

    const comp = created.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 20;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;

    output.connect(comp);
    comp.connect(created.destination);

    ctx = created;
    master = output;
    buses = song.tracks.map((_, trackIndex) => {
      const bus = created.createGain();
      bus.gain.value = trackIndex === 0 ? 0.9 : 0.65;
      bus.connect(output);
      return bus;
    });

    void created.resume().catch(() => {});
    return created;
  }

  function pluck(event: NoteEvent, when: number): void {
    const c = ctx;
    if (!c) return;
    const bus = buses[event.trackIndex] ?? master;
    if (!bus) return;

    const freq = 440 * 2 ** ((event.midi - 69) / 12);
    const gate = Math.min(4, Math.max(0.08, event.duration));
    const end = when + gate + 0.25;

    const filter = c.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.8;
    filter.frequency.setValueAtTime(Math.min(6000, freq * 8 + 800), when);
    filter.frequency.exponentialRampToValueAtTime(Math.max(400, freq * 2), when + 0.28);
    filter.connect(bus);

    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(event.velocity, when + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    gain.connect(filter);

    const fundamental = c.createOscillator();
    fundamental.type = "triangle";
    fundamental.frequency.value = freq;
    fundamental.connect(gain);

    const harmonic = c.createOscillator();
    harmonic.type = "sine";
    harmonic.frequency.value = freq * 2;
    const harmonicGain = c.createGain();
    harmonicGain.gain.value = 0.12;
    harmonic.connect(harmonicGain);
    harmonicGain.connect(gain);

    fundamental.start(when);
    harmonic.start(when);
    fundamental.stop(end + 0.02);
    harmonic.stop(end + 0.02);

    live.add(fundamental);
    live.add(harmonic);
    fundamental.onended = () => live.delete(fundamental);
    harmonic.onended = () => live.delete(harmonic);
  }

  function pump(): void {
    const c = ctx;
    if (!c) return;
    const clock = anchorClock + (c.currentTime - anchorAudio);
    const horizon = clock + LOOKAHEAD;

    while (cursor < events.length && events[cursor].t <= horizon) {
      const event = events[cursor];
      cursor += 1;
      const when = anchorAudio + (event.t - anchorClock);
      // Un evenement deja passe (reprise, onglet en arriere-plan) est ignore
      // plutot que joue en rafale.
      if (when < c.currentTime - 0.03) continue;
      pluck(event, Math.max(c.currentTime, when));
    }
  }

  function stop(): void {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
    if (ctx) {
      const now = ctx.currentTime;
      for (const oscillator of live) {
        try {
          oscillator.stop(now);
        } catch {
          // deja arrete
        }
        oscillator.disconnect();
      }
    }
    live.clear();
  }

  function start(position: number, lead = AUDITION_LEAD): void {
    stop();
    const c = ensureContext();
    if (!c) return;

    anchorClock = Math.max(0, position);
    anchorAudio = c.currentTime + Math.max(0, lead);

    // Premiere note a la position demandee (recherche dichotomique).
    let lo = 0;
    let hi = events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (events[mid].t < anchorClock - 1e-6) lo = mid + 1;
      else hi = mid;
    }
    cursor = lo;

    pump();
    timer = window.setInterval(pump, TICK_MS);
  }

  function dispose(): void {
    stop();
    if (ctx) {
      const closing = ctx;
      ctx = null;
      master = null;
      buses = [];
      void closing.close().catch(() => {});
    }
  }

  return { start, stop, dispose };
}
