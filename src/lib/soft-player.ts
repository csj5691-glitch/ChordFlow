// Copyright (c) 2026 Claude St-Jean. All rights reserved.

// Petit lecteur d'aperçu « doux et simple » partagé par l'éditeur de riff et
// la page Riff : une note = un sinus + une légère 2e harmonique, attaque et
// extinction douces, sans bruit ni saturation. Le bus est filtré (passe-haut
// pour retirer les graves, passe-bas pour adoucir) et la planification est
// PROGRESSIVE (fenêtre glissante) : on ne crée les nœuds qu'au moment de jouer,
// sinon une longue séquence saturerait le graphe audio.

import { renderSequence } from "./chord-synth";
import { diagramFrequencies } from "./diagrams-to-tab";
import type { SavedChordShape } from "./types";

export interface SoftPlayer {
  stop(): void;
}

function playSoftNote(
  ctx: AudioContext,
  master: GainNode,
  freq: number,
  when: number,
  dur: number
): void {
  const end = when + dur + 0.3;
  const gate = ctx.createGain();
  gate.gain.setValueAtTime(0, when);
  gate.gain.linearRampToValueAtTime(0.85, when + 0.02);
  gate.gain.linearRampToValueAtTime(0.4, when + Math.max(0.02, dur));
  gate.gain.linearRampToValueAtTime(0, end);
  gate.connect(master);

  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = freq;
  osc.connect(gate);
  osc.start(when);
  osc.stop(end + 0.02);

  const harm = ctx.createOscillator();
  harm.type = "sine";
  harm.frequency.value = freq * 2;
  const harmGain = ctx.createGain();
  harmGain.gain.value = 0.1;
  harm.connect(harmGain);
  harmGain.connect(gate);
  harm.start(when);
  harm.stop(end + 0.02);
}

// Joue une séquence de diagrammes. Renvoie un handle `stop()`, ou null si la
// séquence est vide ou que Web Audio n'est pas disponible. `onEnded` est appelé
// à la fin naturelle de la lecture (pas lors d'un `stop()` manuel). `onIndex`
// est appelé, aligné sur le temps réel, avec l'index du diagramme qui commence à
// sonner (utile pour surligner la note courante).
export function playSoftSequence(
  diagrams: SavedChordShape[],
  bpm: number,
  onEnded?: () => void,
  onIndex?: (index: number | null) => void
): SoftPlayer | null {
  const events = renderSequence(diagrams, bpm);
  if (events.length === 0) return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;

  const indexByShape = new Map<SavedChordShape, number>();
  diagrams.forEach((d, i) => {
    if (!indexByShape.has(d)) indexByShape.set(d, i);
  });

  const ctx = new Ctor();
  void ctx.resume().catch(() => {});
  let stopped = false;
  const cueTimers = new Set<number>();

  // Bus doux : gain bas + passe-haut (coupe les graves) + passe-bas (adoucit).
  const master = ctx.createGain();
  master.gain.value = 0.22;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 180;
  hp.Q.value = 0.5;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 5000;
  lp.Q.value = 0.3;
  master.connect(hp);
  hp.connect(lp);
  lp.connect(ctx.destination);

  const t0 = ctx.currentTime + 0.1;
  let ptr = 0;
  let interval: number | null = null;
  let timer: number | null = null;

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    if (timer !== null) window.clearTimeout(timer);
    if (interval !== null) window.clearInterval(interval);
    for (const id of cueTimers) window.clearTimeout(id);
    cueTimers.clear();
    void ctx.close().catch(() => {});
  };

  const pump = (): void => {
    if (stopped) return;
    const horizon = ctx.currentTime - t0 + 0.3;
    while (ptr < events.length && events[ptr].start <= horizon) {
      const ev = events[ptr++];
      if (ev.silence) continue;
      const at = Math.max(ctx.currentTime, t0 + ev.start);
      const dur = Math.max(0.2, ev.duration);
      for (const f of diagramFrequencies(ev.shape)) {
        if (f > 0) playSoftNote(ctx, master, f, at, dur);
      }
      if (onIndex) {
        const idx = indexByShape.get(ev.shape);
        if (idx !== undefined) {
          const id = window.setTimeout(() => {
            cueTimers.delete(id);
            if (!stopped) onIndex(idx);
          }, Math.max(0, (at - ctx.currentTime) * 1000));
          cueTimers.add(id);
        }
      }
    }
    if (ptr >= events.length) {
      if (interval !== null) {
        window.clearInterval(interval);
        interval = null;
      }
      const last = events[events.length - 1];
      const endAt = t0 + last.start + Math.max(0.2, last.duration) + 0.4;
      const ms = Math.max(0, (endAt - ctx.currentTime) * 1000);
      timer = window.setTimeout(() => {
        onEnded?.();
        stop();
      }, ms);
    }
  };

  interval = window.setInterval(pump, 40);
  pump();

  return { stop };
}
