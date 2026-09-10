"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { useEffect, useRef, useState } from "react";
import { Music2, X } from "lucide-react";
import {
  loadAudioStems,
  saveAudioStem,
  getAudioStemUrl,
} from "@/lib/audio-store";
import { getCurrentTime } from "@/lib/playback-store";

interface InstrumentalMixProps {
  songId: string;
  isPlaying: boolean;
  seekTo?: number | null;
  tempoScale?: number;
  onVoiceVolume?: (volume: number) => void;
}

interface SpotifyInfo {
  paused: boolean;
  piste: string | null;
  dur: number;
  pos: number;
}

export default function InstrumentalMix({
  songId,
  isPlaying,
  seekTo,
  tempoScale = 1,
  onVoiceVolume,
}: InstrumentalMixProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const urlRef = useRef<string | null>(null);
  const [hasInstrumental, setHasInstrumental] = useState(false);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [voiceVol, setVoiceVol] = useState(1);
  const [instruVol, setInstruVol] = useState(0.7);
  const [offsetMs, setOffsetMs] = useState(0);
  const [loopOn, setLoopOn] = useState(false);
  const [spotifyInfo, setSpotifyInfo] = useState<SpotifyInfo | null>(null);

  useEffect(() => {
    const h = (e: Event) => {
      setSpotifyInfo((e as CustomEvent).detail as SpotifyInfo);
    };
    window.addEventListener("chordflow-spotify-info", h);
    return () => window.removeEventListener("chordflow-spotify-info", h);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stems = await loadAudioStems(songId);
      if (cancelled || !stems?.noVocals) return;
      const url = getAudioStemUrl(stems.noVocals);
      if (!url) return;
      urlRef.current = url;
      setFileUrl(url);
      setFileName("Instrumental");
      setHasInstrumental(true);
    })();
    return () => {
      cancelled = true;
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
      onVoiceVolume?.(1);
    };
  }, [songId, onVoiceVolume]);

  const applyFile = (blob: Blob, name: string) => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    const url = getAudioStemUrl(blob);
    if (!url) return;
    urlRef.current = url;
    setFileUrl(url);
    setFileName(name);
    setHasInstrumental(true);
  };

  const handleUpload = async (file: File) => {
    applyFile(file, file.name);
    try {
      await saveAudioStem(songId, "noVocals", file);
    } catch (err) {
      console.error("[ChordFlow] Instrumental : échec de sauvegarde", err);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      console.log(
        `[ChordFlow] instrumental fichier choisi : ${file.name} (${file.size} o, type=${file.type})`
      );
      void handleUpload(file);
    }
    e.target.value = "";
  };

  const handleClear = async () => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setFileUrl(null);
    setFileName("");
    setHasInstrumental(false);
    try {
      await saveAudioStem(songId, "noVocals", null);
    } catch (err) {
      console.error("[ChordFlow] Instrumental : échec de retrait", err);
    }
  };

  const targetPos = (t: number) => {
    const el = audioRef.current;
    if (!el) return t;
    const dur =
      Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
    const raw = (t + offsetMs / 1000) / tempoScale;
    if (dur <= 0) return raw;
    if (loopOn) return ((raw % dur) + dur) % dur;
    return Math.min(Math.max(0, raw), Math.max(0, dur - 0.05));
  };

  useEffect(() => {
    onVoiceVolume?.(voiceVol);
    console.log(`[ChordFlow] voix slider → ${voiceVol}`);
  }, [voiceVol, onVoiceVolume]);

  useEffect(() => {
    const el = audioRef.current;
    if (el && fileUrl) {
      el.volume = instruVol;
      el.muted = false;
      if (isPlaying) {
        el.play().catch(() => {});
      }
    }
  }, [instruVol, isPlaying, fileUrl]);

  const ensurePlaying = () => {
    const el = audioRef.current;
    if (el && fileUrl && isPlaying) {
      el.play().catch(() => {});
    }
  };

  useEffect(() => {
    if (!fileUrl || !isPlaying) return;
    document.addEventListener("pointerdown", ensurePlaying, true);
    return () => document.removeEventListener("pointerdown", ensurePlaying, true);
  });

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !fileUrl) return;
    el.loop = loopOn;
  }, [fileUrl, loopOn]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !fileUrl) return;
    if (seekTo != null) {
      el.currentTime = targetPos(seekTo);
    }
  }, [seekTo, tempoScale, offsetMs, loopOn, fileUrl]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !fileUrl) return;
    if (isPlaying) {
      el.currentTime = targetPos(getCurrentTime());
      const p = el.play();
      if (p) {
        p.then(() => {
          console.log("[ChordFlow] instrumental : lecture démarrée");
        }).catch((e: unknown) => {
          console.warn(
            "[ChordFlow] instrumental : lecture bloquée par le navigateur",
            (e as Error)?.name ?? e
          );
        });
      }
    } else {
      el.pause();
    }
  }, [isPlaying, tempoScale, offsetMs, loopOn, fileUrl]);

  useEffect(() => {
    if (!isPlaying) return;
    const id = window.setInterval(() => {
      const el = audioRef.current;
      if (!el || !fileUrl) return;
      if (el.readyState < 2) return;
      const pos = targetPos(getCurrentTime());
      const err = pos - el.currentTime;
      if (Math.abs(err) > 0.5) {
        el.currentTime = pos;
        console.log(
          `[ChordFlow] instrumental resync → ${pos.toFixed(2)}s (dur=${Number.isFinite(el.duration) ? el.duration.toFixed(2) : "?"})`
        );
      } else {
        const base = 1 / tempoScale;
        const rate = Math.max(0.98, Math.min(1.02, base * (1 + err * 0.6)));
        el.playbackRate = rate;
      }
      if (el.paused) {
        el.play().catch(() => {});
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [isPlaying, tempoScale, offsetMs, loopOn, fileUrl]);

  useEffect(() => {
    console.log(`[ChordFlow] instrumental isPlaying=${isPlaying}`);
  }, [isPlaying]);

  return (
    <div className="mt-3 p-3 bg-zinc-800/30 rounded-xl border border-zinc-700/30">
      <div className="flex items-center gap-3">
        <Music2 className="w-4 h-4 text-purple-400 flex-shrink-0" />
        <label className="flex items-center gap-2 text-sm font-medium text-purple-400 cursor-pointer select-none hover:text-purple-300 transition-colors">
          <span>
            {hasInstrumental ? `Instrumental : ${fileName}` : "Ajouter l'instrumental"}
          </span>
          <input
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={handleFileChange}
          />
        </label>
        {hasInstrumental && (
          <button
            onClick={() => void handleClear()}
            title="Retirer l'instrumental"
            className="ml-auto w-7 h-7 rounded bg-zinc-700/60 hover:bg-red-800 text-white flex items-center justify-center transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {hasInstrumental && spotifyInfo && (
        <div className="mt-2 text-xs text-zinc-500">
          Device Spotify :{" "}
          <span className={spotifyInfo.paused ? "text-zinc-400" : "text-emerald-400"}>
            {spotifyInfo.paused ? "en pause" : "lecture"}
          </span>{" "}
          – {spotifyInfo.piste ?? "aucune piste"} – {spotifyInfo.pos.toFixed(1)} /
          {spotifyInfo.dur.toFixed(0)} s
        </div>
      )}

      {hasInstrumental && (
        <div className="mt-3 space-y-2.5">
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-500 w-20 flex-shrink-0">Voix</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={voiceVol}
              onChange={(e) => setVoiceVol(parseFloat(e.target.value))}
              className="flex-1 h-1 accent-purple-500 cursor-pointer"
            />
            <span className="text-xs text-zinc-400 w-9 text-right">
              {Math.round(voiceVol * 100)}%
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-500 w-20 flex-shrink-0">Instrumental</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={instruVol}
              onChange={(e) => setInstruVol(parseFloat(e.target.value))}
              className="flex-1 h-1 accent-purple-500 cursor-pointer"
            />
            <span className="text-xs text-zinc-400 w-9 text-right">
              {Math.round(instruVol * 100)}%
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500 w-20 flex-shrink-0">Décalage</span>
            <button
              onClick={() => setOffsetMs((o) => Math.max(-2000, o - 100))}
              className="w-9 h-7 rounded bg-zinc-700 hover:bg-zinc-600 text-xs text-white transition-colors"
            >
              -100
            </button>
            <button
              onClick={() => setOffsetMs((o) => Math.max(-2000, o - 10))}
              className="w-9 h-7 rounded bg-zinc-700 hover:bg-zinc-600 text-xs text-white transition-colors"
            >
              -10
            </button>
            <span className="text-xs font-mono text-amber-400 min-w-[64px] text-center">
              {offsetMs >= 0 ? "+" : ""}
              {offsetMs} ms
            </span>
            <button
              onClick={() => setOffsetMs((o) => Math.min(2000, o + 10))}
              className="w-9 h-7 rounded bg-zinc-700 hover:bg-zinc-600 text-xs text-white transition-colors"
            >
              +10
            </button>
            <button
              onClick={() => setOffsetMs((o) => Math.min(2000, o + 100))}
              className="w-9 h-7 rounded bg-zinc-700 hover:bg-zinc-600 text-xs text-white transition-colors"
            >
              +100
            </button>
            {offsetMs !== 0 && (
              <button
                onClick={() => setOffsetMs(0)}
                className="text-xs text-zinc-500 hover:text-zinc-300 underline transition-colors ml-auto"
              >
                Reset
              </button>
            )}
          </div>
          <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={loopOn}
              onChange={(e) => setLoopOn(e.target.checked)}
              className="accent-purple-500"
            />
            Boucle (si le fichier est plus court que le titre)
          </label>
        </div>
      )}

      <audio
        ref={audioRef}
        src={fileUrl ?? undefined}
        preload="auto"
        className="hidden"
        onCanPlay={() => {
          if (isPlaying) audioRef.current?.play().catch(() => {});
        }}
        onLoadedData={() => {
          console.log(
            `[ChordFlow] instrumental données chargées duration=${audioRef.current?.duration}`
          );
        }}
        onError={() => {
          const err = audioRef.current?.error;
          console.error(
            "[ChordFlow] instrumental erreur média",
            err ? { code: err.code, message: err.message } : "inconnue"
          );
        }}
      />
    </div>
  );
}