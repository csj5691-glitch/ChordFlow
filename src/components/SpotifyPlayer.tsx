"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { useEffect, useMemo, useRef, useState, useCallback, useSyncExternalStore } from "react";
import {
  setCurrentTime,
  subscribeCurrentTime,
  getCurrentTime,
} from "@/lib/playback-store";
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
    __SPOTIFY_DIAG?: boolean;
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

  const currentPos = useSyncExternalStore(subscribeCurrentTime, getCurrentTime);
  const [loggedIn, setLoggedIn] = useState(false);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [trackName, setTrackName] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  const playerRef = useRef<SpotifyPlayerInstance | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  const playedUriRef = useRef<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readyQueueRef = useRef<Array<(deviceId: string) => void>>([]);
  const playbackErrorRef = useRef(onPlaybackError);
  const durationRef = useRef(onDurationChange);
  const durationStateRef = useRef(0);
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

  const pollPosition = useCallback(async () => {
    const player = playerRef.current;
    if (!player) return;
    try {
      const state = await player.getCurrentState();
      if (!state) return;
      const rawPos = state.position_ms;
      const rawDur = state.duration_ms;
      if (window.__SPOTIFY_DIAG && (isNaN(rawPos) || !isFinite(rawPos) || !isFinite(rawDur) || rawDur === 0)) {
        console.log("[getCurrentState raw]", {
          position_ms: rawPos,
          duration_ms: rawDur,
          paused: state.paused,
          hasTrack: !!state.track_window?.current_track,
        });
      }
      const newDuration = rawDur / 1000;
      if (isFinite(newDuration) && newDuration > 0 && newDuration !== durationStateRef.current) {
        durationStateRef.current = newDuration;
        setDuration(newDuration);
      }
      durationRef.current?.(newDuration);
      const posMs = rawPos;
      if (isFinite(posMs)) {
        setCurrentTime(posMs / 1000);
      }
      reportPlaying(!state.paused);
    } catch {
      // ignorer, prochaine itération
    }
  }, [reportPlaying]);

  const startTimer = useCallback(() => {
    stopTimer();
    intervalRef.current = setInterval(pollPosition, 250);
  }, [pollPosition, stopTimer]);

  const waitDevice = useCallback((): Promise<string> =>
    new Promise((resolve) => {
      const dev = deviceIdRef.current;
      if (dev) {
        resolve(dev);
        return;
      }
      readyQueueRef.current.push(resolve);
    }), []);

  const buildPlayer = useCallback(() => {
    const player = new window.Spotify!.Player({
      name: "ChordFlow",
      getOAuthToken: async (cb: (token: string) => void) => {
        try {
          const token = await getValidToken();
          if (!token) {
            console.warn("SDK : aucun jeton valide (expiré/non rafraîchissable)");
            setLoggedIn(false);
            reportError("spotify-auth-token-manquant");
          } else {
            console.log("SDK : jeton fourni");
          }
          cb(token ?? "");
        } catch (err) {
          console.error("getOAuthToken a échoué (le SDK restait sans jeton) :", err);
          reportError("spotify-auth-token-erreur");
          cb("");
        }
      },
      volume: 0.7,
    });

    const sdkErrors: Array<[string, string]> = [
      ["initialization_error", "Erreur d'initialisation du SDK"],
      ["authentication_error", "Erreur d'authentification (jeton invalide ou scopes)"],
      ["account_error", "Compte Spotify sans abonnement Premium"],
      ["playback_error", "Erreur de lecture Spotify"],
    ];
    for (const [evt, label] of sdkErrors) {
      player.addListener(evt, (d) => {
        const msg = (d as { message?: string })?.message ?? "";
        console.error(`Spotify SDK ${evt}:`, msg || "(aucun message)");
        setError(`${label}${msg ? ` : ${msg}` : ""}.`);
        reportError(`spotify-sdk-${evt}`);
      });
    }

    player.addListener("ready", (data) => {
      const dev = (data as { device_id: string }).device_id;
      deviceIdRef.current = dev;
      console.log("Spotify ready → device_id:", dev);
      setError(null);
      setReady(true);
      startTimer();
      if (watchdogRef.current) clearTimeout(watchdogRef.current);
      const q = readyQueueRef.current;
      readyQueueRef.current = [];
      for (const resolve of q) resolve(dev);
    });

    player.addListener("player_state_changed", (data) => {
      const state = data as unknown as SpotifyPlaybackState | null;
      if (!state) return;
      const track = state.track_window?.current_track;
      if (track) setTrackName(track.name);
      reportPlaying(!state.paused);
    });

    player.addListener("not_ready", () => {
      console.warn("Spotify not_ready (périphérique indisponible)");
      deviceIdRef.current = null;
      setReady(false);
    });

    return player;
  }, [reportError, reportPlaying, startTimer, stopTimer]);

  useEffect(() => {
    setLoggedIn(isLoggedIn());
  }, []);

  useEffect(() => {
    if (!loggedIn) return;
    let disposed = false;
    let retries = 0;
    const MAX_RETRIES = 3;

    ensureSdkScript(() => {
      if (!disposed) {
        setError("Impossible de charger le SDK Spotify (réseau ou bloqueur ?).");
        reportError("spotify-sdk-load-failed");
      }
    });

    const attemptConnect = () => {
      if (disposed) return;
      const player = buildPlayer();
      playerRef.current = player;
      player
        .connect()
        .then((ok) => {
          if (!disposed) console.log("Spotify connect() →", ok);
        })
        .catch(() => {
          if (disposed) return;
          if (retries < MAX_RETRIES) {
            retries += 1;
            setTimeout(attemptConnect, 1500);
          } else {
            setError("Impossible de connecter le lecteur Spotify.");
            reportError("spotify-connect-failed");
          }
        });

      watchdogRef.current = setTimeout(() => {
        if (disposed || deviceIdRef.current) return;
        if (retries < MAX_RETRIES) {
          retries += 1;
          console.warn(`Spotify : périphérique non prêt, tentative ${retries}/${MAX_RETRIES}`);
          try {
            playerRef.current?.disconnect();
          } catch {
            // ignorer
          }
          playerRef.current = null;
          attemptConnect();
        } else {
          setError(
            "Le lecteur ne se connecte pas (WebSocket Spotify bloqué ?). Vérifiez votre réseau, désactivez les bloqueurs, puis réessayez."
          );
          reportError("spotify-connect-timeout");
        }
      }, 12_000);
    };

    if (window.Spotify) {
      attemptConnect();
    } else {
      window.onSpotifyWebPlaybackSDKReady = attemptConnect;
    }

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
  }, [loggedIn, buildPlayer, retry, reportError, stopTimer]);

  const startPlayback = useCallback(
    async (uri: string, url: string): Promise<boolean> => {
      console.log("[ChordFlow] startPlayback appelé uri =", uri);
      const token = await getValidToken();
      if (!token) {
        setLoggedIn(false);
        return false;
      }
      const parsedUri = extractSpotifyUri(url);
      const sleep = (ms: number) =>
        new Promise((r) => setTimeout(r, ms));

      // Lecture via le relais serveur (les fetch browser directs vers
      // api.spotify.com sont bloqués par les extensions sur certaines
      // machines ; le relais passe, comme pour la recherche).
      const play = async (deviceId: string) => {
        console.log("[ChordFlow] appel relais /api/spotify-play device =", deviceId);
        try {
          const res = await fetch("/api/spotify-play", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token, deviceId, uri, parsedUri }),
          });
          if (res.ok) {
            console.log("[ChordFlow] relais → OK");
            return null;
          }
          let status = res.status;
          try {
            const data = await res.json();
            if (data && typeof data.status === "number") status = data.status;
          } catch {
            // ignorer
          }
          console.log("[ChordFlow] relais → échec status =", status);
          return { status };
        } catch {
          console.warn("[ChordFlow] relais → exception réseau");
          return { status: -1 };
        }
      };

      for (let attempt = 0; attempt < 3; attempt++) {
        let deviceId = deviceIdRef.current;

        if (!deviceId) {
          const player = playerRef.current;
          if (!player) {
            reportError("spotify-no-player");
            return false;
          }
          let ok = false;
          try {
            ok = await player.connect();
          } catch {
            // continue, waitDevice gérera
          }
          if (ok) {
            deviceId = await waitDevice();
          }
          if (!deviceId) {
            await sleep(1000);
            continue;
          }
        }

        try {
          await playerRef.current?.activateElement();
        } catch {
          // continuer
        }

        await sleep(300);

        const err = await play(deviceId);
        if (!err) {
          playedUriRef.current = uri;
          return true;
        }
        if (err.status === 401 || err.status === 403) {
          setLoggedIn(false);
          return false;
        }
        if (err.status === 404) {
          await sleep(1500);
          continue;
        }
        if (err.status > 0) {
          reportError(`spotify-play-server:${err.status}`);
        } else {
          reportError("spotify-play-network");
        }
        return false;
      }

      reportError("spotify-play-404:périphérique non prêt après 3 tentatives");
      return false;
    },
    [reportError, waitDevice]
  );

  useEffect(() => {
    if (!trackUri) return;
    if (playedUriRef.current === trackUri) return;
    if (!deviceIdRef.current) return;
    startPlayback(trackUri, trackUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackUri, trackUrl, ready, startPlayback]);

  useEffect(() => {
    if (!parsed || parsed.type !== "track") return;
    const id = parsed.id;
    let cancelled = false;
    (async () => {
      try {
        const token = await getValidToken();
        if (!token || cancelled) return;
        const res = await fetch("/api/spotify-track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, id }),
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const ms = data?.duration_ms;
        if (isFinite(ms) && ms > 0 && ms !== durationStateRef.current) {
          durationStateRef.current = ms / 1000;
          setDuration(ms / 1000);
          durationRef.current?.(ms / 1000);
          console.log("Durée Spotify (API) →", ms / 1000, "s");
        }
      } catch {
        // le SDK finira par donner la durée, sinon ignorer
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed]);

  useEffect(() => {
    if (seekTo === null || seekTo === undefined) return;
    playerRef.current?.seek(seekTo * 1000).catch(() => {});
  }, [seekTo]);

  const togglePlay = useCallback(async () => {
    const player = playerRef.current;
    if (!trackUri || !player) return;
    const state = await player.getCurrentState().catch(() => null);

    if (state && !state.paused && (state.position_ms ?? 0) > 0) {
      console.log("[ChordFlow] togglePlay → pause (lecture réelle)");
      await player.pause().catch(() => {});
      return;
    }

    if (state && state.paused && state.track_window?.current_track) {
      console.log("[ChordFlow] togglePlay → resume (piste en pause)");
      await player.resume().catch(() => {});
      return;
    }

    console.log("[ChordFlow] togglePlay → démarrage via relais serveur");
    await startPlayback(trackUri, trackUrl);
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

  const handleSeekBar = (e: React.MouseEvent<HTMLDivElement>) => {
    const width = e.currentTarget.clientWidth;
    if (width <= 0) return;
    const ratio = Math.min(1, Math.max(0, (e.clientX - e.currentTarget.getBoundingClientRect().left) / width));
    const target = ratio * (durationStateRef.current || 0);
    setCurrentTime(target);
    playerRef.current?.seek(target * 1000).catch(() => {});
  };

  const fmtTime = (s: number): string => {
    if (!isFinite(s) || s < 0) s = 0;
    const total = Math.floor(s);
    const m = Math.floor(total / 60);
    const sec = total % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const posZeroWarnedRef = useRef(false);

  useEffect(() => {
    if (!ready) {
      posZeroWarnedRef.current = false;
      return;
    }
    if (posZeroWarnedRef.current) return;
    const t = setTimeout(() => {
      if (posZeroWarnedRef.current) return;
      if (getCurrentTime() === 0 && !document.hidden) {
        posZeroWarnedRef.current = true;
        console.warn(
          "⚠️ Aucune position de lecture : le device Web SDK n'obtient pas de flux audio. " +
            "C'est presque toujours une extension (Stands/AdBlock) ou un pare-feu qui bloque le " +
            "WebSocket vers Spotify. Testez avec les extensions désactivées."
        );
      }
    }, 5_000);
    return () => clearTimeout(t);
  }, [ready]);

  if (!trackUri) {
    return (
      <div className="p-4 bg-zinc-800/50 rounded-xl border border-zinc-700/50 text-center text-zinc-500 text-sm">
        URL Spotify invalide
      </div>
    );
  }

  useEffect(() => {
    console.log(
      "[SpotifyPlayer diag] ready =",
      ready,
      "| duration =",
      duration,
      "| pos =",
      currentPos.toFixed(1),
      "| playing =",
      playing,
      "| device =",
      deviceIdRef.current ? "oui" : "non"
    );
  });

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

      {ready && duration > 0 && (
        <div className="px-3 pb-2">
          <div
            onClick={handleSeekBar}
            className="h-1.5 rounded-full bg-zinc-700 cursor-pointer overflow-hidden"
            title="Cliquer pour avancer / reculer"
          >
            <div
              className="h-full bg-green-500 rounded-full"
              style={{
                width: `${
                  isFinite(duration) && isFinite(currentPos) && duration > 0
                    ? Math.min(100, (currentPos / duration) * 100)
                    : 0
                }%`,
              }}
            />
          </div>
          <div className="mt-1 flex items-center justify-between text-xs font-mono text-zinc-400">
            <span>{fmtTime(currentPos)}</span>
            <span className="text-zinc-500">
              -{fmtTime(duration - currentPos)}
            </span>
          </div>
        </div>
      )}

      {error && (
        <div className="px-3 pb-3 flex items-center justify-between gap-2">
          <p className="text-xs text-red-400 flex-1">{error}</p>
          <button
            onClick={() => {
              setError(null);
              setRetry((r) => r + 1);
            }}
            className="text-xs px-2 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors flex-shrink-0"
          >
            Réessayer
          </button>
        </div>
      )}
    </div>
  );
}