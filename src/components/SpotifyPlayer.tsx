"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { setCurrentTime } from "@/lib/playback-store";
import {
  authorize,
  clearToken,
  extractSpotifyUri,
  getValidToken,
  isLoggedIn,
} from "@/lib/spotify-auth";

declare global {
  interface Window {
    Spotify?: {
      Player: new (
        options: Record<string, unknown>
      ) => SpotifyPlayerInstance;
    };
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

interface SpotifyPlayerInstance {
  connect: () => Promise<boolean>;
  disconnect: () => void;
  activateElement: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  seek: (positionMs: number) => Promise<void>;
  getCurrentState: () => Promise<SpotifyPlaybackState | null>;
  addListener: (event: string, cb: (state?: unknown) => void) => void;
}

interface SpotifyPlaybackState {
  paused: boolean;
  position_ms: number;
  duration_ms: number;
  track_window?: {
    current_track?: {
      uri: string;
      name: string;
      artists: { name: string }[];
    };
  };
}

interface SpotifyPlayerProps {
  trackUrl: string;
  onDurationChange?: (duration: number) => void;
  onPlayStateChange?: (playing: boolean) => void;
  onPlaybackError?: (message: string) => void;
  seekTo?: number | null;
  playToggle?: number;
}

const SDK_SCRIPT_ID = "spotify-playback-sdk";

function ensureSdkScript(onError?: () => void): void {
  if (document.getElementById(SDK_SCRIPT_ID)) return;
  const tag = document.createElement("script");
  tag.id = SDK_SCRIPT_ID;
  tag.src = "https://sdk.scdn.co/spotify-player.js";
  tag.async = true;
  tag.onerror = () => onError?.();
  document.head.appendChild(tag);
}

export default function SpotifyPlayer({
  trackUrl,
  onDurationChange,
  onPlayStateChange,
  onPlaybackError,
  seekTo,
  playToggle,
}: SpotifyPlayerProps) {
  const parsed = useMemo(() => extractSpotifyUri(trackUrl), [trackUrl]);
  const trackUri = parsed
    ? `spotify:${parsed.type}:${parsed.id}`
    : null;

  const [loggedIn, setLoggedIn] = useState(false);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [trackName, setTrackName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const playerRef = useRef<SpotifyPlayerInstance | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  const playedUriRef = useRef<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackErrorRef = useRef(onPlaybackError);
  const durationRef = useRef(onDurationChange);
  const playStateRef = useRef(onPlayStateChange);
  playbackErrorRef.current = onPlaybackError;
  durationRef.current = onDurationChange;
  playStateRef.current = onPlayStateChange;

  const reportError = useCallback((code: string) => {
    playbackErrorRef.current?.(code);
  }, []);

  const reportPlaying = useCallback((p: boolean) => {
    setPlaying(p);
    playStateRef.current?.(p);
  }, []);

  const stopTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();
    intervalRef.current = setInterval(async () => {
      if (!playerRef.current) return;
      try {
        const state = await playerRef.current.getCurrentState();
        if (!state) return;
        setCurrentTime(state.position_ms / 1000);
        const duration = state.duration_ms / 1000;
        if (duration > 0) durationRef.current?.(duration);
      } catch {
        // ignorer, prochaine itération
      }
    }, 250);
  }, [stopTimer]);

  useEffect(() => {
    setLoggedIn(isLoggedIn());
  }, []);

  useEffect(() => {
    if (!loggedIn) return;
    let disposed = false;

    ensureSdkScript(() => {
      if (!disposed) {
        setError("Impossible de charger le SDK Spotify (réseau ou bloqueur ?).");
        reportError("spotify-sdk-load-failed");
      }
    });

    const createPlayer = () => {
      if (disposed) return;
      const player = new window.Spotify!.Player({
        name: "ChordFlow",
        getOAuthToken: async (cb: (token: string) => void) => {
          const token = await getValidToken();
          cb(token ?? "");
        },
        volume: 0.7,
      });
      playerRef.current = player;

      const sdkErrors: Array<[string, string]> = [
        ["initialization_error", "Erreur d'initialisation du SDK"],
        ["authentication_error", "Erreur d'authentification (jeton invalide ou scopes)"],
        ["account_error", "Compte Spotify sans abonnement Premium"],
        ["playback_error", "Erreur de lecture Spotify"],
      ];
      for (const [evt, label] of sdkErrors) {
        player.addListener(evt, (d) => {
          if (disposed) return;
          const msg = (d as { message?: string })?.message ?? "";
          console.error(`Spotify SDK ${evt}:`, msg || "(aucun message)");
          setError(`${label}${msg ? ` : ${msg}` : ""}.`);
          reportError(`spotify-sdk-${evt}`);
        });
      }

      player.addListener("ready", (data) => {
        if (disposed) return;
        deviceIdRef.current = (data as { device_id: string }).device_id;
        setError(null);
        setReady(true);
        if (watchdogRef.current) clearTimeout(watchdogRef.current);
      });

      player.addListener("player_state_changed", (data) => {
        if (disposed) return;
        const state = data as unknown as SpotifyPlaybackState | null;
        if (!state) return;
        const track = state.track_window?.current_track;
        if (track) setTrackName(track.name);
        const isPlaying = !state.paused;
        reportPlaying(isPlaying);
        if (isPlaying) {
          startTimer();
        } else {
          stopTimer();
        }
      });

      player.addListener("not_ready", () => {
        if (disposed) return;
        deviceIdRef.current = null;
        setReady(false);
      });

      player.connect().catch(() => {
        if (!disposed) {
          setError("Impossible de connecter le lecteur Spotify.");
          reportError("spotify-connect-failed");
        }
      });
    };

    if (window.Spotify) {
      createPlayer();
    } else {
      window.onSpotifyWebPlaybackSDKReady = createPlayer;
    }

    watchdogRef.current = setTimeout(() => {
      if (!disposed && !deviceIdRef.current) {
        setError("Le lecteur ne se connecte pas (WebSocket Spotify bloqué ?). Réessayez.");
        reportError("spotify-connect-timeout");
      }
    }, 20_000);

    return () => {
      disposed = true;
      stopTimer();
      if (watchdogRef.current) clearTimeout(watchdogRef.current);
      if (playerRef.current) {
        try {
          playerRef.current.disconnect();
        } catch {
          // ignorer pendant le démontage
        }
        playerRef.current = null;
      }
      window.onSpotifyWebPlaybackSDKReady = undefined;
    };
  }, [loggedIn, reportError, startTimer, stopTimer]);

  const startPlayback = useCallback(
    async (uri: string, url: string): Promise<boolean> => {
      const player = playerRef.current;
      const deviceId = deviceIdRef.current;
      if (!player || !deviceId) return false;

      try {
        await player.activateElement();
      } catch {
        // l'activation peut échouer en mode automatique, on continue
      }

      const token = await getValidToken();
      if (!token) {
        setLoggedIn(false);
        return false;
      }
      const parsedUri = extractSpotifyUri(url);
      const body =
        parsedUri?.type === "track"
          ? JSON.stringify({ uris: [uri] })
          : JSON.stringify({
              context_uri: uri,
              offset: { position: 0 },
            });
      const headers = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      };

      const transfer = async () =>
        fetch(`https://api.spotify.com/v1/me/player`, {
          method: "PUT",
          headers,
          body: JSON.stringify({ device_ids: [deviceId], play: false }),
        });

      const play = async () =>
        fetch(
          `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`,
          { method: "PUT", headers, body }
        );

      let t = await transfer().catch(() => null);
      if (t && !t.ok && t.status !== 404) {
        const text = await t.text();
        if (t.status === 401 || t.status === 403) {
          setLoggedIn(false);
          return false;
        }
        reportError(`spotify-transfer-${t.status}:${text.slice(0, 120)}`);
      }

      await new Promise((r) => setTimeout(r, 500));

      let res = await play().catch(() => null);
      if ((!res || !(res.ok || res.status === 204)) && deviceIdRef.current) {
        await new Promise((r) => setTimeout(r, 1000));
        res = await play().catch(() => null);
      }
      if (!res) {
        reportError("spotify-play-network");
        return false;
      }
      if (res.ok || res.status === 204) {
        playedUriRef.current = uri;
        return true;
      }
      if (res.status === 401 || res.status === 403) {
        setLoggedIn(false);
      } else {
        const text = await res.text();
        reportError(`spotify-play-${res.status}:${text.slice(0, 120)}`);
      }
      return false;
    },
    [reportError]
  );

  useEffect(() => {
    if (!trackUri) return;
    if (playedUriRef.current === trackUri) return;
    if (!deviceIdRef.current) return;
    startPlayback(trackUri, trackUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackUri, trackUrl, ready, startPlayback]);

  useEffect(() => {
    if (seekTo === null || seekTo === undefined) return;
    playerRef.current?.seek(seekTo * 1000).catch(() => {});
  }, [seekTo]);

  const togglePlay = useCallback(async () => {
    const player = playerRef.current;
    if (!player) return;
    const state = await player.getCurrentState().catch(() => null);
    if (state && state.paused) {
      await player.resume().catch(() => {});
    } else if (state && !state.paused) {
      await player.pause().catch(() => {});
    } else if (deviceIdRef.current) {
      startPlayback(trackUri ?? "", trackUrl);
    }
  }, [startPlayback, trackUri, trackUrl]);

  useEffect(() => {
    if (playToggle !== undefined && playToggle > 0) {
      togglePlay();
    }
  }, [playToggle, togglePlay]);

  const handleLogin = () => {
    clearToken();
    authorize(window.location.pathname);
  };

  if (!trackUri) {
    return (
      <div className="p-4 bg-zinc-800/50 rounded-xl border border-zinc-700/50 text-center text-zinc-500 text-sm">
        URL Spotify invalide
      </div>
    );
  }

  return (
    <div className="rounded-xl overflow-hidden border border-zinc-700/50 bg-zinc-800/80">
      <div className="flex items-center gap-3 p-3">
        <button
          onClick={() => {
            if (loggedIn) {
              togglePlay();
            } else {
              handleLogin();
            }
          }}
          className="w-10 h-10 rounded-full bg-green-500 hover:bg-green-400 text-black flex items-center justify-center transition-colors flex-shrink-0"
          title={loggedIn ? (playing ? "Pause" : "Lecture") : "Connecter Spotify"}
        >
          {loggedIn && playing ? (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
            </svg>
          ) : (
            <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">
            {trackName ?? "Spotify"}
          </p>
          <p className="text-xs text-zinc-500">
            {loggedIn
              ? ready
                ? "Lecteur connecté"
                : "Connexion au lecteur..."
              : "Compte Spotify non connecté"}
          </p>
        </div>
        {loggedIn && (
          <button
            onClick={() => {
              clearToken();
              setLoggedIn(false);
              setReady(false);
              setTrackName(null);
            }}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-1"
            title="Déconnecter Spotify"
          >
            Déconnecter
          </button>
        )}
      </div>

      {!loggedIn && (
        <button
          onClick={handleLogin}
          className="w-full flex items-center justify-center gap-2 p-3 bg-green-600 hover:bg-green-500 text-white text-sm font-medium transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
          </svg>
          Connecter mon compte Spotify
        </button>
      )}

      {error && (
        <p className="px-3 pb-3 text-xs text-red-400">{error}</p>
      )}
    </div>
  );
}