"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.

// POC : lecteur de tablature animee, branche sur playback-store.
//
// Route isolee, sans Supabase ni persistance : le morceau charge ici reste en
// memoire. Le transport ecrit dans `setCurrentTime` exactement comme le fera le
// Studio, et `TabPlaybackView` ne fait que lire cette horloge.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw, Upload } from "lucide-react";
import TabPlaybackView from "@/components/TabPlaybackView";
import { loadGuitarProScore } from "@/lib/gp-import";
import { setCurrentTime } from "@/lib/playback-store";
import { AUDITION_LEAD, createAudition } from "@/lib/tab-player/audition";
import { demoSong } from "@/lib/tab-player/demo-song";
import { fromAlphaTabScore, type AdapterStats } from "@/lib/tab-player/from-alphaTab";
import { createTiming } from "@/lib/tab-player/timing";
import type { TabPlayerSong } from "@/lib/tab-player/types";

const formatTime = (seconds: number): string => {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
};

export default function PocTabPage() {
  const [song, setSong] = useState<TabPlayerSong>(demoSong);
  const [stats, setStats] = useState<AdapterStats | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [follow, setFollow] = useState(true);
  const [sound, setSound] = useState(true);

  const timing = createTiming(song.tempo, song.bars.reduce((sum, bar) => sum + bar.beats, 0));
  const duration = timing.duration;

  const rafRef = useRef(0);
  const anchorRef = useRef({ wall: 0, position: 0 });

  // Son de controle : une instance par morceau, jete avec lui.
  const audition = useMemo(() => createAudition(song), [song]);
  useEffect(() => () => audition.dispose(), [audition]);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    audition.stop();
    setPlaying(false);
  }, [audition]);

  const seek = useCallback(
    (time: number) => {
      const clamped = Math.min(duration, Math.max(0, time));
      const wall = performance.now() + (playing ? AUDITION_LEAD * 1000 : 0);
      anchorRef.current = { wall, position: clamped };
      setCurrentTime(clamped);
      setPosition(clamped);
      if (playing) {
        if (sound) audition.start(clamped, AUDITION_LEAD);
        else audition.stop();
      }
    },
    [audition, duration, playing, sound]
  );

  const play = useCallback(() => {
    if (playing) return;
    // Repartir du debut si la lecture est terminee.
    const start = position >= duration - 0.05 ? 0 : position;
    // L'image et le son partent ensemble : le decalage audio est repris par
    // l'horloge visuelle (le curseur reste sur place pendant le pre-roll).
    anchorRef.current = {
      wall: performance.now() + (sound ? AUDITION_LEAD * 1000 : 0),
      position: start,
    };
    setPlaying(true);
    if (sound) audition.start(start, AUDITION_LEAD);
    else audition.stop();

    let shown = -1;
    const frame = () => {
      const elapsed = Math.max(0, performance.now() - anchorRef.current.wall) / 1000;
      let time = anchorRef.current.position + elapsed;
      if (time >= duration) {
        time = duration;
        setCurrentTime(time);
        setPosition(time);
        stop();
        return;
      }
      setCurrentTime(time);
      const tenth = Math.round(time * 10);
      if (tenth !== shown) {
        shown = tenth;
        setPosition(time);
      }
      rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);
  }, [audition, duration, playing, position, sound, stop]);

  const toggle = useCallback(() => {
    if (playing) {
      const time = Math.min(
        duration,
        anchorRef.current.position +
          Math.max(0, performance.now() - anchorRef.current.wall) / 1000
      );
      stop();
      setCurrentTime(time);
      setPosition(time);
    } else {
      play();
    }
  }, [duration, play, playing, stop]);

  // Remise a zero de l'horloge au montage et arret de la boucle au demontage.
  useEffect(() => {
    setCurrentTime(0);
    anchorRef.current = { wall: performance.now(), position: 0 };
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // Charger un morceau repart de zero : l'horloge partagee ne doit pas garder
  // la position du morceau precedent.
  const applySong = useCallback(
    (next: TabPlayerSong) => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      audition.stop();
      setPlaying(false);
      setCurrentTime(0);
      setPosition(0);
      anchorRef.current = { wall: performance.now(), position: 0 };
      setSong(next);
    },
    [audition]
  );

  const importFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      try {
        const score = await loadGuitarProScore(file);
        const adapted = fromAlphaTabScore(score);
        if (adapted.song.tracks.length === 0) {
          setError("Aucune piste de tablature jouable dans ce fichier.");
        }
        applySong(adapted.song);
        setStats(adapted.stats);
        setWarnings(adapted.warnings);
        setFileName(file.name);
      } catch (cause) {
        console.error(cause);
        setError("Lecture impossible : " + (cause instanceof Error ? cause.message : String(cause)));
      } finally {
        setBusy(false);
      }
    },
    [applySong]
  );

  // Chargement de developpement : /poc/tab?gp=/morceau.gp
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const url = params.get("gp");
    if (!url) return;
    let cancelled = false;
    (async () => {
      setBusy(true);
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        const name = url.split("/").pop() || "morceau.gp";
        if (!cancelled) await importFile(new File([blob], name));
      } catch (cause) {
        if (!cancelled) {
          setError("Chargement ?gp= impossible : " + (cause instanceof Error ? cause.message : String(cause)));
          setBusy(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [importFile]);

  const reset = useCallback(() => {
    applySong(demoSong);
    setStats(null);
    setWarnings([]);
    setFileName(null);
    setError(null);
  }, [applySong]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-6 text-zinc-200">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-400">
            POC · lecteur de tablature
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-zinc-50">{song.title}</h1>
          <p className="text-sm text-zinc-400">
            {song.artist ?? "sans artiste"}
            {fileName ? ` · ${fileName}` : " · morceau de demonstration"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm hover:border-zinc-500">
            <Upload size={15} />
            {busy ? "Lecture..." : "Ouvrir un .gp"}
            <input
              type="file"
              accept=".gp,.gp3,.gp4,.gp5,.gpx,.musicxml,.xml"
              className="hidden"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importFile(file);
                event.target.value = "";
              }}
            />
          </label>
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-md border border-zinc-800 px-3 py-2 text-sm text-zinc-400 hover:border-zinc-600 hover:text-zinc-200"
          >
            <RotateCcw size={15} />
            Demo
          </button>
        </div>
      </header>

      {error && (
        <p className="rounded-md border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <section className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
        <button
          type="button"
          onClick={toggle}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-amber-400 text-black hover:bg-amber-300"
          aria-label={playing ? "Pause" : "Lecture"}
        >
          {playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
        </button>

        <span className="font-mono text-xs tabular-nums text-zinc-400">
          {formatTime(position)} / {formatTime(duration)}
        </span>

        <input
          type="range"
          min={0}
          max={Math.max(0.01, duration)}
          step={0.01}
          value={position}
          onChange={(event) => seek(Number(event.target.value))}
          className="h-1 min-w-40 flex-1 accent-amber-400"
          aria-label="Position"
        />

        <label className="inline-flex items-center gap-2 text-xs text-zinc-400">
          <input
            type="checkbox"
            checked={follow}
            onChange={(event) => setFollow(event.target.checked)}
            className="accent-amber-400"
          />
          Suivre
        </label>

        <label className="inline-flex items-center gap-2 text-xs text-zinc-400">
          <input
            type="checkbox"
            checked={sound}
            onChange={(event) => {
              const on = event.target.checked;
              setSound(on);
              if (!on) audition.stop();
              else if (playing) audition.start(position, 0.02);
            }}
            className="accent-amber-400"
          />
          Son
        </label>
      </section>

      <TabPlaybackView song={song} follow={follow} onSeek={seek} maxHeight={620} />

      <section className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          <h2 className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            Morceau
          </h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-xs">
            <dt className="text-zinc-500">Pistes</dt>
            <dd>{song.tracks.length}</dd>
            <dt className="text-zinc-500">Mesures</dt>
            <dd>{song.bars.length}</dd>
            <dt className="text-zinc-500">Beats</dt>
            <dd>{timing.totalBeats.toFixed(2)}</dd>
            <dt className="text-zinc-500">Duree</dt>
            <dd>{formatTime(duration)}</dd>
            <dt className="text-zinc-500">Tempo</dt>
            <dd>{song.tempo.map((point) => `${Math.round(point.bpm)}@${point.beat.toFixed(1)}`).join(" · ")}</dd>
          </dl>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
          <h2 className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            Adaptateur
          </h2>
          {stats ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-xs">
              <dt className="text-zinc-500">Notes</dt>
              <dd>{stats.notes}</dd>
              <dt className="text-zinc-500">Liaisons</dt>
              <dd>{stats.ties}</dd>
              <dt className="text-zinc-500">Etouffees</dt>
              <dd>{stats.dead}</dd>
              <dt className="text-zinc-500">Mesures completees</dt>
              <dd>{stats.paddedMeasures}</dd>
              <dt className="text-zinc-500">Mesures en trop</dt>
              <dd>{stats.overflowMeasures}</dd>
              <dt className="text-zinc-500">Pistes ignorees</dt>
              <dd>{stats.skippedTracks}</dd>
              <dt className="text-zinc-500">Ornements ignores</dt>
              <dd>{stats.graceSkipped}</dd>
              <dt className="text-zinc-500">Points de tempo</dt>
              <dd>{stats.tempoPoints}</dd>
            </dl>
          ) : (
            <p className="text-xs text-zinc-500">
              Morceau de demonstration : charge un fichier Guitar Pro pour voir les
              statistiques de conversion.
            </p>
          )}
          {warnings.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-amber-300/80">
              {warnings.map((warning) => (
                <li key={warning}>· {warning}</li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <p className="font-mono text-[11px] text-zinc-600">
        Transport local : chaque image ecrit dans setCurrentTime(). Le composant de
        tablature ne possede ni horloge ni audio ; le son de controle (synthese
        locale, provisoire) suit la meme horloge. Aucune donnee n&apos;est envoyee.
      </p>
    </main>
  );
}
