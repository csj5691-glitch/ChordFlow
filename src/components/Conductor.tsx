"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { ChevronLeft, ChevronRight, Pause, Square, Play, RotateCcw, X } from "lucide-react";
import { renderSequence, beatsForShape, legatoStringName, measureInfoFromSignature, measureForBeat, beatInMeasure, type SynthEvent } from "@/lib/chord-synth";
import { soundingNotes } from "@/lib/articulation";
import { parseChordContent } from "@/lib/chord-parser";
import { decodeHtmlEntities } from "@/lib/ug-scraper";
import { loadStemShift, saveStemShift } from "@/lib/line-offsets";
import type { SavedChordShape, SongTab } from "@/lib/types";
import ChordShapeView from "@/components/ChordShapeView";
import TabStaffView from "@/components/TabStaffView";
import { BarGlyph } from "@/components/BarGlyph";
import { diagramFrequencies, diagramsToTabWithPositions } from "@/lib/diagrams-to-tab";
import { guessChordFromPitchClasses } from "@/lib/tab-view";

interface ConductorProps {
  diagrams: SavedChordShape[];
  bpm: number;
  timeSignature?: SongTab["timeSignature"];
  content: string;
  officialPlain?: string;
  officialSynced?: string;
  instrumentalUrl?: string | null;
  vocalsUrl?: string | null;
  lyricOffset?: number;
  lyricAnchorDiagram?: number;
  /**.identifiant de la chanson (persistance de l'alignement automatique). */
  songId?: string;
  /**.appelé à chaque réglage d'offset des paroles (pour le sauvegarder). */
  onLyricOffsetChange?: (offset: number) => void;
  /**.décalage de la bande de diagrammes sur la musique, en secondes. */
  bandOffset?: number;
  /**.notifié à chaque réglage du décalage de la bande. */
  onBandOffsetChange?: (offset: number) => void;
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

// Numéro du build affiché dans l'en-tête du Chef : si l'interface ne change pas
// après un déploiement, c'est qu'un bundle périmé est encore servi — ce tag le
// rend visible immédiatement. À mettre à jour à chaque déploiement.
const BUILD_TAG = "sans-midi";

export default function Conductor({
  diagrams,
  bpm,
  timeSignature,
  content,
  officialPlain,
  officialSynced,
  instrumentalUrl,
  vocalsUrl,
  lyricOffset: externalLyricOffset,
  lyricAnchorDiagram,
  onLyricOffsetChange,
  bandOffset: externalBandOffset,
  onBandOffsetChange,
  songId,
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
  // Décalage de la bande de diagrammes sur la musique (contrôlé par l'éditeur,
  // comme l'offset des paroles) : c'est le réglage qui rend la synchro malléable.
  const [localBandOffset, setLocalBandOffset] = useState(0);
  const bandOffset = externalBandOffset ?? localBandOffset;
  const bandOffsetRef = useRef(0);
  useEffect(() => {
    bandOffsetRef.current = bandOffset;
  }, [bandOffset]);
  const changeBandOffset = (delta: number) => {
    const next = Math.round(Math.max(-10, Math.min(10, bandOffset + delta)) * 10) / 10;
    setLocalBandOffset(next);
    bandOffsetRef.current = next;
    onBandOffsetChange?.(next);
  };
  // Alignement automatique (sans curseurs) : le pré-roll détecté dans les
  // stems (silence de tête avant la musique) est compensé au démarrage, pour
  // que les accords, les paroles et les stems partent ensemble. La valeur
  // calculée est déduite au rendu (voir plus bas) et servie à la lecture via
  // le ref — pas le curseur, et aucune action de l'utilisateur requise.
  const stemShiftRef = useRef(songId ? loadStemShift(songId) : 0);
  const [savedStemShift] = useState(() => (songId ? loadStemShift(songId) : 0));
  const playTokenRef = useRef(0);
  // Pause/reprise : on mémorise la position dans le morceau, puis on rejoue
  // depuis cet instant (les événements déjà passés sont sautés).
  const [paused, setPaused] = useState(false);
  const seekRef = useRef(0);
  const t0Ref = useRef<number | null>(null);
  // Bande affichée : la séquence de diagrammes d'accords de la partition.
  const bandEvents = events;
  const instVolRef = useRef(instVolume);
  const changeInstVolume = (v: number) => {
    setInstVolume(v);
    instVolRef.current = v;
    if (instRef.current) instRef.current.volume = v;
    if (stemGainRefs.current.inst) stemGainRefs.current.inst.gain.value = v;
  };
  const vocalsVolRef = useRef(vocalsVolume);
  const changeVocalsVolume = (v: number) => {
    setVocalsVolume(v);
    vocalsVolRef.current = v;
    if (vocalsRef.current) vocalsRef.current.volume = v;
    if (stemGainRefs.current.vocals) stemGainRefs.current.vocals.gain.value = v;
  };
  const ctxRef = useRef<AudioContext | null>(null);
  const instRef = useRef<HTMLAudioElement | null>(null);
  const vocalsRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const centerTabRef = useRef<HTMLDivElement | null>(null);
  const [stemStart, setStemStart] = useState<number | null>(null);
  const [stemDuration, setStemDuration] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const stemStartRef = useRef<number | null>(null);
  // Stems joués SUR l'horloge du contexte (échantillon-verrouillés avec les
  // accords) : plus de dérive possible entre la piste <audio> et les accords,
  // et plus de latence de démarrage du lecteur média.
  const stemSourcesRef = useRef<{ inst?: AudioBufferSourceNode; vocals?: AudioBufferSourceNode }>({});
  const stemGainRefs = useRef<{ inst?: GainNode; vocals?: GainNode }>({});
  const stemCacheRef = useRef<Map<string, AudioBuffer>>(new Map());
  const stemLoadRef = useRef<Record<string, Promise<AudioBuffer | null>>>({});
  const decodeStemBuffer = useCallback(
    async (ctx: AudioContext, url: string): Promise<AudioBuffer | null> => {
      const cached = stemCacheRef.current.get(url);
      if (cached) return cached;
      const existing = stemLoadRef.current[url];
      if (existing) return existing;
      const p = (async () => {
        try {
          const res = await fetch(url);
          const arr = await res.arrayBuffer();
          const buf = await ctx.decodeAudioData(arr);
          stemCacheRef.current.set(url, buf);
          return buf;
        } catch (err) {
          console.error("[Chef] décodage du stem échoué", err);
          return null;
        }
      })();
      stemLoadRef.current[url] = p;
      return p;
    },
    []
  );
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
  // Séquence d'accords d'abord, sinon la durée des stems.
  const totalMs =
    totalSequenceMs > 0 ? totalSequenceMs : (stemDuration ?? 0) * 1000;

  const stop = useCallback(() => {
    // Invalide une play() en attente pour éviter qu'elle ne planifie la lecture
    // après un arrêt.
    playTokenRef.current++;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    t0Ref.current = null;
    setPaused(false);
    seekRef.current = 0;
    if (ctxRef.current && ctxRef.current.state === "running") {
      ctxRef.current.close().catch(() => {});
    }
    ctxRef.current = null;
    const srcs = stemSourcesRef.current;
    if (srcs.inst) {
      try {
        srcs.inst.stop();
      } catch {
        /* déjà arrêté */
      }
    }
    if (srcs.vocals) {
      try {
        srcs.vocals.stop();
      } catch {
        /* déjà arrêté */
      }
    }
    stemSourcesRef.current = {};
    stemGainRefs.current = {};
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

  // Calcul automatique de l'alignement : onset stems (pré-roll détecté
  // ci-dessus). On ne fait aucun setState depuis l'effet : la valeur affichée
  // est déduite au rendu, le ref n'est mis à jour que pour la lecture.
  const stemShift = useMemo(() => {
    const preRoll = stemStart;
    if (preRoll === null || preRoll === undefined) return savedStemShift;
    return Math.round(Math.max(0, Math.min(10, preRoll)) * 10) / 10;
  }, [savedStemShift, stemStart]);

  useEffect(() => {
    const preRoll = stemStartRef.current;
    if (preRoll === null) return;
    stemShiftRef.current = Math.round(Math.max(0, Math.min(10, preRoll)) * 10) / 10;
    if (songId && stemShiftRef.current > 0) saveStemShift(songId, stemShiftRef.current);
  }, [songId, instrumentalUrl, vocalsUrl, stemStart]);

  /**`.fromSec` permet la reprise après pause et le saut vers un diagramme. */
  const play = useCallback(async (fromSec = 0) => {
    stop();
    if (events.length === 0 && totalMs <= 0) return;

    const seek = Math.max(0, fromSec);
    seekRef.current = seek;
    setPaused(false);
    setLyricIndex(-1);
    setElapsedMs(seek * 1000);

    const pickPrimary = (): HTMLAudioElement | null => {
      if (instRef.current) return instRef.current;
      if (vocalsRef.current) return vocalsRef.current;
      return null;
    };
    const pickVocals = (): HTMLAudioElement | null => vocalsRef.current;
    const primary = pickPrimary();
    const firstVocals = pickVocals();

    // Les stems audio (enregistrements importés) sont joués SUR le même
    // contexte audio (échantillon-verrouillés) ; la piste <audio> ne sert plus
    // que de repli si le décodage échoue. Le Studio ne joue aucun son
    // synthétisé (aucun son MIDI).
    const needCtx = usesAudio;
    let ctx: AudioContext | null = null;
    let t0 = 0;
    if (needCtx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
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
      // Alias non-null : les fermetures (pompe, bus) gardent un typage sûr.
      const ctxSafe = ctx;
      // t0 est calé pour que la position `seek` du morceau sonne maintenant :
      // la reprise après pause et les sauts vers un diagramme restent exacts.
      t0 = ctx.currentTime + 0.15 - seek;
      t0Ref.current = t0;
      // Stems sur la même horloge que les accords : décode + planifie les buffers
      // sur la timeline du contexte (t0 + position). zero dérive, zéro latence
      // de démarrage de lecteur média et zéro curseur à régler.
      if (usesAudio) {
        let stemsOnCtx = false;
        const shift = stemShiftRef.current;
        const scheduleStem = async (kind: "inst" | "vocals", url: string | null | undefined) => {
          if (!url) return;
          const buf = await decodeStemBuffer(ctxSafe, url);
          if (!buf || buf.duration <= 0) return;
          const gainNode = ctxSafe.createGain();
          gainNode.gain.value = kind === "inst" ? instVolRef.current : vocalsVolRef.current;
          gainNode.connect(ctxSafe.destination);
          const src = ctxSafe.createBufferSource();
          src.buffer = buf;
          src.connect(gainNode);
          const off = Math.min(Math.max(0, seek + shift), Math.max(0, buf.duration - 0.05));
          src.start(t0 + seek, off);
          stemSourcesRef.current[kind] = src;
          stemGainRefs.current[kind] = gainNode;
          stemsOnCtx = true;
          if (Number.isFinite(buf.duration) && buf.duration > 0) {
            setStemDuration((prev) => prev ?? buf.duration);
          }
        };
        const instDone = scheduleStem("inst", instrumentalUrl);
        const vocDone = scheduleStem("vocals", vocalsUrl);
        await Promise.all([instDone, vocDone]);
        // Repli <audio> (décodage impossible) : même saut de pré-roll.
        if (!stemsOnCtx && primary) {
          primary.currentTime = Math.max(0, seek + shift);
          void primary.play().catch(() => {});
          if (firstVocals !== null && firstVocals !== primary) {
            firstVocals.currentTime = Math.max(0, seek + shift);
            void firstVocals.play().catch(() => {});
          }
        }
      }
    }

    let startedAt = 0;
    const tick = () => {
      // L'horloge d'interface démarre à la position de lecture (t = seek au
      // démarrage), pour que pause/reprise et sauts restent exacts.
      if (startedAt === 0) startedAt = performance.now() + 100 - seek * 1000;
      const t = performance.now() - startedAt;
      // Le décalage de synchro peut repousser la fin : on ne doit pas arrêter
      // avant lui.
      const limit = Math.max(totalMs, Math.max(0, bandOffsetRef.current) * 1000);
      if (bandEvents.length === 0) setElapsedMs(t);
      // Le décalage de bande rend la synchro malléable : un décalage positif
      // retarde l'affichage des diagrammes par rapport à la musique.
      const tb = t + bandOffsetRef.current * 1000;
      let i = bandEvents.findIndex(
        (e) => e.start * 1000 <= tb && tb < (e.start + e.duration) * 1000
      );
      if (i < 0) i = bandEvents.filter((e) => e.start * 1000 <= tb).length - 1;
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
          const anchor = lyricAnchorRef.current;
          if (anchor !== null && bandEvents.length > 1) {
            const perc = (i - anchor) / (bandEvents.length - 1 - anchor);
            li = Math.min(
              flatLyrics.length - 1,
              Math.max(0, Math.floor(perc * flatLyrics.length))
            );
          } else {
            // Paroles non synchronisées : portées par la timeline du Chef (t) —
            // les stems partent déjà au bon endroit (~stemShift), donc le début
            // de la musique devient le repère 0. Plus de dépendance à l'horloge
            // interne de la piste <audio> (dérive/sauts).
            const start = Math.max(
              0,
              (stemStartRef.current ?? 0) * 1000 - stemShiftRef.current * 1000
            );
            const clock = t + lyricOffsetRef.current * 1000;
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
  }, [
    events,
    stop,
    totalMs,
    flatLyrics,
    bandEvents,
    usesAudio,
    instrumentalUrl,
    vocalsUrl,
    decodeStemBuffer,
  ]);

  const playedRef = useRef(false);
  // Position courante dans le morceau (s), que la lecture soit active ou en pause.
  const currentPosSec = useCallback((): number => {
    const t0 = t0Ref.current;
    const ctx = ctxRef.current;
    if (t0 !== null && ctx) return Math.max(0, ctx.currentTime - t0);
    return seekRef.current;
  }, []);

  const togglePlay = useCallback(() => {
    if (playing) {
      // Pause : on mémorise la position avant de tout couper.
      const pos = currentPosSec();
      stop();
      seekRef.current = pos;
      setPaused(true);
      return;
    }
    void play(paused ? seekRef.current : 0);
  }, [playing, paused, play, stop, currentPosSec]);

  // Diagramme précédent / suivant : saute la lecture au début de ce diagramme.
  const jumpDiagram = useCallback(
    (dir: -1 | 1) => {
      const list = bandEvents;
      if (list.length === 0) return;
      const shift = bandOffsetRef.current;
      const tSec = currentPosSec() + shift;
      let target: number;
      if (dir === 1) {
        const found = list.findIndex((e) => e.start > tSec + 0.05);
        target = found < 0 ? list.length - 1 : found;
      } else {
        target = 0;
        for (let k = 0; k < list.length; k++) {
          if (list[k].start < tSec - 0.35) target = k;
        }
      }
      const start = Math.max(0, list[target].start - shift);
      setIndex(target);
      if (playing || paused) {
        void play(start);
      } else {
        seekRef.current = start;
        setElapsedMs(start * 1000);
      }
    },
    [bandEvents, currentPosSec, play, playing, paused]
  );
  useEffect(() => {
    if (playedRef.current || events.length === 0) return;
    playedRef.current = true;
    const t = window.setTimeout(() => void play(0), 50);
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
    const t = window.setTimeout(() => void play(0), 50);
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

  // Suit la note jouée dans la tablature de riff centrale : défile pour garder la
  // colonne en cours visible, sans que l'utilisateur ait à scroller.
  useEffect(() => {
    const box = centerTabRef.current;
    if (!box) return;
    const hit = box.querySelector<HTMLElement>('[data-highlight="1"]');
    if (!hit) return;
    hit.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  }, [index]);

  const totalBeat = diagrams.reduce((a, d) => a + (d.bar ? 0 : beatsForShape(d)), 0);
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
  // Riff vs accord pour la mesure courante : « riff » quand tout se joue sur 1 à
  // 2 cordes à la fois, « accord » dès qu'une attaque fait sonner 3 notes ou plus.
  // On compte depuis la FORME (soundingNotes) : c'est la référence fiable du
  // nombre de notes simultanées.
  const measureKind = (() => {
    let maxSim = 0;
    for (const evIdx of measureIdxs) {
      const mEv = bandEvents[evIdx];
      if (!mEv || !mEv.shape || mEv.shape.silence) continue;
      if ((mEv.shape.drumHits ?? 0) > 0) continue;
      maxSim = Math.max(maxSim, soundingNotes(mEv.shape));
    }
    return maxSim === 0 ? null : maxSim >= 3 ? "accord" : "riff";
  })();
  // Passages de riff : suites d'événements à 1 ou 2 cordes (jamais 3 notes
  // simultanées ni percussion), avec au moins 2 attaques. Le Studio les affiche
  // en tablature au lieu de diagrammes à une seule note.
  const riffRuns = useMemo(() => {
    const runs: { start: number; end: number }[] = [];
    const cut = (ev: SynthEvent): boolean =>
      !!ev.shape?.drumHits || (!ev.silence && soundingNotes(ev.shape) >= 3);
    const isAttack = (ev: SynthEvent): boolean =>
      !ev.silence && !ev.shape?.drumHits && soundingNotes(ev.shape) >= 1;
    let start = -1;
    let attacks = 0;
    for (let i = 0; i <= bandEvents.length; i++) {
      const ev = i < bandEvents.length ? bandEvents[i] : null;
      if (!ev || cut(ev)) {
        if (start !== -1 && attacks >= 2) runs.push({ start, end: i - 1 });
        start = -1;
        attacks = 0;
        continue;
      }
      if (start === -1) start = i;
      if (isAttack(ev)) attacks += 1;
    }
    return runs;
  }, [bandEvents]);
  // Indice du passage de riff auquel appartient chaque événement (-1 sinon).
  const runOfIndex = useMemo(() => {
    const arr = new Array<number>(bandEvents.length).fill(-1);
    riffRuns.forEach((r, ri) => {
      for (let i = r.start; i <= r.end; i++) arr[i] = ri;
    });
    return arr;
  }, [riffRuns, bandEvents.length]);
  // Tablature de chaque passage de riff : calcul partagé par la bande du bas et
  // la vue centrale.
  const riffTabs = useMemo(
    () =>
      riffRuns.map((r) => {
        const shapes = bandEvents.slice(r.start, r.end + 1).map((e) => e.shape);
        const first = bandEvents[r.start];
        const originTick = Math.round(((first.start * bpm) / 60) * 480);
        return diagramsToTabWithPositions(shapes, { bpm, originTick });
      }),
    [riffRuns, bandEvents, bpm]
  );
  // Interprétation harmonique de chaque passage de riff : pour chaque mesure de
  // la tablature, on rassemble les classes de hauteur de toutes les notes de la
  // mesure puis on affiche l'accord (majeur/mineur/7/5/sus) le plus probable.
  const riffChords = useMemo(
    () =>
      riffRuns.map((r, ri) => {
        const shapes = bandEvents.slice(r.start, r.end + 1).map((e) => e.shape);
        const cells = riffTabs[ri]?.cells ?? [];
        const perMeasure = new Map<number, { pcs: Set<number>; lowest: number | null }>();
        for (let i = 0; i < shapes.length; i++) {
          const m = cells[i]?.[0]?.m;
          if (m === undefined) continue;
          let agg = perMeasure.get(m);
          if (!agg) {
            agg = { pcs: new Set(), lowest: null };
            perMeasure.set(m, agg);
          }
          for (const f of diagramFrequencies(shapes[i])) {
            if (!Number.isFinite(f) || f <= 0) continue;
            const midi = Math.round(69 + 12 * Math.log2(f / 440));
            agg.pcs.add(((midi % 12) + 12) % 12);
            if (agg.lowest === null || midi < agg.lowest) agg.lowest = midi;
          }
        }
        const out = new Map<number, string>();
        for (const [m, agg] of perMeasure) {
          const label = guessChordFromPitchClasses(
            [...agg.pcs],
            agg.lowest === null ? null : agg.lowest % 12
          );
          if (label) out.set(m, label);
        }
        return out;
      }),
    [riffRuns, bandEvents, riffTabs]
  );
  // Note en cours dans le passage de riff affiché : surbrillance temps réel de la
  // colonne jouée, comme dans l'éditeur de riffs (ArpeggioEditor → TabStaffView).
  const activeRiffHighlight = useMemo<Set<string> | undefined>(() => {
    const ri = runOfIndex[index];
    if (ri < 0) return undefined;
    const rel = index - riffRuns[ri].start;
    const cells = riffTabs[ri]?.cells[rel] ?? [];
    if (cells.length === 0) return undefined;
    return new Set(cells.map((c) => `${c.m}|${c.s}|${c.slot}`));
  }, [index, runOfIndex, riffRuns, riffTabs]);
  const dur2 = totalMs / 1000;
  const elapsedPct = totalMs > 0 ? Math.min(100, (elapsedMs / totalMs) * 100) : 0;
  const pct = cur ? (cur.start / dur2) * 100 : elapsedPct;

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 border-b border-zinc-800/60">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
          <h2 className="text-sm font-bold text-white uppercase tracking-widest text-zinc-300">
            Studio
          </h2>
          <span className="text-[11px] text-zinc-500 font-mono">
            {usesAudio ? `${bpm} BPM · stems` : `${bpm} BPM`} · {totalBeat.toFixed(2)} temps ·{" "}
            {dur2.toFixed(1)} s
            {flatLyrics.length > 0 && <> · {flatLyrics.length} lignes de paroles</>}
          </span>
            <span
              className="text-[10px] font-mono text-zinc-600"
              title="Numéro du build en cours — sert à vérifier que le navigateur ne sert pas une version périmée"
            >
              build {BUILD_TAG}
            </span>
          </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => jumpDiagram(-1)}
            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
            title="Diagramme précédent (et saut de la lecture à ce diagramme)"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={togglePlay}
            className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
              playing
                ? "bg-amber-500 text-black hover:bg-amber-400"
                : paused
                  ? "bg-emerald-500 text-black hover:bg-emerald-400"
                  : "bg-emerald-500 text-black hover:bg-emerald-400"
            }`}
            title={playing ? "Pause (reprend où tu t'es arrêté)" : "Lecture"}
          >
            {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => jumpDiagram(1)}
            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
            title="Diagramme suivant (et saut de la lecture à ce diagramme)"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          {playing ? (
            <button
              onClick={stop}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-500 text-white hover:bg-red-400 transition-colors"
              title="Arrêter et revenir au début"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
          ) : (
            paused && (
              <button
                onClick={stop}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-500 text-white hover:bg-red-400 transition-colors"
                title="Arrêter et revenir au début"
              >
                <Square className="w-3.5 h-3.5" />
              </button>
            )
          )}
          <button
            onClick={() => void play(0)}
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
            title="Fermer le Studio"
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
            {bandEvents.map((ev, i) => {
              if (!ev || !ev.shape) return null;
              const runIdx = runOfIndex[i];
              if (runIdx >= 0) {
                const run = riffRuns[runIdx];
                if (i !== run.start) return null;
                const runActive = index >= run.start && index <= run.end;
                return (
                  <div
                    key={`riff-${run.start}`}
                    ref={(el) => {
                      for (let k = run.start; k <= run.end; k++) itemRefs.current[k] = el;
                    }}
                    className={`flex-shrink-0 rounded-xl border transition-all duration-150 overflow-x-auto ${
                      runActive
                        ? "border-cyan-400 shadow-[0_0_24px_rgba(34,211,238,0.45)] bg-zinc-900"
                        : "border-cyan-900/70 bg-zinc-900/50"
                    }`}
                  >
                    <div className={runActive ? "" : "opacity-50"}>
                      <div className="text-center text-[10px] font-bold py-1 truncate px-1 text-cyan-300">
                        Riff · {run.end - run.start + 1} notes
                      </div>
                      <div className="px-1.5 pb-1">
                        <TabStaffView
                          title=""
                          bpm={bpm}
                          tab={riffTabs[runIdx].tab}
                          showMutes={false}
                          highlight={activeRiffHighlight}
                          rests={riffTabs[runIdx].rests}
                          beats={riffTabs[runIdx].grid}
                          measureChords={riffChords[runIdx]}
                          measureOffset={riffTabs[runIdx].measureOffset}
                          maxMeasuresPerLine={16}
                        />
                      </div>
                    </div>
                  </div>
                );
              }
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
              <div className="flex flex-col items-center gap-0.5">
                <span className="text-[11px] font-mono text-zinc-400 bg-zinc-800/60 border border-zinc-700/60 rounded-full px-2.5 py-0.5">
                  Mesure {measureForBeat((cur.start * bpm) / 60, measureInfo) + 1}
                  {" · temps "}
                  {Math.max(1, Math.round(beatInMeasure((cur.start * bpm) / 60, measureInfo)))}
                  <span className="text-zinc-600">/{measureInfo.top}</span>
                  <span className="text-zinc-600"> · {measureInfo.top}/{measureInfo.bottom}</span>
                </span>
                {measureKind && (
                  <span
                    title={
                      measureKind === "riff"
                        ? "Mesure jouée en riffs (1 à 2 cordes à la fois)"
                        : "Mesure en accords (plus de 2 notes simultanées)"
                    }
                    className={`text-[10px] font-mono font-bold border rounded-full px-2 py-0.5 ${
                      measureKind === "riff"
                        ? "text-cyan-300 bg-cyan-500/10 border-cyan-500/40"
                        : "text-amber-300 bg-amber-400/10 border-amber-400/40"
                    }`}
                  >
                    {measureKind === "riff" ? "Riff" : "Accord"}
                  </span>
                )}
              </div>
              {curNv && (
                <span
                  title={curNv.title}
                  className="text-[11px] font-mono font-semibold text-zinc-100 bg-zinc-700/70 border border-zinc-600/70 rounded-full px-2.5 py-0.5"
                >
                  {curNv.label}
                </span>
              )}
              {measureIdxs.map((evIdx) => {
                const mEv = bandEvents[evIdx];
                if (!mEv || !mEv.shape) return null;
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
            {runOfIndex[index] >= 0 ? (
              <div ref={centerTabRef} className="max-w-[min(92vw,52rem)] overflow-x-auto">
                <TabStaffView
                  bpm={bpm}
                  tab={riffTabs[runOfIndex[index]].tab}
                  showMutes={false}
                  highlight={activeRiffHighlight}
                  rests={riffTabs[runOfIndex[index]].rests}
                  beats={riffTabs[runOfIndex[index]].grid}
                  measureChords={riffChords[runOfIndex[index]]}
                  measureOffset={riffTabs[runOfIndex[index]].measureOffset}
                  maxMeasuresPerLine={4}
                />
              </div>
            ) : (
              <div className="w-52 sm:w-80 md:w-96">
                <ChordShapeView shape={cur.shape} />
              </div>
            )}
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
                title="Volume du stem instrumental — à équilibrer avec les diagrammes joués"
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
          {bandEvents.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
              <span className="text-zinc-500 w-20">Synchro</span>
              <button
                onClick={() => changeBandOffset(-1)}
                className="w-9 h-7 rounded-md bg-zinc-800 hover:bg-zinc-700 font-bold text-zinc-300 transition-colors"
                title="Avancer les diagrammes de 1 s par rapport à l'audio"
              >
                -1
              </button>
              <button
                onClick={() => changeBandOffset(-0.1)}
                className="w-9 h-7 rounded-md bg-zinc-800 hover:bg-zinc-700 font-bold text-zinc-400 transition-colors"
                title="Avancer de 0,1 s (ajustement fin)"
              >
                -.1
              </button>
              <span className="font-mono text-amber-400 w-16 text-center">
                {bandOffset >= 0 ? "+" : ""}
                {bandOffset.toFixed(1)} s
              </span>
              <button
                onClick={() => changeBandOffset(0.1)}
                className="w-9 h-7 rounded-md bg-zinc-800 hover:bg-zinc-700 font-bold text-zinc-400 transition-colors"
                title="Retarder de 0,1 s (ajustement fin)"
              >
                +.1
              </button>
              <button
                onClick={() => changeBandOffset(1)}
                className="w-9 h-7 rounded-md bg-zinc-800 hover:bg-zinc-700 font-bold text-zinc-300 transition-colors"
                title="Retarder les diagrammes de 1 s par rapport à l'audio"
              >
                +1
              </button>
              {bandOffset !== 0 && (
                <button
                  onClick={() => changeBandOffset(-bandOffset)}
                  className="text-zinc-500 hover:text-zinc-300 underline transition-colors"
                  title="Remettre la synchro à 0"
                >
                  Reset
                </button>
              )}
              <span className="text-[10px] text-zinc-600">
                diagrammes par rapport à l&apos;audio (sauvegardé par chanson)
              </span>
              {stemShift > 0 && (
                <span
                  className="text-[10px] text-emerald-400/90"
                  title="Le silence de tête des stems est sauté automatiquement au démarrage : diagrammes, paroles et stems partent ensemble, sans réglage"
                >
                  aligné auto +{stemShift.toFixed(1)}s
                </span>
              )}
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