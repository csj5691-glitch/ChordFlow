"use client";

import { useEffect, useRef, useCallback, useState } from "react";

interface AudioPlayerProps {
  audioUrl: string | null;
  onTimeUpdate?: (time: number) => void;
  onDurationChange?: (duration: number) => void;
  seekTo?: number | null;
}

export default function AudioPlayer({
  audioUrl,
  onTimeUpdate,
  onDurationChange,
  seekTo,
}: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const animFrameRef = useRef<number>(0);

  const tick = useCallback(() => {
    if (audioRef.current && onTimeUpdate) {
      onTimeUpdate(audioRef.current.currentTime);
    }
    animFrameRef.current = requestAnimationFrame(tick);
  }, [onTimeUpdate]);

  useEffect(() => {
    if (isPlaying) {
      animFrameRef.current = requestAnimationFrame(tick);
    }
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [isPlaying, tick]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  useEffect(() => {
    if (seekTo !== null && seekTo !== undefined && audioRef.current) {
      audioRef.current.currentTime = seekTo;
    }
  }, [seekTo]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current && onDurationChange) {
      onDurationChange(audioRef.current.duration);
    }
  };

  if (!audioUrl) {
    return (
      <div className="audio-player flex items-center gap-4 p-4 bg-zinc-800/50 rounded-xl border border-zinc-700/50">
        <label className="flex items-center gap-2 cursor-pointer text-zinc-400 hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
          </svg>
          <span className="text-sm font-medium">Upload un fichier audio pour lancer la synchronisation</span>
          <input
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                const url = URL.createObjectURL(file);
                const event = new CustomEvent("audio-upload", { detail: url });
                window.dispatchEvent(event);
              }
            }}
          />
        </label>
      </div>
    );
  }

  return (
    <div className="audio-player flex items-center gap-4 p-4 bg-zinc-800/50 rounded-xl border border-zinc-700/50">
      <audio ref={audioRef} src={audioUrl} onLoadedMetadata={handleLoadedMetadata} />

      <button
        onClick={togglePlay}
        className="w-12 h-12 rounded-full bg-amber-500 hover:bg-amber-400 text-black flex items-center justify-center transition-colors flex-shrink-0"
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

      <div className="flex items-center gap-3 flex-1">
        <svg className="w-4 h-4 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
        </svg>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
          className="flex-1 h-1 accent-amber-500"
        />
      </div>

      <label className="text-xs text-zinc-500 cursor-pointer hover:text-zinc-300 transition-colors">
        Changer
        <input
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              const url = URL.createObjectURL(file);
              const event = new CustomEvent("audio-upload", { detail: url });
              window.dispatchEvent(event);
            }
          }}
        />
      </label>
    </div>
  );
}
