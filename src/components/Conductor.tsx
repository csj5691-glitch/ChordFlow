"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import { ChevronLeft, ChevronRight, Music, Pause, Square, Play, RotateCcw, X } from "lucide-react";
import { renderSequence, beatsForShape, legatoStringName, measureInfoFromSignature, measureForBeat, beatInMeasure, repeatPasses, sectionRepeats, type SynthEvent } from "@/lib/chord-synth";
import { playGmEvent } from "@/lib/gm-voice";
import { soundingNotes } from "@/lib/articulation";
import { parseChordContent } from "@/lib/chord-parser";
import { decodeHtmlEntities } from "@/lib/ug-scraper";
import { loadStemShift, saveStemShift } from "@/lib/line-offsets";
import type { SavedChordShape, SongTab } from "@/lib/types";
import type { PlayerBar, PlayerMeasure, PlayerTrack, TabPlayerSong, TempoPoint } from "@/lib/tab-player/types";
import ChordShapeView from "@/components/ChordShapeView";
import TabStaffView from "@/components/TabStaffView";
import TabPlaybackView from "@/components/TabPlaybackView";
import { BarGlyph } from "@/components/BarGlyph";
import { diagramFrequencies, diagramsToTabWithPositions } from "@/lib/diagrams-to-tab";
import { fromChords } from "@/lib/tab-player/from-chords";
import { guessChordFromPitchClasses } from "@/lib/tab-view";

