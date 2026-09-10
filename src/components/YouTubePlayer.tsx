"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.


import { useEffect, useRef, useCallback, useState } from "react";
import { setCurrentTime } from "@/lib/playback-store";

interface YTPlayerInstance {
  loadVideoById: (id: string) => void;
  getDuration?: () => number;
  getCurrentTime?: () => number;
  seekTo?: (seconds: number, allowSeekAhead: boolean) => void;
  getPlayerState?: () => number;
  setPlaybackRate?: (rate: number) => void;
  pauseVideo: () => void;
  playVideo: () => void;
  destroy: () => void;
}

interface YTPlayerOptions {
  videoId: string;
  width: string;
  height: string;
  playerVars: Record<string, unknown>;
  events: {
    onReady: () => void;
    onStateChange: (event: { data: number }) => void;
    onError: (event: { data: number }) => void;
  };
}

declare global {
  interface Window {
    YT: {
      Player: new (element: HTMLElement, options: YTPlayerOptions) => YTPlayerInstance;
    };
    onYouTubeIframeAPIReady: () => void;
  }
}

interface YouTubePlayerProps {
  videoId: string | null;
  onDurationChange?: (duration: number) => void;
  onRawDurationChange?: (rawDuration: number) => void;
  onStateChange?: (state: number) => void;
  onPlayStateChange?: (playing: boolean) => void;
  onPlaybackError?: (code: number) => void;
  onEnded?: () => void;
  seekTo?: number | null;
  playToggle?: number;
  tempoScale?: number;
  height?: number;
  fillHeight?: boolean;
  autoPlay?: boolean;
}

const PLAYER_STATES = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
};

export default function YouTubePlayer({
  videoId,
  onDurationChange,
  onRawDurationChange,
  onStateChange,
  onPlayStateChange,
  onPlaybackError,
  onEnded,
  seekTo,
  playToggle,
  tempoScale = 1,
  height = 200,
  fillHeight = false,
  autoPlay = false,
}: YouTubePlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayerInstance | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingToggleRef = useRef(false);
  const autoPlayRef = useRef(autoPlay);
  autoPlayRef.current = autoPlay;
  const autoPlayAttemptedRef = useRef(false);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  const stopTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();
    intervalRef.current = setInterval(() => {
      if (playerRef.current && playerRef.current.getCurrentTime) {
        setCurrentTime(playerRef.current.getCurrentTime() * tempoScale);

        const raw = playerRef.current?.getDuration?.() ?? 0;
        if (raw > 0) {
          onRawDurationChange?.(raw);
          onDurationChange?.(raw * tempoScale);
        }
      }
    }, 100);
  }, [onDurationChange, onRawDurationChange, stopTimer, tempoScale]);

  const togglePlay = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    if (!isReady) {
      pendingToggleRef.current = true;
      return;
    }
    const state = player.getPlayerState?.();
    if (state === PLAYER_STATES.PLAYING) {
      player.pauseVideo();
    } else {
      player.playVideo();
    }
  }, [isReady]);

  useEffect(() => {
    if (!document.getElementById("youtube-api-script")) {
      const tag = document.createElement("script");
      tag.id = "youtube-api-script";
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current || !videoId) return;

    const createPlayer = () => {
      if (!containerRef.current) return;

      playerRef.current = new window.YT.Player(containerRef.current, {
        videoId,
        width: "100%",
        height: fillHeight ? "100%" : String(height),
        playerVars: {
          autoplay: 0,
          controls: 1,
          rel: 0,
          fs: 1,
          iv_load_policy: 3,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            setIsReady(true);
            if (playerRef.current?.setPlaybackRate) {
              playerRef.current.setPlaybackRate(playbackRate);
            }
            if (pendingToggleRef.current) {
              pendingToggleRef.current = false;
              const state = playerRef.current?.getPlayerState?.();
              if (state === PLAYER_STATES.PLAYING) {
                playerRef.current?.pauseVideo();
              } else {
                playerRef.current?.playVideo();
              }
            } else if (autoPlayRef.current) {
              playerRef.current?.playVideo();
            }
            if (onDurationChange && playerRef.current?.getDuration) {
              onDurationChange(playerRef.current.getDuration() * tempoScale);
            }
            if (onRawDurationChange && playerRef.current?.getDuration) {
              onRawDurationChange(playerRef.current.getDuration());
            }
          },
          onStateChange: (event: { data: number }) => {
            const state = event.data;
            setIsPlaying(state === PLAYER_STATES.PLAYING);
            onStateChange?.(state);
            onPlayStateChange?.(state === PLAYER_STATES.PLAYING);

            if (state === PLAYER_STATES.PLAYING) {
              setAutoplayBlocked(false);
              startTimer();
            } else {
              stopTimer();
            }

            if (state === PLAYER_STATES.ENDED) {
              onEndedRef.current?.();
            }
          },
          onError: (event: { data: number }) => {
            onPlaybackError?.(event.data);
          },
        },
      });
    };

    if (window.YT && window.YT.Player) {
      createPlayer();
    } else {
      window.onYouTubeIframeAPIReady = createPlayer;
    }

    return () => {
      stopTimer();
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          // ignore failures while tearing down
        }
        playerRef.current = null;
      }
      setIsReady(false);
      pendingToggleRef.current = false;
      autoPlayAttemptedRef.current = false;
      window.onYouTubeIframeAPIReady = () => {};
    };
  }, [videoId]);

  useEffect(() => {
    if (seekTo !== null && seekTo !== undefined && playerRef.current?.seekTo) {
      playerRef.current.seekTo(seekTo / tempoScale, true);
    }
  }, [seekTo, tempoScale]);

  useEffect(() => {
    if (!autoPlay) return;
    if (autoPlayAttemptedRef.current) return;
    if (!isReady) return;
    autoPlayAttemptedRef.current = true;
    playerRef.current?.playVideo();
    const t = setTimeout(() => {
      if (playerRef.current?.getPlayerState?.() === PLAYER_STATES.PLAYING) return;
      setAutoplayBlocked(true);
    }, 1500);
    return () => clearTimeout(t);
  }, [autoPlay, isReady, videoId]);

  const playbackRate = 1 / tempoScale;
  useEffect(() => {
    if (playerRef.current?.setPlaybackRate) {
      playerRef.current.setPlaybackRate(playbackRate);
    }
  }, [playbackRate]);

  useEffect(() => {
    if (playToggle !== undefined && playToggle > 0) {
      togglePlay();
    }
  }, [playToggle, togglePlay]);

  if (!videoId) {
    return null;
  }

  return (
    <div
      className={`${
        fillHeight
          ? "h-full flex flex-col [&>iframe]:w-full [&>iframe]:flex-1 [&>iframe]:min-h-0"
          : ""
      } youtube-player rounded-xl overflow-hidden bg-black border border-zinc-700/50`}
    >
      <div ref={containerRef} />
      <div className="flex items-center gap-3 p-3 bg-zinc-800/80">
        <button
          onClick={togglePlay}
          className="w-10 h-10 rounded-full bg-amber-500 hover:bg-amber-400 text-black flex items-center justify-center transition-colors flex-shrink-0"
        >
          {isPlaying ? (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
        <div className="flex-1 text-sm text-zinc-400">
          {autoplayBlocked ? (
            <span className="text-amber-300">
              Lecture auto bloquée par le navigateur — appuyez sur Lecture
            </span>
          ) : (
            "YouTube"
          )}
        </div>
      </div>
    </div>
  );
}
