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
import {
  ensureSpotifyPlayer,
  getSpotifyDeviceId,
  getSpotifyPlayerInstance,
  subscribeSpotifyPlayer,
  type SpotifyPlaybackState,
  type SpotifyPlayerInstance,
} from "@/lib/spotify-player-singleton";

declare global {
  interface Window {
    __SPOTIFY_DIAG?: boolean;
  }
}

// Mode "suivi" : quand on a confié toute la file au device (queueUris),
// c'est lui qui avance nativement entre les pages. Ce jeton module garde
// le morceau actuellement joué par le device afin de ne JAMAIS relancer
// startPlayback() (retour à 0) après une navigation de suivi.
let lastFollowedUri: string | null = null;

// Marqueur de version pour vérifier en console que le bundle récent est
// bien celui exécuté (sinon les tests portent sur du code obsolète).
if (typeof window !== "undefined") {
  (window as typeof window & { __CHORDFLOW_VER?: number }).__CHORDFLOW_VER = 5;
}

interface SpotifyPlayerProps {
  trackUrl: string;
  onDurationChange?: (duration: number) => void;
  onPlayStateChange?: (playing: boolean) => void;
  onPlaybackError?: (message: string) => void;
  onEnded?: () => void;
  seekTo?: number | null;
  playToggle?: number;
  autoPlay?: boolean;
  queueUris?: string[];
  onDeviceTrack?: (uri: string) => void;
}