interface ConductorProps {
  diagrams: SavedChordShape[];
  bpm: number;
  timeSignature?: SongTab["timeSignature"];
  /** Accordage de la piste (libellé « D A F C G C »...), pour la tablature. */
  tuning?: string;
  content: string;
  officialPlain?: string;
  officialSynced?: string;
  instrumentalUrl?: string | null;
  vocalsUrl?: string | null;
  // Instrument GS de la piste (programme MIDI) : timbre de la lecture de la
  // grille synthétisée (sans stems). Aucun effet sur les stems.
  program?: number | null;
  lyricOffset?: number;
  lyricAnchorDiagram?: number;
  /**.identifiant de la chanson (persistance de l'alignement automatique). */
  songId?: string;
  /**.appelé à chaque réglage d'offset des paroles (pour le sauvegarder). */
  /**.décalage de la bande de diagrammes sur la musique, en secondes. */
  bandOffset?: number;
  /**.notifié à chaque réglage du décalage de la bande. */
  onBandOffsetChange?: (offset: number) => void;
  /**.décalage manuel tablature + paroles / stems, en millisecondes. */
  syncLatency?: number;
  /**.notifié à chaque réglage de la latence de synchro. */
  onSyncLatencyChange?: (ms: number) => void;
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
const BUILD_TAG = "tab-repetitions";

export default function Conductor({
  diagrams,
  bpm,
  timeSignature,
  tuning,
  content,
  officialPlain,
  officialSynced,
  instrumentalUrl,
  vocalsUrl,
  program,
  lyricOffset: externalLyricOffset,
  lyricAnchorDiagram,
  bandOffset: externalBandOffset,
  onBandOffsetChange,
  syncLatency: externalSyncLatency,
  onSyncLatencyChange,
  songId,
  onClose,
}: ConductorProps) {
  const events = useMemo(() => renderSequence(diagrams, bpm), [diagrams, bpm]);
  // Tablature animée du morceau, dérivée de la grille : elle remplace l'ancien
  // panneau Riff/Harmonique du Chef. Le moteur ne possède pas d'horloge, elle
  // lui est fournie via gridMsRef plus bas. Les répétitions (et fins alternatives)
  // sont étendues passage par passage, dans l'ordre de lecture du son : chaque
  // passage possède ses propres mesures, la tablature ainsi construite couvre
  // toute la durée jouée et le suivi via gridMsRef la ramène sur le bon passage.
  const tabSong = useMemo(() => {
    if (diagrams.length === 0) return null;
    const bars: PlayerBar[] = [];
    const measures: PlayerMeasure[] = [];
    const tracks: PlayerTrack[] = [];
    const tempo: TempoPoint[] = [{ beat: 0, bpm }];
    const buildPass = (shapes: SavedChordShape[]) => {
      const result = fromChords(shapes, {
        title: "",
        bpm,
        timeSignature,
        tuning,
      });
      const track = result.song.tracks[0];
      if (track.measures.length === 0) return;
      bars.push(...result.song.bars);
      measures.push(...track.measures);
      tracks.push(track);
    };
    for (const shapes of repeatPasses(diagrams)) {
      buildPass(shapes);
    }
    if (bars.length === 0 || tracks.length === 0) return null;
    const song: TabPlayerSong = {
      title: "",
      artist: "",
      source: "",
      bars,
      tempo,
      tracks: [{ meta: tracks[0].meta, measures }],
    };
    return song;
  }, [diagrams, bpm, timeSignature, tuning]);
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
  // Ancre des paroles : la prop fait foi tant que l'utilisateur ne la modifie
  // pas dans le Chef (boutons -/+). On garde le reglage local avec sa valeur
  // de depart pour l'abandonner des que la prop change, sans effet de synchro
  // (un setState dans un effet provoquait un rendu en cascade).
  const [instVolume, setInstVolume] = useState(1);
  const [vocalsVolume, setVocalsVolume] = useState(0.9);
  const [localLyricOffset] = useState(0);
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
    }
  }, [lyricAnchorDiagram]);
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
  // Latence audio : le son sort des haut-parleurs (ou du casque Bluetooth)
  // après l'instant du graphe audio. On retarde d'autant l'horloge VISUELLE
  // (tablature + paroles) pour qu'elle tombe sur ce qu'on entend. Le Chef
  // ajoute la latence de sortie mesurée par le navigateur ; ce réglage-ci est
  // l'ajustement manuel (ms), sauvegardé par chanson par l'éditeur.
  const [localSyncLatency, setLocalSyncLatency] = useState(0);
  const syncLatency = externalSyncLatency ?? localSyncLatency;
  const syncLatencyRef = useRef(0);
  useEffect(() => {
    syncLatencyRef.current = syncLatency;
  }, [syncLatency]);
  const changeSyncLatency = (delta: number) => {
    const next = Math.round(
      Math.max(-1000, Math.min(1000, syncLatency + delta)) / 10
    ) * 10;
    setLocalSyncLatency(next);
    syncLatencyRef.current = next;
    onSyncLatencyChange?.(next);
  };
  // Latence de sortie de l'appareil (ms), relue à chaque démarrage du contexte.
  const autoLatencyRef = useRef(0);
  // Alignement automatique (sans curseurs) : le pré-roll détecté dans les
  // stems (silence de tête avant la musique) est compensé au démarrage, pour
  // que les accords, les paroles et les stems partent ensemble. La valeur
  // calculée est déduite au rendu (voir plus bas) et servie à la lecture via
  // le ref — pas le curseur, et aucune action de l'utilisateur requise.
  const stemShiftRef = useRef(songId ? loadStemShift(songId) : 0);
  const [savedStemShift] = useState(() => (songId ? loadStemShift(songId) : 0));
  const playTokenRef = useRef(0);
  // Rapport grille réelle/temps audio : quand la durée de la séquence d'accords
  // (tracée au BPM stocké) ne rejoint pas la durée réelle des stems, on étire
  // ou compresse l'horloge des diagrammes (voir tick) pour que le dernier
  // diagramme tombe exactement sur la fin de la musique. = 1 : pas de
  // correction (chansons dont le BPM colle, ou aucun stem décodé).
  const tempoRatioRef = useRef(1);
  // Pause/reprise : on mémorise la position dans le morceau, puis on rejoue
  // depuis cet instant (les événements déjà passés sont sautés).
  const [paused, setPaused] = useState(false);
  // Vue centrale du Chef : tablature animée du morceau (par défaut) ou
  // diagramme de l'accord courant, qui reste accessible en un clic.
  const [centerView, setCenterView] = useState<"tab" | "chord">("tab");
  const seekRef = useRef(0);
  const t0Ref = useRef<number | null>(null);
  // Temps de grille courant (ms), décalage de bande compris : c'est l'horloge
  // que lit la tablature animée, comme les diagrammes.
  const gridMsRef = useRef(0);
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

  const [stemStart, setStemStart] = useState<number | null>(null);
  // Vrai quand la détection du pré-roll est terminée (ou qu'il n'y a pas
  // d'audio) : l'autolecture attend ce signal pour démarrer avec le bon
  // alignement, au lieu de partir avant la fin de `detectFirstSound`.
  const [stemProbeDone, setStemProbeDone] = useState(!(instrumentalUrl || vocalsUrl));
  const [stemDuration, setStemDuration] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const stemStartRef = useRef<number | null>(null);
  // Stems joués SUR l'horloge du contexte (échantillon-verrouillés avec les
  // accords) : plus de dérive possible entre la piste <audio> et les accords,
  // et plus de latence de démarrage du lecteur média.
  const stemSourcesRef = useRef<{ inst?: AudioBufferSourceNode; vocals?: AudioBufferSourceNode }>({});
  const stemGainRefs = useRef<{ inst?: GainNode; vocals?: GainNode }>({});
  // Lecture de la GRILLE synthétisée (répétitions comprises) : c'est elle qui
  // fait ENTENDRE les renvois. Elle prend le relais automatiquement quand aucun
  // stem n'est chargé ; avec des stems (enregistrement linéaire, sans renvois),
  // le bouton « Grille » de l'en-tête permet de l'écouter à la place.
  const gridPumpRef = useRef<number | null>(null);
  const gridPlayingRef = useRef(false);
  const gridOnlyRef = useRef(false);
  const [gridOnly, setGridOnly] = useState(false);
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
        } catch {
          // Stem indisponible (blob révoqué après effacement du stockage local,
          // décodage refusé…) : repli silencieux, la piste <audio> prend la relève.
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
  // Sons de la grille : sans stems, c'est la seule source audible ; avec des
  // stems, le mode « Grille » remplace l'enregistrement pour faire sonner les
  // répétitions de la partition.
  const playsGrid = !usesAudio || gridOnly;
  // Compte rendu des renvois de la partition : sections et nombre de passages.
  const repeatSummary = useMemo(() => {
    const ends = diagrams.filter(
      (d) => d.bar && (d.barKind === "endRepeat" || d.barKind === "bothRepeat")
    );
    const byCount = new Map<number, number>();
    for (const d of ends) {
      const n = sectionRepeats(d);
      byCount.set(n, (byCount.get(n) ?? 0) + 1);
    }
    const detail = [...byCount.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([n, count]) => `${count}×${n}`)
      .join(" ");
    return { count: ends.length, detail };
  }, [diagrams]);
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
    if (gridPumpRef.current !== null) {
      window.clearInterval(gridPumpRef.current);
      gridPumpRef.current = null;
    }
    gridPlayingRef.current = false;
    t0Ref.current = null;
    setPaused(false);
    seekRef.current = 0;
    if (ctxRef.current) {
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
    const Ctor =
      window.OfflineAudioContext ??
      (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
        .webkitOfflineAudioContext;
    if (!Ctor) return null;
    try {
      const res = await fetch(url);
      const buf = await res.arrayBuffer();
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
      if (!cancelled) {
        setStemDuration(null);
        setStemProbeDone(!refUrl);
      }
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
        setStemProbeDone(true);
      });
    } else {
      stemStartRef.current = null;
      void Promise.resolve().then(() => {
        if (!cancelled) {
          setStemStart(null);
          setStemProbeDone(true);
        }
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
    // Jeton de lecture : un arrêt (pause, fermeture, changement de source)
    // survenu pendant les `await` ci-dessous doit annuler cette lecture.
    // Sans ce garde-fou, la grille synthétisée continuait de se planifier
    // après un « pause » cliqué pendant le démarrage du contexte audio.
    const token = playTokenRef.current;

    // Lu depuis le ref : le basculement « Grille » redémarre la lecture dans le
    // même geste, avant que l'état React ne soit re-rendu.
    const grid = !usesAudio || gridOnlyRef.current;

    const seek = Math.max(0, fromSec);
    seekRef.current = seek;
    gridMsRef.current = seek * 1000 + bandOffsetRef.current * 1000;
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

    // Deux sources possibles : les stems (enregistrement importé, linéaire) ou
    // la GRILLE synthétisée (respecte les répétitions et les fins alternatives).
    // La grille prend le relais quand aucun stem n'est chargé, ou quand le mode
    // « Grille » est demandé pour entendre les renvois.
    const needCtx = usesAudio || (grid && events.length > 0);
    let ctx: AudioContext | null = null;
    let t0 = 0;
    if (needCtx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
      // Attente BORNÉE de la reprise : sans geste utilisateur (automatique du
      // Studio), certains navigateurs laissent `resume()` en attente. Sans
      // borne, même l'horloge visuelle ne démarrerait pas.
      const resumeWait = async () => {
        await Promise.race([
          ctx !== null ? ctx.resume().catch(() => {}) : Promise.resolve(),
          new Promise<void>((resolve) => window.setTimeout(resolve, 600)),
        ]);
      };
      await resumeWait();
      if (ctx.state !== "running") await resumeWait();
      if (playTokenRef.current !== token) {
        // Lecture annulée pendant la reprise du contexte : on ne planifie rien.
        ctx.close().catch(() => {});
        return;
      }
      // `canSound` : le contexte tourne vraiment. Sinon (autoplay sans geste),
      // on lit la partition à l'écran sans planifier de notes ; le prochain
      // clic sur « Jouer » partira d'un contexte autorisé.
      const canSound = ctx.state === "running";
      if (!canSound) {
        console.warn(
          `[Chef] contexte audio "${ctx.state}" — lecture visuelle seulement : cliquez sur Jouer pour activer le son`
        );
      }
      ctxRef.current = ctx;
      // Latence de sortie de l'appareil : le navigateur la mesure
      // (`outputLatency`) ; à défaut on retombe sur la latence de base du
      // contexte. Elle sert à retarder l'affichage pour coller au son entendu.
      const measured =
        typeof ctx.outputLatency === "number" && ctx.outputLatency > 0
          ? ctx.outputLatency
          : ctx.baseLatency || 0;
      autoLatencyRef.current = Math.round(measured * 1000);
      // Alias non-null : les fermetures (pompe, bus) gardent un typage sûr.
      const ctxSafe = ctx;
      // L'ancrage t0 (position `seek` du morceau) est posé APRÈS le décodage,
      // juste avant de démarrer les sources : la planification sample-verrouillée
      // (t0 + position) reste exacte quelle que soit la durée du décodage, et les
      // diagrammes suivent la musique sans lag ni dérive.
      // Les stems audio (enregistrements importés) sont joués SUR le même
      // contexte audio (échantillon-verrouillés) ; la piste <audio> ne sert plus
      // que de repli si le décodage échoue. En mode « Grille », on ne décode
      // aucun stem : la synthèse joue la partition, répétitions comprises.
      if (canSound && usesAudio && !grid) {
        let stemsOnCtx = false;
        const shift = stemShiftRef.current;
        const [instBuf, vocBuf] = await Promise.all([
          instrumentalUrl ? decodeStemBuffer(ctxSafe, instrumentalUrl) : Promise.resolve(null),
          vocalsUrl ? decodeStemBuffer(ctxSafe, vocalsUrl) : Promise.resolve(null),
        ]);
        if (instBuf || vocBuf) {
          t0 = ctxSafe.currentTime + 0.15 - seek;
          t0Ref.current = t0;
          // Étalonnage tempo : la grille s'étire sur la durée RÉELLE de la
          // musique (durée du stem décodée à l'échantillon, moins le silence de
          // tête déjà compensé), pas sur le BPM stocké qui peut diverger de la
          // piste enregistrée (imports GP, versions, tempo libre…).
          const gridSec = totalMs / 1000;
          const audioSec = (instBuf?.duration ?? vocBuf?.duration ?? 0) - Math.max(0, shift);
          tempoRatioRef.current =
            audioSec > 2 && gridSec > 2 && Math.abs(gridSec - audioSec) > 1.5
              ? gridSec / audioSec
              : 1;
        }
        const startStem = (
          kind: "inst" | "vocals",
          buf: AudioBuffer | null,
          volume: number
        ) => {
          if (!buf || buf.duration <= 0 || !t0Ref.current) return;
          const gainNode = ctxSafe.createGain();
          gainNode.gain.value = volume;
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
        startStem("inst", instBuf, instVolRef.current);
        startStem("vocals", vocBuf, vocalsVolRef.current);
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

      // Lecture annulée pendant le décodage des stems : rien à planifier.
      if (playTokenRef.current !== token) {
        ctx.close().catch(() => {});
        return;
      }

      // ---------- GRILLE SYNTHÉTISÉE (répétitions) ----------
      // Joue la séquence rendue par `renderSequence`, donc chaque passage des
      // sections répétées et les fins alternatives : c'est le seul moyen
      // d'ENTENDRE une répétition de la partition (un enregistrement de stems
      // est linéaire et ne contient pas les renvois).
      if (canSound && grid && events.length > 0) {
        t0 = ctxSafe.currentTime + 0.15 - seek;
        t0Ref.current = t0;
        tempoRatioRef.current = 1;
        gridPlayingRef.current = true;
        const bus = ctxSafe.createGain();
        bus.gain.value = 0.5;
        bus.connect(ctxSafe.destination);
        // Planification progressive (fenêtre glissante) : les voix ne sont
        // créées qu'au moment de jouer, sinon une longue séquence saturerait le
        // graphe audio.
        let ptr = 0;
        while (ptr < events.length && events[ptr].start + events[ptr].duration <= seek) {
          ptr++;
        }
        const pumpGrid = () => {
          if (!gridPlayingRef.current || ctxRef.current !== ctxSafe) return;
          const horizon = ctxSafe.currentTime - t0 + 0.4;
          while (ptr < events.length && events[ptr].start <= horizon) {
            const ev = events[ptr++];
            if (ev.silence) continue;
            // Événement à cheval sur le point de reprise : on ne joue que le
            // reste.
            const left = ev.start + ev.duration - seek;
            if (left <= 0) continue;
            const at = Math.max(ctxSafe.currentTime, t0 + ev.start);
            const dur = Math.max(0.12, Math.min(ev.duration, left));
            playGmEvent(ctxSafe, { ...ev, duration: dur }, bus, at, program, {
              strum: "down",
            });
          }
        };
        pumpGrid();
        gridPumpRef.current = window.setInterval(pumpGrid, 60);
      }
    }

    let startedAt = 0;
    const tick = () => {
      // L'horloge d'interface démarre à la position de lecture (t = seek au
      // démarrage), pour que pause/reprise et sauts restent exacts.
      if (startedAt === 0) startedAt = performance.now() + 100 - seek * 1000;
      // Avec des stems décodées sur le contexte audio, l'horloge VISUELLE est
      // calée sur ctx.currentTime (échantillon-verrouillée) : la durée de
      // décodage et la latence des timers ne peuvent plus décaler les
      // diagrammes derrière la musique. Idem pour la grille synthétisée, qui
      // planifie ses notes sur ce même contexte. Repli sur performance.now().
      const t =
        ctx &&
        ctx.state === "running" &&
        (stemSourcesRef.current.inst || stemSourcesRef.current.vocals || gridPlayingRef.current)
          ? (ctx.currentTime - t0) * 1000
          : performance.now() - startedAt;
      // Horloge d'affichage : on retire la latence de sortie de l'appareil (et
      // l'ajustement manuel) pour que tablature et paroles tombent sur le son
      // réellement entendu, pas sur l'instant où il est envoyé au matériel.
      const latencyMs = autoLatencyRef.current + syncLatencyRef.current;
      const tSync = t - latencyMs;
      // Étalonnage temps réel → temps de grille. On ne compresse que la
      // distance parcourue (pas l'ancre) pour que pause/reprise et sauts
      // restent continus ; sans correction le rapport vaut 1 et l'horloge est
      // inchangée.
      const ratioTempo = tempoRatioRef.current;
      const seekMs = seek * 1000;
      const gridClock =
        (ratioTempo === 1 ? t : seekMs + (t - seekMs) * ratioTempo) - latencyMs;
      // En lecture de grille, la musique EST la grille : le décalage de synchro
      // (prévu pour caler des stems) n'a plus lieu d'être, sinon les cartes
      // seraient décalées par rapport au son.
      const bandShiftMs = gridPlayingRef.current
        ? 0
        : Math.max(0, bandOffsetRef.current) * 1000;
      // Le décalage de synchro peut repousser la fin : on ne doit pas arrêter
      // avant lui. Avec étalonnage, la fin de grille arrive à la fin réelle des
      // stems (t = seek + (totalMs - seek) / rapport).
      const limit =
        ratioTempo === 1
          ? Math.max(totalMs, bandShiftMs)
          : Math.max(seekMs + (totalMs - seekMs) / ratioTempo, bandShiftMs);
      if (bandEvents.length === 0) setElapsedMs(t);
      // Le décalage de bande rend la synchro malléable : un décalage positif
      // retarde l'affichage des diagrammes par rapport à la musique.
      const tb =
        gridClock + (gridPlayingRef.current ? 0 : bandOffsetRef.current * 1000);
      gridMsRef.current = tb;
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
            if (tm !== null && tm * 1000 <= tSync) li = k;
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
            const clock = tSync + lyricOffsetRef.current * 1000;
            if (clock >= start) {
              const span = Math.max(1, limit - latencyMs - start);
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
    program,
    instrumentalUrl,
    vocalsUrl,
    decodeStemBuffer,
  ]);

  const playedRef = useRef(false);
  // Position courante dans le morceau (s), que la lecture soit active ou en pause.
  const currentPosSec = useCallback((): number => {
    const t0 = t0Ref.current;
    const ctx = ctxRef.current;
    if (t0 !== null && ctx && ctx.state === "running") {
      const audioSec = Math.max(0, ctx.currentTime - t0);
      const ratio = tempoRatioRef.current;
      // La position audio doit être ramenée en temps de grille, sinon une
      // pause/reprise ou un saut repart sur la position audio brute et dérive
      // dès que l'étalonnage tempo est différent de 1.
      if (ratio === 1) return audioSec;
      const seek = seekRef.current;
      return seek + (audioSec - seek) * ratio;
    }
    return seekRef.current;
  }, []);

  // Horloge stable (identité constante) lue par la tablature à chaque image.
  const tabTime = useCallback(() => Math.max(0, gridMsRef.current / 1000), []);

  // Clic sur une mesure de la tablature : on relance la lecture à cet endroit.
  const tabSeek = useCallback(
    (seconds: number) => {
      const target = Math.max(0, seconds - bandOffsetRef.current);
      if (playing || paused) void play(target);
      else {
        seekRef.current = target;
        gridMsRef.current = seconds * 1000;
      }
    },
    [playing, paused, play]
  );

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

  // Bascule sonore : « Audio » (stems, enregistrement linéaire) ou « Grille »
  // (partition synthétisée, répétitions comprises). Le redémarrage immédiat
  // évite que la lecture continue avec l'ancienne source.
  const toggleGridSound = useCallback(() => {
    const next = !gridOnlyRef.current;
    gridOnlyRef.current = next;
    setGridOnly(next);
    if (playing || paused) {
      const pos = currentPosSec();
      stop();
      seekRef.current = pos;
      void play(pos);
    }
  }, [playing, paused, play, stop, currentPosSec]);

  // Diagramme précédent / suivant : saute la lecture au début de ce diagramme.
  const jumpDiagram = useCallback(
    (dir: -1 | 1) => {
      const list = bandEvents;
      if (list.length === 0) return;
      // La grille synthétisée n'utilise pas le décalage de synchro des stems.
      const shift = !usesAudio || gridOnlyRef.current ? 0 : bandOffsetRef.current;
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
        gridMsRef.current = start * 1000 + shift * 1000;
        setElapsedMs(start * 1000);
      }
    },
    [bandEvents, currentPosSec, play, playing, paused, usesAudio]
  );
  useEffect(() => {
    if (!stemProbeDone) return;
    if (playedRef.current || events.length === 0) return;
    playedRef.current = true;
    const t = window.setTimeout(() => void play(0), 50);
    return () => {
      window.clearTimeout(t);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, stemProbeDone]);

  // Autolecture sans accords : les stems se lisent seuls dès que la durée
  // audio est connue (les accords restent gérés par l'effet ci-dessus).
  useEffect(() => {
    if (!stemProbeDone) return;
    if (events.length > 0) return;
    if (playedRef.current || stemDuration === null) return;
    playedRef.current = true;
    const t = window.setTimeout(() => void play(0), 50);
    return () => {
      window.clearTimeout(t);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, stemDuration, stemProbeDone]);

  // Temps réellement joués (répétitions et fins alternatives comprises) :
  // c'est la durée lue de la grille, pas la somme brute des formes.
  const totalBeat = events.reduce((a, e) => a + e.duration, 0) * (bpm / 60);
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
  // Quand l'harmonie change en cours de mesure, on scinde la mesure en deux
  // tranches de 2 temps et on affiche les deux accords (ex. « G / A »).
  const riffChords = useMemo(
    () =>
      riffRuns.map((r, ri) => {
        const shapes = bandEvents.slice(r.start, r.end + 1).map((e) => e.shape);
        const cells = riffTabs[ri]?.cells ?? [];
        const grid = riffTabs[ri]?.grid ?? [];
        type Agg = { pcs: Set<number>; lowest: number | null };
        const entire = new Map<number, Agg>();
        const halves = new Map<number, [Agg, Agg]>();
        const makeAgg = (): Agg => ({ pcs: new Set(), lowest: null });
        const addTo = (agg: Agg, midi: number) => {
          agg.pcs.add(((midi % 12) + 12) % 12);
          if (agg.lowest === null || midi < agg.lowest) agg.lowest = midi;
        };
        for (let i = 0; i < shapes.length; i++) {
          const cell = cells[i]?.[0];
          if (!cell) continue;
          const m = cell.m;
          // Colonne de la note dans la mesure (grille pleine largeur) : au-delà de
          // la moitié des colonnes, la note appartient à la seconde moitié.
          const slots = grid[m]?.slots ?? 0;
          const half = slots > 0 && cell.slot >= slots / 2 ? 1 : 0;
          let whole = entire.get(m);
          if (!whole) {
            whole = makeAgg();
            entire.set(m, whole);
          }
          let pair = halves.get(m);
          if (!pair) {
            pair = [makeAgg(), makeAgg()];
            halves.set(m, pair);
          }
          const targets = [whole, pair[half]];
          for (const f of diagramFrequencies(shapes[i])) {
            if (!Number.isFinite(f) || f <= 0) continue;
            const midi = Math.round(69 + 12 * Math.log2(f / 440));
            for (const t of targets) addTo(t, midi);
          }
        }
        const label = (agg: Agg): string | null =>
          agg.pcs.size > 0
            ? guessChordFromPitchClasses(
                [...agg.pcs],
                agg.lowest === null ? null : agg.lowest % 12
              )
            : null;
        const out = new Map<number, string[]>();
        for (const [m, whole] of entire) {
          const w = label(whole);
          const pair = halves.get(m);
          const a = pair && pair[0].pcs.size >= 3 ? label(pair[0]) : null;
          const b = pair && pair[1].pcs.size >= 3 ? label(pair[1]) : null;
          if (a && b && a !== b) out.set(m, [a, b]);
          else if (w) out.set(m, [w]);
          else if (a) out.set(m, [a]);
          else if (b) out.set(m, [b]);
        }
        return out;
      }),
    [riffRuns, bandEvents, riffTabs]
  );
  // Note en cours dans le passage de riff affiché : surbrillance temps réel de la
  // colonne jouée, comme dans l'éditeur de riffs (ArpeggioEditor → TabStaffView).
  const activeRiffHighlight = useMemo<Set<string> | undefined>(() => {
    const ri = runOfIndex[index];
    if (ri === undefined || ri < 0 || ri >= riffRuns.length) return undefined;
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
            {playsGrid ? `${bpm} BPM · grille` : `${bpm} BPM · audio`} ·{" "}
            {totalBeat.toFixed(2)} temps · {dur2.toFixed(1)} s
            {repeatSummary.count > 0 ? (
              <span className="text-amber-400/90">
                {" "}
                · {repeatSummary.count} répétition{repeatSummary.count > 1 ? "s" : ""} ({repeatSummary.detail} passages)
              </span>
            ) : (
              <span className="text-zinc-600"> · aucune répétition</span>
            )}
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
          {usesAudio && (
            <button
              onClick={toggleGridSound}
              className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-colors ${
                gridOnly
                  ? "bg-amber-400 text-black hover:bg-amber-300"
                  : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
              }`}
              title={
                gridOnly
                  ? "Revenir à l'enregistrement (stems)"
                  : "Écouter la grille synthétisée : les répétitions et les fins alternatives sont jouées"
              }
            >
              <Music className="w-3.5 h-3.5" />
              {gridOnly ? "Audio (stems)" : "Grille (répétitions)"}
            </button>
          )}
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
            {tabSong ? (
              <div className="flex w-full flex-col items-center gap-2">
                <div className="flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-900 p-0.5 text-[10px] font-bold">
                  <button
                    onClick={() => setCenterView("tab")}
                    className={`rounded-full px-3 py-0.5 transition-colors ${
                      centerView === "tab"
                        ? "bg-cyan-400/25 text-cyan-200 border border-cyan-400/50"
                        : "text-zinc-400 hover:text-zinc-200 border border-transparent"
                    }`}
                  >
                    Tablature
                  </button>
                  <button
                    onClick={() => setCenterView("chord")}
                    className={`rounded-full px-3 py-0.5 transition-colors ${
                      centerView === "chord"
                        ? "bg-amber-400/25 text-amber-200 border border-amber-400/50"
                        : "text-zinc-400 hover:text-zinc-200 border border-transparent"
                    }`}
                  >
                    Diagramme
                  </button>
                </div>
                {centerView === "tab" ? (
                  <div className="w-screen max-w-[calc(100vw-10px)]">
                    <TabPlaybackView
                      song={tabSong}
                      follow
                      singleLine
                      maxHeight={300}
                      getTime={tabTime}
                      onSeek={tabSeek}
                    />
                  </div>
                ) : (
                  <div className="w-52 sm:w-80 md:w-96">
                    <ChordShapeView shape={cur.shape} />
                  </div>
                )}
              </div>
            ) : runOfIndex[index] >= 0 ? (
              <div className="flex w-full flex-col items-center gap-2">
                <div
                  className="w-screen max-w-[calc(100vw-10px)] overflow-x-auto"
                >
                  <TabStaffView
                    bpm={bpm}
                    tab={riffTabs[runOfIndex[index]].tab}
                    showMutes={false}
                    highlight={activeRiffHighlight}
                    rests={riffTabs[runOfIndex[index]].rests}
                    beats={riffTabs[runOfIndex[index]].grid}
                    measureChords={riffChords[runOfIndex[index]]}
                    measureOffset={riffTabs[runOfIndex[index]].measureOffset}
                    maxMeasuresPerLine={9999}
                  />
                </div>
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
                  title="Le silence de tête des stems est sauté automatiquement au démarrage : diagrammes, paroles et stems partent ensemble (affiner avec Sync si besoin)"
                >
                  aligné auto +{stemShift.toFixed(1)}s
                </span>
              )}
            </div>
          )}
        </div>
        {usesAudio && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
            <span
              className="text-zinc-500 w-20"
              title="Latence entre l'horloge audio et le son réellement entendu (haut-parleurs, casque, Bluetooth)"
            >
              Sync
            </span>
            <button
              onClick={() => changeSyncLatency(-50)}
              className="w-9 h-7 rounded-md bg-zinc-800 hover:bg-zinc-700 font-bold text-zinc-300 transition-colors"
              title="Avancer la tablature et les paroles de 50 ms (si elles sont en retard sur le son)"
            >
              -50
            </button>
            <button
              onClick={() => changeSyncLatency(-10)}
              className="w-9 h-7 rounded-md bg-zinc-800 hover:bg-zinc-700 font-bold text-zinc-400 transition-colors"
              title="Avancer de 10 ms (ajustement fin)"
            >
              -10
            </button>
            <span className="font-mono text-amber-400 w-16 text-center">
              {syncLatency > 0 ? "+" : ""}
              {syncLatency} ms
            </span>
            <button
              onClick={() => changeSyncLatency(10)}
              className="w-9 h-7 rounded-md bg-zinc-800 hover:bg-zinc-700 font-bold text-zinc-400 transition-colors"
              title="Retarder de 10 ms (ajustement fin)"
            >
              +10
            </button>
            <button
              onClick={() => changeSyncLatency(50)}
              className="w-9 h-7 rounded-md bg-zinc-800 hover:bg-zinc-700 font-bold text-zinc-300 transition-colors"
              title="Retarder la tablature et les paroles de 50 ms (si elles sont en avance sur le son)"
            >
              +50
            </button>
            {syncLatency !== 0 && (
              <button
                onClick={() => changeSyncLatency(-syncLatency)}
                className="text-zinc-500 hover:text-zinc-300 underline transition-colors"
                title="Revenir à la latence automatique de l'appareil"
              >
                Reset
              </button>
            )}
            <span className="text-[10px] text-zinc-600">
              tablature + paroles par rapport aux stems · 0 = latence auto de
              l&apos;appareil (sauvegardé par chanson)
            </span>
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