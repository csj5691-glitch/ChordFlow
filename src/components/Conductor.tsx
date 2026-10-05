"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { X, Square, Play, RotateCcw } from "lucide-react";
import { renderSequence, beatsForShape, legatoStringName, measureInfoFromSignature, measureForBeat, beatInMeasure, type SynthEvent } from "@/lib/chord-synth";
import { parseChordContent } from "@/lib/chord-parser";
import { decodeHtmlEntities } from "@/lib/ug-scraper";
import type { SavedChordShape, SongTab } from "@/lib/types";
import ChordShapeView from "@/components/ChordShapeView";
import { BarGlyph } from "@/components/BarGlyph";
import { freqToMidi } from "@/lib/sf2-bank";
import { playGmEvent, gmProgramName, gmProgramFamily } from "@/lib/gm-voice";
import { midiPlaybackEvents, midiChordTimeline, type MidiPlaybackEvent, type MidiChordEvent, type MidiTrackSummary } from "@/lib/midi-import";

interface ConductorProps {
  diagrams: SavedChordShape[];
  bpm: number;
  timeSignature?: SongTab["timeSignature"];
  content: string;
  officialPlain?: string;
  officialSynced?: string;
  instrumentalUrl?: string | null;
  vocalsUrl?: string | null;
  midiUrl?: string | null;
  program?: number | null;
  percussion?: boolean;
  lyricOffset?: number;
  lyricAnchorDiagram?: number;
  /**.appelé à chaque réglage d'offset des paroles (pour le sauvegarder). */
  onLyricOffsetChange?: (offset: number) => void;
  onClose: () => void;
}

function extractLyrics(content: string): { label: string; lines: string[] }[] {
  const sections = parseChordContent(decodeHtmlEntities(content));
  return sections
    .map((s) => ({
      label: s.label ?? "",
      lines: s.lines.map((l) => l.lyrics).filter(Boolean),
    }))
    .filter((s) => s.lines.length > 0);
}

interface LyricLine {
  label: string;
  text: string;
  time: number | null;
}

function extractOfficialLyrics(synced?: string, plain?: string): LyricLine[] {
  if (synced) {
    const lines: LyricLine[] = [];
    for (const raw of synced.split("\n")) {
      const m = raw.match(/^\[(\d+):(\d+\.?\d*)\]\s*(.*)/);
      if (m && m[3].trim()) {
        const mins = parseInt(m[1], 10);
        const secs = parseFloat(m[2]);
        lines.push({ label: "", text: decodeHtmlEntities(m[3]).trim(), time: mins * 60 + secs });
      }
    }
    if (lines.length > 0) return lines;
  }
  return (plain || "")
    .split("\n")
    .map((l) => decodeHtmlEntities(l).trim())
    .filter(Boolean)
    .map((text) => ({ label: "", text, time: null }));
}

// Valeurs rythmiques : 1 temps = noire (beat GP). Les durées des diagrammes
// sont exprimées en temps (croche = 0.5, double croche = 0.25, etc.).
const NOTE_VALUES: { beats: number; label: string; title: string }[] = [
  { beats: 4, label: "ronde", title: "ronde (1)" },
  { beats: 2, label: "blanche", title: "blanche (2)" },
  { beats: 1, label: "noire", title: "noire (4)" },
  { beats: 0.5, label: "croche", title: "croche (8)" },
  { beats: 0.25, label: "dbl croche", title: "double croche (16)" },
  { beats: 0.125, label: "tpl croche", title: "triple croche (32)" },
];
const NOTE_EPS = 1e-4;

function noteValueInfo(beats: number): { label: string; title: string } {
  for (const v of NOTE_VALUES) {
    if (Math.abs(v.beats - beats) < NOTE_EPS) {
      return { label: v.label, title: v.title };
    }
    if (Math.abs(v.beats * 1.5 - beats) < NOTE_EPS) {
      return { label: `${v.label}·`, title: `${v.title} pointée` };
    }
  }
  // Hors table (tuplets…) : valeur la plus proche par puissance de 2.
  let num = 4 / beats;
  num = Math.pow(2, Math.round(Math.log2(Math.max(num, 0.0625))));
  const near = NOTE_VALUES.find((v) => Math.abs(v.beats - 4 / num) < NOTE_EPS);
  return near
    ? { label: `≈${near.label}`, title: `${near.title} (approximatif)` }
    : { label: "?", title: "valeur inconnue" };
}

// Sens du strum : la main alterne Bas/Haut sur la grille de la valeur du
// accord lui-même — un temps tombe toujours sur un D.
function strumDirection(startBeat: number, beats: number): "D" | "U" {
  const step = beats > 0 ? beats : 1;
  return Math.round(startBeat / step) % 2 === 0 ? "D" : "U";
}

// Les événements MIDI ne portent pas de diagramme : forme minimale factice
// utilisée uniquement par le moteur audio (la bande d'accords n'en contient
// jamais).
const MIDI_SHAPE_STUB: SavedChordShape = {
  id: "midi",
  label: "",
  fingers: [],
  barreOn: false,
  barreCount: 0,
  muted: [],
  baseFret: 1,
  capo: 0,
};

// Numéro du build affiché dans l'en-tête du Chef : si l'interface ne change pas
// après un déploiement, c'est qu'un bundle périmé est encore servi — ce tag le
// rend visible immédiatement. À mettre à jour à chaque déploiement.
const BUILD_TAG = "mixeur-pistes";

// Une piste MIDI = un strip de mixage : volume + EQ 3 bandes (graves 220 Hz,
// médiums 1,2 kHz, aigus 4,2 kHz). Les valeurs sont en dB pour l'EQ.
interface TrackEq {
  low: number;
  mid: number;
  high: number;
}
interface TrackMix {
  volume: number;
  eq: TrackEq;
}
interface TrackNodes {
  input: GainNode;
  low: BiquadFilterNode;
  mid: BiquadFilterNode;
  high: BiquadFilterNode;
}
const DEFAULT_MIX: TrackMix = { volume: 1, eq: { low: 0, mid: 0, high: 0 } };
const EQ_FREQS = { low: 220, mid: 1200, high: 4200 };

function midiSynthEvent(ev: MidiPlaybackEvent, i: number): SynthEvent {
  return {
    id: `midi-${i}`,
    label: "",
    notes: [ev.freq],
    start: ev.start,
    duration: Math.max(0.05, ev.duration),
    silence: false,
    shape: MIDI_SHAPE_STUB,
    drumHits: ev.percussion ? 1 : 0,
  };
}

