"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { setCurrentTime } from "@/lib/playback-store";

interface YTPlayerInstance {
  loadVideoById: (id: string) => void;
  getDuration?: () => number;
  getCurrentTime?: () => number;
  seekTo?: (seconds: number, allowSeekAhead: boolean) => void;
  getPlayerState?: () => number;
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
  onStateChange?: (state: number) => void;
  onPlayStateChange?: (playing: boolean) => void;
  onPlaybackError?: (code: number) => void;
  seekTo?: number | null;
  playToggle?: number;
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
  onStateChange,
  onPlayStateChange,
  onPlaybackError,
  seekTo,
  playToggle,
}: YouTubePlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayerInstance | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

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
        setCurrentTime(playerRef.current.getCurrentTime());

        const duration = playerRef.current?.getDuration?.() ?? 0;
        if (duration > 0) {
          onDurationChange?.(duration);
        }
      }
    }, 100);
  }, [onDurationChange, stopTimer]);

  const togglePlay = useCallback(() => {
    if (!playerRef.current) return;
    const state = playerRef.current.getPlayerState?.();
    if (state === PLAYER_STATES.PLAYING) {
      playerRef.current.pauseVideo();
    } else {
      playerRef.current.playVideo();
    }
  }, []);

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
        height: "200",
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
            if (onDurationChange && playerRef.current?.getDuration) {
              onDurationChange(playerRef.current.getDuration());
            }
          },
          onStateChange: (event: { data: number }) => {
            const state = event.data;
            setIsPlaying(state === PLAYER_STATES.PLAYING);
            onStateChange?.(state);
            onPlayStateChange?.(state === PLAYER_STATES.PLAYING);

            if (state === PLAYER_STATES.PLAYING) {
              startTimer();
            } else {
              stopTimer();
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
      window.onYouTubeIframeAPIReady = () => {};
    };
  }, [videoId]);

  useEffect(() => {
    if (seekTo !== null && seekTo !== undefined && playerRef.current?.seekTo) {
      playerRef.current.seekTo(seekTo, true);
    }
  }, [seekTo]);

  useEffect(() => {
    if (playToggle !== undefined && playToggle > 0) {
      togglePlay();
    }
  }, [playToggle, togglePlay]);

  if (!videoId) {
    return null;
  }

  return (
    <div className="youtube-player rounded-xl overflow-hidden bg-black border border-zinc-700/50">
      <div ref={containerRef} className="w-full" />
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
          YouTube
        </div>
      </div>
    </div>
  );
}
