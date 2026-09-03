"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { useEffect, useRef, useState, useCallback } from "react";
import { setCurrentTime } from "@/lib/playback-store";
import {
  saveAudioStem,
  loadAudioStems,
  getAudioStemUrl,
  clearAudioStems,
} from "@/lib/audio-store";

interface DualTrackPlayerProps {
  songId: string;
  onDurationChange?: (duration: number) => void;
  seekTo?: number | null;
}

export default function DualTrackPlayer({
  songId,
  onDurationChange,
  seekTo,
}: DualTrackPlayerProps) {
  const noVocalsRef = useRef<HTMLAudioElement>(null);
  const vocalsRef = useRef<HTMLAudioElement>(null);
  const [noVocalsUrl, setNoVocalsUrl] = useState<string | null>(null);
  const [vocalsUrl, setVocalsUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [noVocalsVol, setNoVocalsVol] = useState(1);
  const [vocalsVol, setVocalsVol] = useState(0.7);
  const animFrameRef = useRef<number>(0);
  const revokeUrlsRef = useRef<string[]>([]);

  const revokeAll = useCallback(() => {
    revokeUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    revokeUrlsRef.current = [];
  }, []);

  useEffect(() => {
    let active = true;
    loadAudioStems(songId).then((stems) => {
      if (!active || !stems) return;
      const nv = getAudioStemUrl(stems.noVocals);
      const v = getAudioStemUrl(stems.vocals);
      if (nv) revokeUrlsRef.current.push(nv);
      if (v) revokeUrlsRef.current.push(v);
      setNoVocalsUrl(nv);
      setVocalsUrl(v);
    });
    return () => {
      active = false;
      revokeAll();
    };
  }, [songId, revokeAll]);

  const tick = useCallback(() => {
    if (vocalsRef.current) {
      setCurrentTime(vocalsRef.current.currentTime);
    }
  }, []);

  useEffect(() => {
    if (!isPlaying) return;
    const step = () => {
      tick();
      animFrameRef.current = window.requestAnimationFrame(step);
    };
    animFrameRef.current = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(animFrameRef.current);
  }, [isPlaying, tick]);

  useEffect(() => {
    if (noVocalsRef.current) noVocalsRef.current.volume = noVocalsVol;
  }, [noVocalsVol]);

  useEffect(() => {
    if (vocalsRef.current) vocalsRef.current.volume = vocalsVol;
  }, [vocalsVol]);

  useEffect(() => {
    if (seekTo === null || seekTo === undefined) return;
    [noVocalsRef.current, vocalsRef.current].forEach((a) => {
      if (a) a.currentTime = seekTo;
    });
  }, [seekTo]);

  const togglePlay = useCallback(() => {
    const nv = noVocalsRef.current;
    const v = vocalsRef.current;
    if (!nv || !v) return;
    if (isPlaying) {
      nv.pause();
      v.pause();
    } else {
      nv.play();
      v.play();
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying]);

  const syncTime = useCallback((source: HTMLAudioElement) => {
    const master = source.currentTime;
    [noVocalsRef.current, vocalsRef.current].forEach((a) => {
      if (a && a !== source && Math.abs(a.currentTime - master) > 0.05) {
        a.currentTime = master;
      }
    });
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    if (noVocalsRef.current && vocalsRef.current && onDurationChange) {
      onDurationChange(noVocalsRef.current.duration);
    }
  }, [onDurationChange]);

  const onFilePick = useCallback(
    (kind: "noVocals" | "vocals", file: File) => {
      saveAudioStem(songId, kind, file).then(() => {
        const url = URL.createObjectURL(file);
        revokeUrlsRef.current.push(url);
        if (kind === "noVocals") setNoVocalsUrl(url);
        else setVocalsUrl(url);
      });
    },
    [songId]
  );

  const onClearAll = useCallback(() => {
    clearAudioStems(songId).then(revokeAll);
    setNoVocalsUrl(null);
    setVocalsUrl(null);
  }, [songId, revokeAll]);

  const fileInput = (
    kind: "noVocals" | "vocals",
    accept: string
  ) => {
    return (
      <input
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFilePick(kind, file);
          e.target.value = "";
        }}
      />
    );
  };

  return (
    <div className="bg-zinc-800/50 rounded-xl border border-zinc-700/50 p-4">
      <audio
        ref={noVocalsRef}
        src={noVocalsUrl ?? undefined}
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={(e) => syncTime(e.currentTarget)}
        className="hidden"
        preload="metadata"
      />
      <audio
        ref={vocalsRef}
        src={vocalsUrl ?? undefined}
        onTimeUpdate={(e) => syncTime(e.currentTarget)}
        className="hidden"
        preload="metadata"
      />

      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={togglePlay}
          disabled={!noVocalsUrl && !vocalsUrl}
          className="w-12 h-12 rounded-full bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 text-black disabled:text-zinc-500 flex items-center justify-center transition-colors flex-shrink-0"
        >
          {isPlaying ? (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
        <span className="text-sm text-zinc-300 font-medium">2 pistes (instrumental + voix)</span>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <label
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors ${
              noVocalsUrl
                ? "bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30"
                : "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
            }`}
            title={noVocalsUrl ? "Changer la piste instrumentale" : "Importer la piste instrumentale (sans voix)"}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
            Instrumental
            {fileInput("noVocals", "audio/*")}
          </label>
          <div className="flex items-center gap-2 flex-1">
            <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            </svg>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={noVocalsVol}
              onChange={(e) => setNoVocalsVol(parseFloat(e.target.value))}
              className="flex-1 h-1 accent-emerald-500"
              aria-label="Volume instrumental"
            />
            <span className="text-xs text-zinc-500 w-8 text-right">{Math.round(noVocalsVol * 100)}%</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors ${
              vocalsUrl
                ? "bg-amber-600/20 text-amber-300 hover:bg-amber-600/30"
                : "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
            }`}
            title={vocalsUrl ? "Changer la piste vocale" : "Importer la piste vocale (voix seule)"}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
            </svg>
            Voix
            {fileInput("vocals", "audio/*")}
          </label>
          <div className="flex items-center gap-2 flex-1">
            <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            </svg>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={vocalsVol}
              onChange={(e) => setVocalsVol(parseFloat(e.target.value))}
              className="flex-1 h-1 accent-amber-500"
              aria-label="Volume voix"
            />
            <span className="text-xs text-zinc-500 w-8 text-right">{Math.round(vocalsVol * 100)}%</span>
          </div>
        </div>
      </div>

      {(noVocalsUrl || vocalsUrl) && (
        <button
          onClick={onClearAll}
          className="mt-3 text-xs text-zinc-500 hover:text-zinc-300 underline transition-colors"
        >
          Effacer les 2 pistes
        </button>
      )}
    </div>
  );
}