export default function Conductor({
  diagrams,
  bpm,
  timeSignature,
  content,
  officialPlain,
  officialSynced,
  instrumentalUrl,
  vocalsUrl,
  midiUrl,
  program,
  percussion,
  lyricOffset: externalLyricOffset,
  lyricAnchorDiagram,
  onLyricOffsetChange,
  onClose,
}: ConductorProps) {
  const events = useMemo(() => renderSequence(diagrams, bpm), [diagrams, bpm]);
  const measureInfo = useMemo(
    () => measureInfoFromSignature(timeSignature),
    [timeSignature]
  );
  const lyricSections = useMemo(() => extractLyrics(content), [content]);
  const officialLines = useMemo(
    () => extractOfficialLyrics(officialSynced, officialPlain),
    [officialSynced, officialPlain]
  );
  const flatLyrics = useMemo(
    () =>
      officialLines.length > 0
        ? officialLines
        : lyricSections.flatMap((s) => s.lines.map((text) => ({ label: s.label, text, time: null as null }))),
    [officialLines, lyricSections]
  );
  const [playing, setPlaying] = useState(false);
  const [index, setIndex] = useState(0);
  const [lyricIndex, setLyricIndex] = useState(-1);
  const [anchorDisplay, setAnchorDisplay] = useState(0);
  const [chordVolume, setChordVolume] = useState(1);
  const [strumming, setStrumming] = useState<"down" | "up" | "off">("down");
  const [instVolume, setInstVolume] = useState(1);
  const [vocalsVolume, setVocalsVolume] = useState(0.9);
  const [localLyricOffset, setLocalLyricOffset] = useState(0);
  // L'offset est une valeur contrôlée : dès que l'éditeur fournit la prop, c'est
  // lui qui fait foi. Avant, un effet synchronisait l'état local avec la prop et
  // l'éditeur réutilisait la valeur renvoyée → boucle « maximum update depth ».
  const lyricOffset = externalLyricOffset ?? localLyricOffset;
  const lyricOffsetRef = useRef(0);
  useEffect(() => {
    lyricOffsetRef.current = lyricOffset;
  }, [lyricOffset]);
  const lyricAnchorRef = useRef<number | null>(null);
  useEffect(() => {
    if (lyricAnchorDiagram !== undefined) {
      lyricAnchorRef.current = lyricAnchorDiagram;
      setAnchorDisplay(lyricAnchorDiagram + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lyricAnchorDiagram]);
  const setAnchorFromDisplay = (val: number) => {
    const idx = Math.max(0, val - 1);
    setAnchorDisplay(val);
    lyricAnchorRef.current = idx;
  };
  const changeLyricOffset = (delta: number) => {
    const next = Math.round(Math.max(-30, Math.min(30, lyricOffset + delta)) * 10) / 10;
    // Le parent mémorise l'offset (par chanson) : sans ce rappel, le réglage
    // était perdu au rechargement. Appelé depuis un handler, donc autorisé.
    setLocalLyricOffset(next);
    lyricOffsetRef.current = next;
    onLyricOffsetChange?.(next);
  };
  const chordVolRef = useRef(chordVolume);
  const chordMasterRef = useRef<GainNode | null>(null);
  const [midiDurationMs, setMidiDurationMs] = useState(0);
  const midiDurRef = useRef(0);
  // Source unique de vérité du MIDI : remplie par l'effet ci-dessous, lue par
  // play(). L'étiquette « MIDI Songsterr » et la lecture partagent la même
  // variable — impossible d'afficher un fichier qu'on ne joue pas.
  const midiEventsRef = useRef<MidiPlaybackEvent[] | null>(null);
  const midiLoadRef = useRef<Promise<void> | null>(null);
  const midiUrlRef = useRef<string | null>(midiUrl);
  const playTokenRef = useRef(0);
  const probeRef = useRef<number | null>(null);
  const [midiLevel, setMidiLevel] = useState(0);
  // Pistes du MIDI importé et mixage par piste (volume + EQ), comme une table
  // de mixage : chaque piste a son propre strip.
  const [midiTracks, setMidiTracks] = useState<MidiTrackSummary[]>([]);
  // Accords du MIDI en secondes (tempo map du fichier) : la bande de
  // diagrammes les affiche quand le MIDI est la source jouée, donc les
  // diagrammes sont synchronisés avec la musique importée.
  const [midiChords, setMidiChords] = useState<MidiChordEvent[]>([]);
  // Le mixeur est replié par défaut : sur un petit écran il poussait les
  // paroles hors du champ. Un clic sur l'en-tête le déploie (défilement interne).
  const [mixerOpen, setMixerOpen] = useState(false);
  const [trackMix, setTrackMix] = useState<Record<number, TrackMix>>({});
  const trackMixRef = useRef<Record<number, TrackMix>>({});
  const trackNodesRef = useRef<Map<number, TrackNodes>>(new Map());
  const writeMix = (next: Record<number, TrackMix>) => {
    trackMixRef.current = next;
    setTrackMix(next);
  };
  const changeTrackVolume = (index: number, v: number) => {
    const cur = trackMixRef.current[index] ?? DEFAULT_MIX;
    writeMix({ ...trackMixRef.current, [index]: { ...cur, volume: v } });
    const nodes = trackNodesRef.current.get(index);
    if (nodes) {
      nodes.input.gain.setTargetAtTime(v, nodes.input.context.currentTime, 0.02);
    }
  };
  const changeTrackEq = (index: number, band: keyof TrackEq, v: number) => {
    const cur = trackMixRef.current[index] ?? DEFAULT_MIX;
    writeMix({
      ...trackMixRef.current,
      [index]: { ...cur, eq: { ...cur.eq, [band]: v } },
    });
    const nodes = trackNodesRef.current.get(index);
    if (nodes) {
      nodes[band].gain.setTargetAtTime(v, nodes[band].context.currentTime, 0.02);
    }
  };
  const resetTrackMix = () => {
    writeMix({});
    for (const [index, nodes] of trackNodesRef.current) {
      const at = nodes.input.context.currentTime;
      nodes.input.gain.setTargetAtTime(1, at, 0.02);
      nodes.low.gain.setTargetAtTime(0, at, 0.02);
      nodes.mid.gain.setTargetAtTime(0, at, 0.02);
      nodes.high.gain.setTargetAtTime(0, at, 0.02);
      if (index < 0) nodes.input.disconnect();
    }
  };
  // Source jouée par le Chef : le fichier MIDI importé de Songsterr ou la
  // séquence de diagrammes d'accords synthétisée (l'ancien comportement).
  const [sourceMode, setSourceMode] = useState<"midi" | "chords">("midi");
  // Bande affichée : quand le MIDI importé est la source jouée, on affiche SES
  // accords (positionnés sur la tempo map du fichier) au lieu de la frise
  // recalculée depuis le BPM de la partition — sinon les diagrammes ne
  // suivaient pas la musique importée.
  const useMidiBand = sourceMode === "midi" && midiChords.length > 0;
  const bandEvents = useMemo<SynthEvent[]>(() => {
    if (!useMidiBand) return events;
    return midiChords.map((c, i) => ({
      id: `midi-chord-${i}`,
      label: c.label,
      notes: [],
      start: c.start,
      duration: c.duration,
      silence: false,
      shape: c.shape,
    }));
  }, [events, useMidiBand, midiChords]);
  const changeChordVolume = (v: number) => {
    setChordVolume(v);
    chordVolRef.current = v;
    if (chordMasterRef.current) {
      chordMasterRef.current.gain.setTargetAtTime(v, chordMasterRef.current.context.currentTime, 0.02);
    }
  };
  const instVolRef = useRef(instVolume);
  const changeInstVolume = (v: number) => {
    setInstVolume(v);
    instVolRef.current = v;
    if (instRef.current) instRef.current.volume = v;
  };
  const vocalsVolRef = useRef(vocalsVolume);
  const changeVocalsVolume = (v: number) => {
    setVocalsVolume(v);
    vocalsVolRef.current = v;
    if (vocalsRef.current) vocalsRef.current.volume = v;
  };
  const ctxRef = useRef<AudioContext | null>(null);
  const instRef = useRef<HTMLAudioElement | null>(null);
  const vocalsRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [stemStart, setStemStart] = useState<number | null>(null);
  const [stemDuration, setStemDuration] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const stemStartRef = useRef<number | null>(null);
  const onStemMeta = (e: SyntheticEvent<HTMLAudioElement>, volume: number) => {
    const d = e.currentTarget.duration;
    if (Number.isFinite(d) && d > 0) setStemDuration((prev) => prev ?? d);
    e.currentTarget.volume = volume;
  };
  const usesAudio = useMemo(() => Boolean(instrumentalUrl || vocalsUrl), [instrumentalUrl, vocalsUrl]);
  const totalSequenceMs = useMemo(
    () => events.reduce((a, e) => a + e.duration, 0) * 1000,
    [events]
  );
  // Sans MIDI, identique à avant : séquence d'abord, sinon stems. Un fichier
  // MIDI importé étend la durée (bande d'accords plus courte que le morceau).
  const totalMs =
    Math.max(totalSequenceMs, midiDurationMs) > 0
      ? Math.max(totalSequenceMs, midiDurationMs)
      : (stemDuration ?? 0) * 1000;

  const stop = useCallback(() => {
    // Invalide une play() en attente (fetch/parse MIDI) pour éviter qu'elle
    // ne planifie la lecture après un arrêt.
    playTokenRef.current++;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (probeRef.current !== null) {
      window.clearInterval(probeRef.current);
      probeRef.current = null;
    }
    setMidiLevel(0);
    if (ctxRef.current && ctxRef.current.state === "running") {
      ctxRef.current.close().catch(() => {});
    }
    ctxRef.current = null;
    chordMasterRef.current = null;
    if (instRef.current) instRef.current.pause();
    if (vocalsRef.current) vocalsRef.current.pause();
    setPlaying(false);
  }, []);

  const detectFirstSound = async (url: string) => {
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    const Ctor =
      window.OfflineAudioContext ??
      (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
        .webkitOfflineAudioContext;
    if (!Ctor) return null;
    try {
      const tempo = new Ctor(1, 1, 44100);
      const decoded = await tempo.decodeAudioData(buf);
      const ch = decoded.getChannelData(0);
      const step = Math.floor(decoded.sampleRate * 0.05);
      let maxRms = 0;
      const rmsArr: number[] = [];
      for (let i = 0; i < ch.length; i += step) {
        let sum = 0;
        const n = Math.min(step, ch.length - i);
        for (let j = i; j < i + n; j++) sum += ch[j] * ch[j];
        const rms = Math.sqrt(sum / n);
        rmsArr.push(rms);
        if (rms > maxRms) maxRms = rms;
      }
      const thresh = Math.max(0.004, maxRms * 0.08);
      let detected = 0;
      for (let i = 0; i < rmsArr.length; i++) {
        if (rmsArr[i] > thresh) {
          detected = (i * step) / decoded.sampleRate;
          break;
        }
      }
      return detected;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    let cancelled = false;
    const refUrl = instrumentalUrl ?? vocalsUrl;
    void Promise.resolve().then(() => {
      if (!cancelled) setStemDuration(null);
    });
    if (refUrl) {
      void detectFirstSound(refUrl).then((d) => {
        if (cancelled) return;
        if (d === null) {
          setStemStart(null);
          stemStartRef.current = null;
        } else {
          setStemStart(d);
          stemStartRef.current = d;
        }
      });
    } else {
      stemStartRef.current = null;
      void Promise.resolve().then(() => {
        if (!cancelled) setStemStart(null);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [instrumentalUrl, vocalsUrl]);

  // MIDI Songsterr : fetch + parse une seule fois par fichier. L'octet brut
  // est mémoisé (midiLoadRef) et les événements parsés vivent dans
  // midiEventsRef — la même source que l'étiquette du header et play().
  useEffect(() => {
    let cancelled = false;
    midiUrlRef.current = midiUrl;
    midiEventsRef.current = null;
    midiLoadRef.current = null;
    midiDurRef.current = 0;
    void Promise.resolve().then(() => {
      if (!cancelled) {
        setMidiDurationMs(0);
        setMidiTracks([]);
        setMidiChords([]);
      }
    });
    if (!midiUrl) {
      return () => {
        cancelled = true;
      };
    }
    const load = (async () => {
      try {
        const res = await fetch(midiUrl);
        const buf = new Uint8Array(await res.arrayBuffer());
        const { events: evs, tracks: trks, durationSec } = midiPlaybackEvents(buf);
        const chords = midiChordTimeline(buf);
        if (cancelled) return;
        midiEventsRef.current = evs;
        midiDurRef.current = durationSec * 1000;
        setMidiDurationMs(durationSec * 1000);
        setMidiTracks(trks);
        setMidiChords(chords);
        writeMix({});
        console.info(
          `[Chef] MIDI : ${evs.length} événements, ${durationSec.toFixed(1)}s, ${trks.length} pistes`
        );
      } catch (err) {
        console.error("[Chef] échec de lecture du MIDI", err);
        // On libère la promesse pour permettre une nouvelle tentative au
        // prochain lancement (le fetch blob est instantané, risque quasi nul).
        if (!cancelled) midiLoadRef.current = null;
      }
    })();
    midiLoadRef.current = load;
    return () => {
      cancelled = true;
      midiEventsRef.current = null;
      midiLoadRef.current = null;
      midiDurRef.current = 0;
    };
  }, [midiUrl]);

  const playEvent = (
    ctx: AudioContext,
    ev: SynthEvent,
    master: GainNode,
    when: number
  ) => {
    playGmEvent(ctx, ev, master, when, program, {
      strum: strumming,
      percussion,
      // Tout passe par le bus du Chef (`master`) : le curseur « MIDI » le
      // pilote en direct, launch et lecture comprise, sans double
      // mise à l'échelle (le gain par événement reste à 1).
      gain: 1,
    });
  };

  const play = useCallback(async () => {
    stop();
    const tok = playTokenRef.current;
    // On attend le fetch/parse du MIDI (mémoisé) AVANT toute décision : si un
    // fichier est importé, midiEventsRef sera rempli au réveil — jamais de
    // repli silencieux sur les accords alors que l'étiquette affiche le MIDI.
    if (midiUrlRef.current && midiLoadRef.current) await midiLoadRef.current;
    if (playTokenRef.current !== tok) {
      console.info("[Chef] lecture annulée pendant le chargement du MIDI");
      return;
    }
    const midiEvs = midiEventsRef.current ?? [];
    const midiTotalMs = midiDurRef.current;
    if (midiUrlRef.current && midiEvs.length === 0) {
      console.warn("[Chef] MIDI importé mais aucun événement — repli synthé d'accords");
    }
    if (events.length === 0 && totalMs <= 0 && midiTotalMs <= 0) return;

    setIndex(0);
    setLyricIndex(-1);
    setElapsedMs(0);

    const pickPrimary = (): HTMLAudioElement | null => {
      if (instRef.current) return instRef.current;
      if (vocalsRef.current) return vocalsRef.current;
      return null;
    };
    const pickVocals = (): HTMLAudioElement | null => vocalsRef.current;
    const primary = pickPrimary();
    const firstVocals = pickVocals();

    // Stems et source jouée se superposent : le stem audio (enregistrement) et
    // la source choisie (MIDI importé ou accords synthétisés) jouent ensemble,
    // chacun avec son curseur de volume.
    const hasMidi = midiEvs.length > 0 && sourceMode === "midi";
    const playChords = !hasMidi && events.length > 0;
    if (primary) {
      primary.currentTime = 0;
      void primary.play().catch(() => {});
      if (firstVocals !== null && firstVocals !== primary) {
        firstVocals.currentTime = 0;
        void firstVocals.play().catch(() => {});
      }
    }

    let pump: (() => void) | null = null;
    if (playChords || hasMidi) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      try {
        await ctx.resume();
        if (ctx.state !== "running") await ctx.resume();
      } catch {
        // L'état est relu juste en dessous.
      }
      if (ctx.state !== "running") {
        console.warn(`[Chef] contexte audio "${ctx.state}" — son possiblement muet`);
      }
      ctxRef.current = ctx;
      const master = ctx.createGain();
      master.gain.value = chordVolRef.current;
      master.connect(ctx.destination);
      chordMasterRef.current = master;
      // Planification progressive : on ne crée dans le moteur audio que la
      // fenêtre des prochaines secondes, puis on répète à chaque tick. Les
      // 3 700+ événements MIDI d'un coup saturaient le graphe (des dizaines de
      // milliers de nœuds) et rien ne sortait ; en plus, chaque note planifiée
      // ainsi reçoit le volume en cours au moment où elle est créée.
      const t0 = ctx.currentTime + 0.15;
      const horizonSec = () => ctx.currentTime - t0 + 0.6;
      let chordPtr = 0;
      let midiPtr = 0;
      // Un strip par piste : volume + EQ 3 bandes, créé à la première note de
      // la piste (donc juste avant qu'on l'entende) et relié au bus du Chef.
      trackNodesRef.current = new Map();
      const busFor = (index: number): GainNode => {
        const cached = trackNodesRef.current.get(index);
        if (cached) return cached.input;
        const mix = trackMixRef.current[index] ?? DEFAULT_MIX;
        const input = ctx.createGain();
        input.gain.value = mix.volume;
        const low = ctx.createBiquadFilter();
        low.type = "lowshelf";
        low.frequency.value = EQ_FREQS.low;
        const mid = ctx.createBiquadFilter();
        mid.type = "peaking";
        mid.frequency.value = EQ_FREQS.mid;
        mid.Q.value = 0.9;
        const high = ctx.createBiquadFilter();
        high.type = "highshelf";
        high.frequency.value = EQ_FREQS.high;
        low.gain.value = mix.eq.low;
        mid.gain.value = mix.eq.mid;
        high.gain.value = mix.eq.high;
        input.connect(low);
        low.connect(mid);
        mid.connect(high);
        high.connect(master);
        trackNodesRef.current.set(index, { input, low, mid, high });
        return input;
      };
      pump = () => {
        const horizon = horizonSec();
        while (playChords && chordPtr < events.length && events[chordPtr].start <= horizon) {
          playEvent(ctx, events[chordPtr], master, t0 + events[chordPtr].start);
          chordPtr++;
        }
        while (hasMidi && midiPtr < midiEvs.length && midiEvs[midiPtr].start <= horizon) {
          const ev = midiEvs[midiPtr];
          playGmEvent(ctx, midiSynthEvent(ev, midiPtr), busFor(ev.track), t0 + ev.start, ev.program, {
            strum: "off",
            percussion: ev.percussion,
            ...(ev.percussion ? { drumPitch: freqToMidi(ev.freq) } : {}),
            gain: 1,
          });
          midiPtr++;
        }
      };
      const first = midiEvs[0];
      console.info(
        `[Chef] lecture : source=${playChords ? "Accords" : "MIDI"}(${midiEvs.length}/${events.length}) pistes=${midiTracks.length} ctx=${ctx.state} premier=${first ? first.start.toFixed(2) : "-"}s fenêtre=0.6s`
      );
      try {
        pump();
      } catch (err) {
        console.error("[Chef] échec de planification de la lecture", err);
      }
      // Sonde de niveau : mesure la sortie réelle du bus MIDI (peak 0 = aucun
      // signal bien que planifié). Elle alimente le vumètre affiché à côté du
      // curseur « MIDI » — visible sans ouvrir la console.
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      master.connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      let peakSeen = 0;
      probeRef.current = window.setInterval(() => {
        analyser.getByteTimeDomainData(samples);
        let peak = 0;
        for (let i = 0; i < samples.length; i++) {
          const d = Math.abs(samples[i] - 128);
          if (d > peak) peak = d;
        }
        if (peak > peakSeen) peakSeen = peak;
        setMidiLevel(Math.min(1, peak / 90));
      }, 100);
      window.setTimeout(() => {
        console.info(`[Chef] niveau de sortie MIDI (3 s) : peak=${peakSeen}/128`);
      }, 3000);
    }

    let startedAt = 0;
    const tick = () => {
      if (startedAt === 0) startedAt = performance.now() + 100;
      if (pump) {
        try {
          pump();
        } catch (err) {
          console.error("[Chef] planification interrompue", err);
          pump = null;
        }
      }
      const t = performance.now() - startedAt;
      const limit = Math.max(totalMs, midiDurRef.current);
      if (bandEvents.length === 0) setElapsedMs(t);
      let i = bandEvents.findIndex(
        (e) => e.start * 1000 <= t && t < (e.start + e.duration) * 1000
      );
      if (i < 0) i = bandEvents.filter((e) => e.start * 1000 <= t).length - 1;
      setIndex(Math.max(0, i));
      if (flatLyrics.length > 0) {
        const hasTimes = flatLyrics[0].time !== null;
        let li = -1;
        if (hasTimes) {
          for (let k = 0; k < flatLyrics.length; k++) {
            const tm = flatLyrics[k].time;
            if (tm !== null && tm * 1000 <= t) li = k;
          }
        } else {
          const lyricClockMs = vocalsRef.current ? vocalsRef.current.currentTime * 1000 : t;
          const vs = stemStartRef.current ?? 0;
          const anchor = lyricAnchorRef.current;
          if (anchor !== null && bandEvents.length > 1) {
            const perc = (i - anchor) / (bandEvents.length - 1 - anchor);
            li = Math.min(
              flatLyrics.length - 1,
              Math.max(0, Math.floor(perc * flatLyrics.length))
            );
          } else {
            const start = vs * 1000;
            const clock = lyricClockMs + lyricOffsetRef.current * 1000;
            if (clock >= start) {
              const span = Math.max(1, limit - start);
              li = Math.min(
                flatLyrics.length - 1,
                Math.max(0, Math.floor(((clock - start) / span) * flatLyrics.length))
              );
            }
          }
        }
        setLyricIndex(li);
      }
      if (t >= limit) {
        stop();
        return;
      }
      timerRef.current = window.setTimeout(tick, 40);
    };
    timerRef.current = window.setTimeout(tick, 40);
    setPlaying(true);
  }, [events, stop, totalMs, flatLyrics, sourceMode, midiTracks, bandEvents]);

  const playedRef = useRef(false);
  useEffect(() => {
    if (playedRef.current || events.length === 0) return;
    playedRef.current = true;
    const t = window.setTimeout(play, 50);
    return () => {
      window.clearTimeout(t);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  // Autolecture sans accords : les stems se lisent seuls dès que la durée
  // audio est connue (les accords restent gérés par l'effet ci-dessus).
  useEffect(() => {
    if (events.length > 0) return;
    if (playedRef.current || stemDuration === null) return;
    playedRef.current = true;
    const t = window.setTimeout(play, 50);
    return () => {
      window.clearTimeout(t);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, stemDuration]);

  useEffect(() => {
    const el = itemRefs.current[index];
    if (el && stripRef.current) {
      el.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
    }
  }, [index]);

  const totalBeat = useMidiBand
    ? midiChords.reduce((a, c) => a + beatsForShape(c.shape), 0)
    : diagrams.reduce((a, d) => a + (d.bar ? 0 : beatsForShape(d)), 0);
  const cur = bandEvents[index];
  const curBeats = cur ? beatsForShape(cur.shape) : 0;
  const curNv = cur ? noteValueInfo(curBeats) : null;
  const curMeasureIdx = cur ? measureForBeat((cur.start * bpm) / 60, measureInfo) : -1;
  const mStart = curMeasureIdx * measureInfo.beatsPerMeasure;
  const mEnd = mStart + measureInfo.beatsPerMeasure;
  const measureIdxs = bandEvents.reduce<number[]>((acc, ev, i) => {
    const s = (ev.start * bpm) / 60;
    const e = s + beatsForShape(ev.shape);
    if (s < mEnd - 1e-6 && e > mStart + 1e-6) acc.push(i);
    return acc;
  }, []);
  const dur2 = totalMs / 1000;
  const elapsedPct = totalMs > 0 ? Math.min(100, (elapsedMs / totalMs) * 100) : 0;
  const pct = cur ? (cur.start / dur2) * 100 : elapsedPct;

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 border-b border-zinc-800/60">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
          <h2 className="text-sm font-bold text-white uppercase tracking-widest text-zinc-300">
            Chef d&apos;orchestre
          </h2>
          <span className="text-[11px] text-zinc-500 font-mono">
            {usesAudio ? `${bpm} BPM · stems` : `${bpm} BPM`} · {totalBeat.toFixed(2)} temps ·{" "}
            {dur2.toFixed(1)} s
            {flatLyrics.length > 0 && <> · {flatLyrics.length} lignes de paroles</>}
          </span>
          {midiDurationMs > 0 && (
            <span
              className="text-[11px] font-mono text-sky-400 bg-sky-500/10 border border-sky-500/30 rounded-full px-2 py-0.5"
              title="Fichier MIDI importé depuis Songsterr — lecture multi-pistes"
            >
MIDI Songsterr · {(midiDurationMs / 1000).toFixed(1)} s
              </span>
            )}
            <span
              className="text-[10px] font-mono text-zinc-600"
              title="Numéro du build en cours — sert à vérifier que le navigateur ne sert pas une version périmée"
            >
              build {BUILD_TAG}
            </span>
          </div>
        <div className="flex items-center gap-2">
          {playing ? (
            <button
              onClick={stop}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-500 text-white hover:bg-red-400 transition-colors"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              onClick={play}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-500 text-black hover:bg-emerald-400 transition-colors"
              title="Relancer"
            >
              <Play className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={play}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
            title="Rejouer depuis le début"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              stop();
              onClose();
            }}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
            title="Fermer le chef d'orchestre"
          >
            <X className="w-3.5 h-3.5" />
            Fermer
          </button>
        </div>
      </div>

      <div className="absolute inset-0 top-14 overflow-hidden pointer-events-none">
        <div className="absolute -bottom-2 left-0 right-0 h-48">
          <div
            ref={stripRef}
            className="flex gap-2 px-4 overflow-x-auto pb-4 pt-3"
            style={{ scrollbarWidth: "none" }}
          >
            {events.map((ev, i) => {
              const active = i === index;
              const isSilence =
                ev.silence ||
                ((ev.notes.length === 0 || ev.notes[0] === 0) &&
                  !(ev.mutedNotes && ev.mutedNotes.length > 0));
              const evBeats = beatsForShape(ev.shape);
              const nv = noteValueInfo(evBeats);
              const dir = isSilence ? null : strumDirection(ev.start / (60 / bpm), evBeats);
              const drums = ev.shape.drumHits ?? 0;
              return (
                <div
                  key={ev.id + i}
                  ref={(el) => {
                    itemRefs.current[i] = el;
                  }}
                  className={`w-28 flex-shrink-0 rounded-xl border transition-all duration-150 ${
                    active
                      ? "border-amber-400 shadow-[0_0_24px_rgba(251,191,36,0.5)] scale-105 bg-zinc-900"
                      : "border-zinc-800 bg-zinc-900/50"
                  }`}
                >
                  <div className={active ? "" : "opacity-40"}>
                    <div
                      className={`text-center text-[10px] font-bold py-1 truncate px-1 ${
                        isSilence ? "text-zinc-500" : active ? "text-amber-400" : "text-zinc-400"
                      }`}
                    >
                      {ev.label}
                    </div>
                    <div className="pointer-events-none [&_svg]:h-24 [&_svg]:w-full">
                      <ChordShapeView shape={ev.shape} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-1.5 px-1.5 py-1 border-t border-zinc-800 bg-zinc-950/80 font-mono leading-none">
                    <span title={nv.title} className="text-[10px] text-zinc-400 truncate">
                      {nv.label}
                    </span>
                    {drums > 0 ? (
                      <span title={`${drums} coups`} className="text-[11px] text-amber-300 font-bold">
                        ×{drums}
                      </span>
                    ) : dir ? (
                      <span
                        title={dir === "D" ? "Strum bas (Down)" : "Strum haut (Up)"}
                        className={`text-[11px] font-bold ${
                          dir === "D" ? "text-emerald-300" : "text-sky-300"
                        }`}
                      >
                        {dir === "D" ? "↓ D" : "↑ U"}
                      </span>
                    ) : (
                      <span title="Silence" className="text-[11px] text-zinc-500">
                        —
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-start sm:justify-center overflow-y-auto px-6 pt-3 sm:pt-0 pb-24 sm:pb-14 relative z-10 gap-3 sm:gap-5">
        {flatLyrics.length > 0 && (
          <div className="text-center max-w-3xl w-full">
            {lyricIndex > 0 && flatLyrics[lyricIndex - 1] && (
              <p className="text-base sm:text-lg text-zinc-600 mb-3 leading-relaxed">
                {flatLyrics[lyricIndex - 1].text}
              </p>
            )}
            <div className="min-h-12 sm:min-h-16 flex flex-col items-center justify-center">
              {flatLyrics[lyricIndex]?.label && (
                <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-zinc-500 mb-1">
                  {flatLyrics[lyricIndex].label}
                </p>
              )}
              <p className="text-2xl sm:text-3xl lg:text-4xl font-bold text-white leading-tight drop-shadow-[0_2px_12px_rgba(251,191,36,0.35)] text-balance">
                {flatLyrics[lyricIndex]?.text}
              </p>
            </div>
            {lyricIndex < flatLyrics.length - 1 && (
              <p className="text-base sm:text-lg text-zinc-600 mt-3 leading-relaxed">
                {flatLyrics[lyricIndex + 1].text}
              </p>
            )}
          </div>
        )}

        {cur && (
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-2 flex-wrap justify-center">
              {cur.barKind && (
                <BarGlyph
                  kind={cur.barKind}
                  className="text-amber-500 w-8 h-7"
                />
              )}
              {cur.sectionLabel && (
                <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-300/80 bg-amber-400/10 border border-amber-400/30 rounded-full px-2.5 py-0.5">
                  {cur.sectionLabel}
                </span>
              )}
              <span className="text-[11px] font-mono text-zinc-400 bg-zinc-800/60 border border-zinc-700/60 rounded-full px-2.5 py-0.5">
                Mesure {measureForBeat((cur.start * bpm) / 60, measureInfo) + 1}
                {" · temps "}
                {Math.max(1, Math.round(beatInMeasure((cur.start * bpm) / 60, measureInfo)))}
                <span className="text-zinc-600">/{measureInfo.top}</span>
                <span className="text-zinc-600"> · {measureInfo.top}/{measureInfo.bottom}</span>
              </span>
              {curNv && (
                <span
                  title={curNv.title}
                  className="text-[11px] font-mono font-semibold text-zinc-100 bg-zinc-700/70 border border-zinc-600/70 rounded-full px-2.5 py-0.5"
                >
                  {curNv.label}
                </span>
              )}
              {measureIdxs.map((evIdx) => {
                const mEv = events[evIdx];
                const mBeats = beatsForShape(mEv.shape);
                const mSilence =
                  mEv.silence ||
                  ((mEv.notes.length === 0 || mEv.notes[0] === 0) &&
                    !(mEv.mutedNotes && mEv.mutedNotes.length > 0));
                const mDrums = mEv.shape.drumHits ?? 0;
                const mDir = mSilence ? null : strumDirection(mEv.start / (60 / bpm), mBeats);
                const isActive = evIdx === index;
                const base =
                  "text-[11px] font-mono font-bold border rounded-full px-2.5 py-0.5 transition-colors";
                if (mDrums > 0) {
                  return (
                    <span
                      key={evIdx}
                      title={`${mDrums} coups`}
                      className={`${base} ${
                        isActive
                          ? "text-amber-200 bg-amber-400/30 border-amber-300/60"
                          : "text-amber-300 bg-amber-400/15 border-amber-400/40"
                      }`}
                    >
                      ×{mDrums} coups
                    </span>
                  );
                }
                if (!mDir) {
                  return (
                    <span
                      key={evIdx}
                      title="Silence"
                      className={`${base} ${
                        isActive
                          ? "text-zinc-200 bg-zinc-700/70 border-zinc-500/60"
                          : "text-zinc-400 bg-zinc-800/60 border-zinc-700/60"
                      }`}
                    >
                      — Silence
                    </span>
                  );
                }
                return (
                  <span
                    key={evIdx}
                    title={mDir === "D" ? "Strum bas (Down)" : "Strum haut (Up)"}
                    className={`${base} ${
                      mDir === "D"
                        ? isActive
                          ? "text-emerald-200 bg-emerald-500/30 border-emerald-300/60"
                          : "text-emerald-300 bg-emerald-500/15 border-emerald-400/40"
                        : isActive
                          ? "text-sky-200 bg-sky-500/30 border-sky-300/60"
                          : "text-sky-300 bg-sky-500/15 border-sky-400/40"
                    }`}
                  >
                    {mDir === "D" ? "↓ D" : "↑ U"}
                  </span>
                );
              })}
            </div>
            <p
              className={`text-2xl font-black tracking-tight ${
                cur.silence ||
                (cur.notes[0] === 0 &&
                  !(cur.mutedNotes && cur.mutedNotes.length > 0))
                  ? "text-zinc-500"
                  : "text-amber-400"
              }`}
            >
              {cur.silence ? "Silence" : cur.label}
            </p>
            {cur.legato && cur.legato.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap justify-center">
                {cur.legato.map((lg) => (
                  <span
                    key={lg.string}
                    className="text-[11px] font-mono text-sky-300 bg-sky-500/10 border border-sky-500/30 rounded-full px-2.5 py-0.5"
                  >
                    {lg.kind === "H" ? "H Hammer-on" : lg.kind === "P" ? "P Pull-off" : "Liaison"}{" "}
                    · corde {legatoStringName(lg.string)}
                  </span>
                ))}
              </div>
            )}
            <div className="w-52 sm:w-80 md:w-96">
              <ChordShapeView shape={cur.shape} />
            </div>
            <p className="text-[11px] text-zinc-500 font-mono">{cur.duration.toFixed(2)} s</p>
          </div>
        )}
        <div className="w-full max-w-xl">
          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-500 transition-all duration-150"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5 text-xs text-zinc-400">
          {instrumentalUrl && (
            <div className="flex items-center gap-2">
              <span className="text-zinc-500 w-20">Instrumental</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={instVolume}
                onChange={(e) => changeInstVolume(parseFloat(e.target.value))}
                className="w-32 h-1 accent-amber-500 cursor-pointer"
                title="Volume du stem instrumental — à équilibrer avec le curseur de la source (MIDI ou Accords)"
              />
              <span className="text-[10px] text-zinc-500 font-mono w-9">
                {Math.round(instVolume * 100)}%
              </span>
            </div>
          )}
          {vocalsUrl && (
            <div className="flex items-center gap-2">
              <span className="text-zinc-500 w-20">Chant</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={vocalsVolume}
                onChange={(e) => changeVocalsVolume(parseFloat(e.target.value))}
                className="w-32 h-1 accent-amber-500 cursor-pointer"
                title="Volume du stem vocal"
              />
              <span className="text-[10px] text-zinc-500 font-mono w-9">
                {Math.round(vocalsVolume * 100)}%
              </span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-sky-400 w-20">
              {sourceMode === "chords" ? "Accords" : "MIDI"}
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={chordVolume}
              onChange={(e) => changeChordVolume(parseFloat(e.target.value))}
              className="w-32 h-1 accent-sky-500 cursor-pointer"
              title={
                sourceMode === "chords"
                  ? "Volume des accords synthétisés par-dessus le stem"
                  : "Volume de la source MIDI importée depuis Songsterr, superposée au stem — réglage immédiat pendant la lecture"
              }
            />
            <span className="text-[10px] text-sky-400 font-mono w-9">
              {Math.round(chordVolume * 100)}%
            </span>
            <span
              className="h-1.5 w-14 bg-zinc-800 rounded-full overflow-hidden"
              title="Niveau du signal de la source jouée (MIDI ou accords) : la barre bouge-t-elle ?"
            >
              <span
                className="block h-full bg-emerald-500 transition-[width] duration-100"
                style={{ width: `${Math.round(midiLevel * 100)}%` }}
              />
            </span>
          </div>
          {midiTracks.length > 0 && (
            <div className="flex flex-col gap-1.5 rounded-lg bg-zinc-900/70 border border-zinc-800 px-3 py-2">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setMixerOpen((v) => !v)}
                  className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                  title="Déplier/replier le mixeur des pistes MIDI"
                >
                  <span className="text-[9px] text-zinc-500">{mixerOpen ? "▼" : "▶"}</span>
                  Pistes MIDI ({midiTracks.length} bandes) — volume + EQ par piste
                </button>
                {mixerOpen && (
                  <button
                    type="button"
                    onClick={resetTrackMix}
                    className="text-[10px] font-bold px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 transition-colors cursor-pointer"
                    title="Remettre tous les volumes à 100 % et les EQ à 0 dB"
                  >
                    Réinitialiser
                  </button>
                )}
              </div>
              {mixerOpen && (
                <div className="flex flex-col gap-1 max-h-40 overflow-y-auto pr-1">
                {midiTracks.map((t) => {
                  const mix = trackMix[t.index] ?? DEFAULT_MIX;
                  const family = gmProgramFamily(t.program, t.percussion);
                  const label = t.name || `${family} ${t.index + 1}`;
                  return (
                    <div
                      key={t.index}
                      className="flex items-center gap-2 text-[11px]"
                      title={`${label}${gmProgramName(t.program) ? ` — ${gmProgramName(t.program)}` : ""} — ${t.eventCount} notes`}
                    >
                      <span className="w-28 truncate text-zinc-300">{label}</span>
                      <span className="w-14 text-[10px] text-zinc-500">{family}</span>
                      <input
                        type="range"
                        min={0}
                        max={1.4}
                        step={0.05}
                        value={mix.volume}
                        onChange={(e) => changeTrackVolume(t.index, parseFloat(e.target.value))}
                        className="w-20 h-1 accent-sky-500 cursor-pointer"
                        title="Volume de la piste"
                      />
                      <span className="text-[10px] text-zinc-500 font-mono w-8">
                        {Math.round(mix.volume * 100)}%
                      </span>
                      {(["low", "mid", "high"] as const).map((band) => (
                        <span key={band} className="flex items-center gap-1">
                          <span className="text-[9px] text-zinc-600 uppercase">
                            {band === "low" ? "G" : band === "mid" ? "M" : "A"}
                          </span>
                          <input
                            type="range"
                            min={-12}
                            max={12}
                            step={1}
                            value={mix.eq[band]}
                            onChange={(e) => changeTrackEq(t.index, band, parseFloat(e.target.value))}
                            className="w-12 h-1 accent-emerald-500 cursor-pointer"
                            title={`${band === "low" ? "Graves" : band === "mid" ? "Médiums" : "Aigus"} (${EQ_FREQS[band]} Hz) — ${mix.eq[band] > 0 ? "+" : ""}${mix.eq[band]} dB`}
                          />
                        </span>
                      ))}
                    </div>
                  );
                })}
                </div>
              )}
            </div>
          )}
          {midiDurationMs > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-zinc-500 w-20">Source</span>
              <div className="flex overflow-hidden rounded-md border border-zinc-700 w-fit">
                <button
                  type="button"
                  onClick={() => setSourceMode("midi")}
                  className={`px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                    sourceMode === "midi"
                      ? "bg-sky-500/25 text-sky-200"
                      : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                  }`}
                  title="Jouer le fichier MIDI importé depuis Songsterr, superposé au stem"
                >
                  MIDI
                </button>
                <button
                  type="button"
                  onClick={() => setSourceMode("chords")}
                  className={`px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                    sourceMode === "chords"
                      ? "bg-sky-500/25 text-sky-200"
                      : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                  }`}
                  title="Jouer la séquence de diagrammes d'accords synthétisée, comme auparavant"
                >
                  Accords
                </button>
              </div>
            </div>
          )}
        </div>
        {usesAudio && (
          <div className="flex flex-col gap-1 text-xs text-zinc-400">
            <span className="text-zinc-500">Paroles</span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => changeLyricOffset(-5)}
                className="w-9 h-7 rounded-md bg-zinc-800 hover:bg-zinc-700 font-bold text-zinc-300 transition-colors"
                title="-5 s"
              >
                -5
              </button>
              <button
                onClick={() => changeLyricOffset(-1)}
                className="w-9 h-7 rounded-md bg-zinc-800 hover:bg-zinc-700 font-bold text-zinc-300 transition-colors"
                title="-1 s"
              >
                -1
              </button>
              <button
                onClick={() => changeLyricOffset(-0.1)}
                className="w-9 h-7 rounded-md bg-zinc-800 hover:bg-zinc-700 font-bold text-zinc-400 transition-colors"
                title="-0,1 s (ajustement fin)"
              >
                -.1
              </button>
              <span className="font-mono text-amber-400 w-16 text-center">
                {lyricOffset >= 0 ? "+" : ""}
                {lyricOffset.toFixed(1)} s
              </span>
              <button
                onClick={() => changeLyricOffset(0.1)}
                className="w-9 h-7 rounded-md bg-zinc-800 hover:bg-zinc-700 font-bold text-zinc-400 transition-colors"
                title="+0,1 s (ajustement fin)"
              >
                +.1
              </button>
              <button
                onClick={() => changeLyricOffset(1)}
                className="w-9 h-7 rounded-md bg-zinc-800 hover:bg-zinc-700 font-bold text-zinc-300 transition-colors"
                title="+1 s"
              >
                +1
              </button>
              <button
                onClick={() => changeLyricOffset(5)}
                className="w-9 h-7 rounded-md bg-zinc-800 hover:bg-zinc-700 font-bold text-zinc-300 transition-colors"
                title="+5 s"
              >
                +5
              </button>
              {lyricOffset !== 0 && (
                <button
                  onClick={() => changeLyricOffset(-lyricOffset)}
                  className="text-zinc-500 hover:text-zinc-300 underline transition-colors"
                  title="Remettre l'offset des paroles à 0"
                >
                  Reset
                </button>
              )}
              <div className="flex items-center gap-2 ml-3 border-l border-zinc-700 pl-3">
                <span className="text-[10px] text-zinc-500">Ancrage</span>
                <button
                  onClick={() => setAnchorFromDisplay(anchorDisplay - 1)}
                  className="w-6 h-6 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold"
                >
                  −
                </button>
                <input
                  type="number"
                  min={1}
                  value={anchorDisplay}
                  onChange={(e) => {
                    const v = parseInt(e.target.value);
                    if (!isNaN(v) && v >= 1) setAnchorFromDisplay(v);
                  }}
                  className="w-14 h-6 rounded bg-zinc-800 border border-zinc-600 text-center text-zinc-200 text-xs font-mono"
                  title="Numéro du diagramme d'ancrage (1 = premier)"
                />
                <button
                  onClick={() => setAnchorFromDisplay(anchorDisplay + 1)}
                  className="w-6 h-6 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold"
                >
                  +
                </button>
              </div>
            </div>
            {stemStart === null && (instrumentalUrl || vocalsUrl) ? (
              <span className="text-[10px] text-zinc-500 animate-pulse">
                Détection du premier son de la piste…
              </span>
            ) : (
              <span className="text-[10px] text-zinc-600">
                {stemStart !== null && stemStart > 0
                  ? `1re parole à ${stemStart.toFixed(2)} s (début sonore de la piste)`
                  : "1re parole au début de la lecture"}
              </span>
            )}
          </div>
        )}
      </div>
      {instrumentalUrl && (
        <audio
          ref={instRef}
          src={instrumentalUrl}
          preload="auto"
          className="hidden"
          onLoadedMetadata={(e) => onStemMeta(e, instVolume)}
        />
      )}
      {vocalsUrl && (
        <audio
          ref={vocalsRef}
          src={vocalsUrl}
          preload="auto"
          className="hidden"
          onLoadedMetadata={(e) => onStemMeta(e, vocalsVolume)}
        />
      )}
    </div>
  );
}