export default function SpotifyPlayer({
  trackUrl,
  onDurationChange,
  onPlayStateChange,
  onPlaybackError,
  onEnded = () => {},
  seekTo,
  playToggle,
  autoPlay = false,
  queueUris,
  onDeviceTrack,
}: SpotifyPlayerProps) {
  const parsed = useMemo(() => extractSpotifyUri(trackUrl), [trackUrl]);
  const trackUri = parsed
    ? `spotify:${parsed.type}:${parsed.id}`
    : null;

  const currentPos = useSyncExternalStore(subscribeCurrentTime, getCurrentTime, getCurrentTime);
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
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playbackStartedRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playbackErrorRef = useRef(onPlaybackError);
  const durationRef = useRef(onDurationChange);
  const durationStateRef = useRef(0);
  const clockPosRef = useRef(0);
  const clockRunAtRef = useRef(0);
  const clockRunningRef = useRef(false);
  const playStateRef = useRef(onPlayStateChange);
  const endedFiredRef = useRef(false);
  const endedRef = useRef(onEnded);
  const queueUrisRef = useRef(queueUris);
  const deviceTrackRef = useRef(onDeviceTrack);
  playbackErrorRef.current = onPlaybackError;
  durationRef.current = onDurationChange;
  playStateRef.current = onPlayStateChange;
  endedRef.current = onEnded;
  queueUrisRef.current = queueUris;
  deviceTrackRef.current = onDeviceTrack;

  const reportError = useCallback((code: string) => {
    playbackErrorRef.current?.(code);
  }, []);

  const reportPlaying = useCallback((p: boolean) => {
    const wasRunning = clockRunningRef.current;
    const now = Date.now();
    if (p) {
      if (!wasRunning) {
        clockPosRef.current = getCurrentTime();
        clockRunAtRef.current = now;
        clockRunningRef.current = true;
      }
    } else {
      if (wasRunning) {
        const elapsed = (now - clockRunAtRef.current) / 1000;
        clockPosRef.current = isFinite(elapsed)
          ? clockPosRef.current + elapsed
          : clockPosRef.current;
        clockRunningRef.current = false;
        setCurrentTime(clockPosRef.current);
      }
    }
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
    let player = playerRef.current;
    if (!player) {
      player = getSpotifyPlayerInstance();
      if (player) playerRef.current = player;
    }
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
      if (isFinite(posMs) && posMs > 0) {
        clockPosRef.current = posMs / 1000;
        clockRunAtRef.current = Date.now();
        setCurrentTime(posMs / 1000);
      } else if (clockRunningRef.current && !state.paused) {
        const est =
          clockPosRef.current + (Date.now() - clockRunAtRef.current) / 1000;
        const cap = durationStateRef.current;
        const clamped = isFinite(cap) && cap > 0 && est > cap ? cap : est;
        if (isFinite(clamped) && clamped >= 0) setCurrentTime(clamped);
      }

      // Fin de piste : les événements player_state_changed du SDK arrivent
      // souvent sans position_ms/duration_ms (→ undefined), donc la
      // détection "position >= durée - 3 s" est insuffisante. On la
      // complète avec notre horloge : si on jouait et qu'on a atteint la
      // durée connue (SDK ou API), la piste est terminée.
      if (
        clockRunningRef.current &&
        durationStateRef.current > 0 &&
        getCurrentTime() >= durationStateRef.current - 3 &&
        !endedFiredRef.current
      ) {
        endedFiredRef.current = true;
        console.log("[ChordFlow] fin de piste détectée (poll) →", trackUri);
        endedRef.current?.();
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

  useEffect(() => {
    setLoggedIn(isLoggedIn());
  }, []);

  useEffect(() => {
    if (!loggedIn) return;
    let cancelled = false;

    ensureSpotifyPlayer()
      .then(() => {
        if (cancelled) return;
        playerRef.current = getSpotifyPlayerInstance();
      })
      .catch((e) => {
        if (cancelled) return;
        const cause = (e as { cause?: string })?.cause;
        if (cause === "timeout") {
          setError(
            "Le lecteur ne se connecte pas (WebSocket Spotify bloqué ?). Vérifiez votre réseau, désactivez les bloqueurs, puis réessayez."
          );
          reportError("spotify-connect-timeout");
        } else {
          setError(
            (e as Error)?.message ??
              "Impossible de charger le SDK Spotify (réseau ou bloqueur ?)."
          );
          reportError("spotify-sdk-load-failed");
        }
      });

    playerRef.current = getSpotifyPlayerInstance();
    const unsub = subscribeSpotifyPlayer({
      onReady: (dev) => {
        deviceIdRef.current = dev;
        setReady(true);
        setError(null);
        startTimer();
      },
      onState: (data) => {
        const state = (data ?? null) as SpotifyPlaybackState | null;
        if (!state) {
          console.log("[ChordFlow] player_state_changed → null (aucun état)");
          return;
        }
        const track = state.track_window?.current_track;
        console.log(
          "[ChordFlow] state →",
          JSON.stringify({
            pos: state.position_ms,
            dur: state.duration_ms,
            paused: state.paused,
            piste: track?.name ?? null,
            uri: track?.uri ?? null,
          })
        );
        if (track) setTrackName(track.name);
        // Suivi du périphérique : quand on lui a confié TOUTE la file
        // (queueUris), c'est lui qui avance nativement. On suit son morceau
        // réel au lieu de forcer chaque lecture.
        const sdkUri = track?.uri ?? null;
        const followerQueue = queueUrisRef.current;
        if (
          !state.paused &&
          followerQueue &&
          followerQueue.length > 0 &&
          sdkUri &&
          followerQueue.includes(sdkUri) &&
          sdkUri !== playedUriRef.current
        ) {
          console.log(
            "[ChordFlow] device a avancé dans notre file (suivi) →",
            sdkUri,
            track?.name ?? ""
          );
          playedUriRef.current = sdkUri;
          playbackStartedRef.current = true;
          endedFiredRef.current = true;
          clockPosRef.current = 0;
          clockRunAtRef.current = Date.now();
          clockRunningRef.current = true;
          setCurrentTime(0);
          lastFollowedUri = sdkUri;
          deviceTrackRef.current?.(sdkUri);
          return;
        }
        reportPlaying(!state.paused);

        if (!state.paused && !playbackStartedRef.current) {
          playbackStartedRef.current = true;
          if (reloadTimerRef.current) {
            clearTimeout(reloadTimerRef.current);
            reloadTimerRef.current = null;
          }
        }

        const dur = state.duration_ms ?? 0;
        if (!state.paused && dur > 60_000) {
          endedFiredRef.current = false;
        }
        if (
          state.paused &&
          dur > 0 &&
          state.position_ms >= dur - 3_000 &&
          !endedFiredRef.current
        ) {
          endedFiredRef.current = true;
          endedRef.current?.();
        }
      },
      onNotReady: () => {
        setReady(false);
        deviceIdRef.current = null;
      },
      onSdkError: (_key, label, msg) => {
        setError(`${label}${msg ? ` : ${msg}` : ""}.`);
        reportError(`spotify-sdk-${_key}`);
      },
      onAuthError: (code) => {
        setLoggedIn(false);
        reportError(code);
      },
    });

    return () => {
      cancelled = true;
      unsub();
      stopTimer();
    };
  }, [loggedIn, retry, reportError, reportPlaying, startTimer, stopTimer]);

  const startPlayback = useCallback(
    async (uri: string, url: string, queue?: string[]): Promise<boolean> => {
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
            body: JSON.stringify({
              token,
              deviceId,
              uri,
              parsedUri,
              uris: queue && queue.length > 0 ? queue : undefined,
            }),
          });
          if (res.ok) {
            console.log("[ChordFlow] relais → OK");
            return null;
          }
          let status = res.status;
          let error = "";
          try {
            const data = await res.json();
            if (data && typeof data.status === "number") status = data.status;
            if (data && typeof data.error === "string") error = data.error;
          } catch {
            // ignorer
          }
          console.log(
            "[ChordFlow] relais → échec status =",
            status,
            error ? `-> ${error.slice(0, 160)}` : ""
          );
          return { status, error };
        } catch {
          console.warn("[ChordFlow] relais → exception réseau");
          return { status: -1, error: "" };
        }
      };

      let last404Context = "";
      for (let attempt = 0; attempt < 15; attempt++) {
        let deviceId = deviceIdRef.current;

        if (!deviceId) {
          try {
            const inst = await ensureSpotifyPlayer();
            if (inst) playerRef.current = inst;
          } catch {
            // la connexion continue, poll ci-dessous la laisse finir
          }
          deviceId = getSpotifyDeviceId() ?? deviceIdRef.current;
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
          // Le device Web SDK reprend souvent son DERNIER contexte après
          // reconnexion, en écrasant le morceau qu'on vient d'envoyer.
          // On vérifie ce qu'il joue réellement et on rejoue le nôtre.
          await sleep(1500);
          try {
            const current = await getSpotifyPlayerInstance()?.getCurrentState();
            const sdkUri = current?.track_window?.current_track?.uri;
            if (sdkUri && sdkUri !== uri) {
              console.warn(
                "[ChordFlow] le device a repris un autre contexte (",
                sdkUri,
                ") → rejeu de",
                uri
              );
              const err2 = await play(deviceId);
              if (err2) console.warn("[ChordFlow] rejeu échoué", err2.status);
            }
          } catch {
            // état indisponible → on garde la première tentative
          }
          clockPosRef.current = 0;
          clockRunAtRef.current = Date.now();
          clockRunningRef.current = true;
          setCurrentTime(0);
          playedUriRef.current = uri;
          endedFiredRef.current = false;
          return true;
        }
        if (err.status === 401 || err.status === 403) {
          setLoggedIn(false);
          return false;
        }
        if (err.status === 404) {
          last404Context = err.error || "";
          console.warn(
            "[ChordFlow] relais 404 → périphérique pas encore enregistré, nouvelle tentative",
            last404Context
          );
          await sleep(2500);
          continue;
        }
        if (err.status > 0) {
          reportError(`spotify-play-server:${err.status}`);
        } else {
          reportError("spotify-play-network");
        }
        return false;
      }

      const reason = last404Context
        ? `:${last404Context.replace(/\s+/g, " ").slice(0, 120)}`
        : ":périphérique non prêt après 15 tentatives";
      reportError(`spotify-play-404${reason}`);
      return false;
    },
    [reportError]
  );

  const startInFlightRef = useRef(false);

  useEffect(() => {
    playbackStartedRef.current = false;
    endedFiredRef.current = false;
    durationStateRef.current = 0;
    setCurrentTime(0);
    clockPosRef.current = 0;
    clockRunAtRef.current = 0;
    clockRunningRef.current = false;
    if (reloadTimerRef.current) {
      clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = null;
    }
  }, [trackUri, trackUrl]);

  useEffect(() => {
    if (!trackUri || !ready) return;
    // Moniteur de fin indépendant du SDK : la détection "position >= durée"
    // échoue quand player_state_changed / getCurrentState n'exposent pas de
    // position (undefined). On s'appuie sur notre horloge + la durée connue
    // (SDK ou API) : si on jouait et qu'on a atteint la fin, on avance.
    const id = setInterval(() => {
      if (
        clockRunningRef.current &&
        durationStateRef.current > 0 &&
        !endedFiredRef.current &&
        getCurrentTime() >= durationStateRef.current - 3
      ) {
        endedFiredRef.current = true;
        console.log(
          "[ChordFlow] fin de piste détectée (horloge) →",
          trackUri
        );
        endedRef.current?.();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [trackUri, ready]);

  useEffect(() => {
    if (!autoPlay || !ready || !trackUri) return;
    if (playbackStartedRef.current) return;
    const reloadKey = `chordflow-spotify-refresh:${trackUri}`;
    let attempts = 0;
    try {
      attempts = parseInt(sessionStorage.getItem(reloadKey) || "0", 10) || 0;
    } catch {
      // sessionStorage indisponible → on s'abstient
    }
    if (attempts >= 2) return;
    reloadTimerRef.current = setTimeout(() => {
      reloadTimerRef.current = null;
      if (playbackStartedRef.current) return;
      try {
        sessionStorage.setItem(reloadKey, String(attempts + 1));
      } catch {
        // ignorer
      }
      console.log(
        `[ChordFlow] lecteur Spotify activé mais aucune lecture → refresh (${attempts + 1}/2) pour laisser le device s'enregistrer`
      );
      window.location.reload();
    }, 4000);
    return () => {
      if (reloadTimerRef.current) {
        clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = null;
      }
    };
  }, [autoPlay, ready, trackUri, trackUrl]);

  useEffect(() => {
    if (!trackUri) return;
    if (!ready) return;
    if (playedUriRef.current === trackUri) return;
    if (startInFlightRef.current) return;
    // Le device joue déjà ce morceau (mode suivi) → on ne le relance pas.
    if (lastFollowedUri === trackUri) {
      console.log("[ChordFlow] suivi : device joue déjà", trackUri, "→ pas de replay");
      playbackStartedRef.current = true;
      clockPosRef.current = 0;
      clockRunAtRef.current = Date.now();
      clockRunningRef.current = true;
      setCurrentTime(0);
      endedFiredRef.current = false;
      return;
    }
    startInFlightRef.current = true;
    startPlayback(trackUri, trackUrl, queueUrisRef.current ?? undefined).finally(
      () => {
        startInFlightRef.current = false;
      }
    );
  }, [trackUri, trackUrl, ready, startPlayback, queueUris]);

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
  }, [parsed]);

  useEffect(() => {
    if (seekTo === null || seekTo === undefined) return;
    clockPosRef.current = seekTo;
    if (clockRunningRef.current) clockRunAtRef.current = Date.now();
    const p = playerRef.current ?? getSpotifyPlayerInstance();
    p?.seek(seekTo * 1000).catch(() => {});
  }, [seekTo]);

  const togglePlay = useCallback(async () => {
    let player = playerRef.current;
    if (!player) {
      player = getSpotifyPlayerInstance();
      if (player) playerRef.current = player;
    }
    if (!trackUri || !player) return;
    const state = await player.getCurrentState().catch(() => null);
    const hasTrack = !!state?.track_window?.current_track;

    if (state && hasTrack && !state.paused) {
      console.log("[ChordFlow] togglePlay → pause (lecture réelle)");
      await player.pause().catch(() => {});
      return;
    }

    if (state && hasTrack && state.paused) {
      console.log("[ChordFlow] togglePlay → resume (piste en pause)");
      await player.resume().catch(() => {});
      return;
    }

    if (state && !hasTrack) {
      console.log("[ChordFlow] togglePlay → état sans piste → relais serveur");
      await startPlayback(trackUri, trackUrl, queueUrisRef.current ?? undefined);
      return;
    }

    console.log("[ChordFlow] togglePlay → pas d'état → relais serveur");
    await startPlayback(trackUri, trackUrl, queueUrisRef.current ?? undefined);
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
    clockPosRef.current = target;
    if (clockRunningRef.current) clockRunAtRef.current = Date.now();
    setCurrentTime(target);
    const p = playerRef.current ?? getSpotifyPlayerInstance();
    p?.seek(target * 1000).catch(() => {});
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
    if (!window.__SPOTIFY_DIAG) return;
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