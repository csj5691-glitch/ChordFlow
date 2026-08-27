"use client";

import { use, useState, useCallback, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import ChordDisplay from "@/components/ChordDisplay";
import ChordLyricSync from "@/components/ChordLyricSync";
import RhythmTimeline from "@/components/RhythmTimeline";
import AudioPlayer from "@/components/AudioPlayer";
import Waveform from "@/components/Waveform";
import SyncedLyrics from "@/components/SyncedLyrics";
import YouTubePlayer from "@/components/YouTubePlayer";
import YouTubeSearch from "@/components/YouTubeSearch";
import SpotifyPlayer from "@/components/SpotifyPlayer";
import SpotifySearch from "@/components/SpotifySearch";
import { getSongTab } from "@/lib/mock-data";
import { parseChordContent, sectionsToContent } from "@/lib/chord-parser";
import { saveCustomSong, getCustomSong } from "@/lib/custom-songs";
import { loadLineOffsets, saveLineOffset, loadGlobalOffset, saveGlobalOffset } from "@/lib/line-offsets";
import { SongTab } from "@/lib/types";
import { ArrowLeft, Music, Key, FileText, Music2, Play, Upload, ExternalLink, Wand2, Check } from "lucide-react";

type ViewMode = "chords" | "lyrics" | "sync";
type AudioSource = "youtube" | "upload" | "spotify" | null;

function getStaticSong(id: string): SongTab | null {
  if (id.startsWith("custom-")) return null;
  return getSongTab(id);
}

export default function SongPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seekTo, setSeekTo] = useState<number | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("chords");
  const [audioSource, setAudioSource] = useState<AudioSource>(null);
  const [youtubeVideoId, setYoutubeVideoId] = useState<string | null>(null);
  const [showYoutubeSearch, setShowYoutubeSearch] = useState(false);
  const [showSpotifySearch, setShowSpotifySearch] = useState(false);
  const [spotifyTrackUrl, setSpotifyTrackUrl] = useState<string | null>(null);
  const [lyricsOffset, setLyricsOffset] = useState(0);
  const [savedOffset, setSavedOffset] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playToggle, setPlayToggle] = useState(0);
  const [perLineOffsets, setPerLineOffsets] = useState<Record<number, number>>({});

  const [song, setSong] = useState<SongTab | null>(() => getStaticSong(id));
  const [clientLoaded, setClientLoaded] = useState(!id.startsWith("custom-"));
  const [editableContent, setEditableContent] = useState<string | null>(null);

  useEffect(() => {
    if (id.startsWith("custom-")) {
      const loaded = getCustomSong(id);
      setSong(loaded);
      if (loaded) setEditableContent(loaded.content);
      setClientLoaded(true);
    } else {
      setEditableContent(song?.content ?? null);
    }
  }, [id]);

  useEffect(() => {
    if (id) setPerLineOffsets(loadLineOffsets(id));
    if (id) {
      const loaded = loadGlobalOffset(id);
      setLyricsOffset(loaded);
      setSavedOffset(loaded);
    }
  }, [id]);

  const sections = useMemo(() => {
    if (!song) return [];
    return parseChordContent(editableContent ?? song.content);
  }, [song, editableContent]);

  const lrcTimestamps = useMemo(() => {
    if (!song?.officialSynced) return [];
    const lines: { time: number; text: string }[] = [];
    for (const line of song.officialSynced.split("\n")) {
      const m = line.match(/^\[(\d+):(\d+\.?\d*)\]\s*(.*)/);
      if (m) {
        const time = parseInt(m[1], 10) * 60 + parseFloat(m[2]);
        const text = m[3].trim();
        if (text) lines.push({ time, text });
      }
    }
    return lines;
  }, [song]);

  const timestamps = useMemo(() => {
    const result: { time: number; chord: string; sectionIndex: number; lineIndex: number }[] = [];
    if (!song) return result;

    if (lrcTimestamps.length > 0) {
      let lyricIdx = 0;
      sections.forEach((section, sIdx) => {
        section.lines.forEach((line, lIdx) => {
          if (!line.lyrics.trim()) return;
          const normalizedLyrics = line.lyrics.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
          let bestTime = lyricIdx < lrcTimestamps.length ? lrcTimestamps[lyricIdx].time : -1;
          let bestScore = 0;
          for (let i = lyricIdx; i < Math.min(lyricIdx + 5, lrcTimestamps.length); i++) {
            const normalizedLrc = lrcTimestamps[i].text.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
            const words1 = new Set(normalizedLyrics.split(/\s+/));
            const words2 = new Set(normalizedLrc.split(/\s+/));
            const intersection = [...words1].filter(w => words2.has(w)).length;
            const score = intersection / Math.max(words1.size, 1);
            if (score > bestScore) {
              bestScore = score;
              bestTime = lrcTimestamps[i].time;
              lyricIdx = i + 1;
            }
          }
          result.push({
            time: bestTime >= 0 ? bestTime : 0,
            chord: line.chords[0] || "",
            sectionIndex: sIdx,
            lineIndex: lIdx,
          });
        });
      });
    } else if (duration > 0) {
      let totalLines = 0;
      for (const section of sections) {
        totalLines += section.lines.length;
      }
      if (totalLines === 0) return result;
      const timePerLine = duration / totalLines;
      let lineCounter = 0;
      sections.forEach((section, sIdx) => {
        section.lines.forEach((line, lIdx) => {
          result.push({
            time: lineCounter * timePerLine,
            chord: line.chords[0] || "",
            sectionIndex: sIdx,
            lineIndex: lIdx,
          });
          lineCounter++;
        });
      });
    }

    return result;
  }, [sections, duration, song, lrcTimestamps]);

  useEffect(() => {
    const handler = (e: Event) => {
      const url = (e as CustomEvent).detail;
      setAudioUrl(url);
      setAudioSource("upload");
      setYoutubeVideoId(null);
    };
    window.addEventListener("audio-upload", handler);
    return () => window.removeEventListener("audio-upload", handler);
  }, []);

  const handleSeek = useCallback((time: number) => {
    setSeekTo(time);
    setCurrentTime(time);
  }, []);

  const handleTimeUpdate = useCallback((time: number) => {
    setCurrentTime(time);
  }, []);

  const handleDurationChange = useCallback((dur: number) => {
    setDuration(dur);
  }, []);

  const handleYoutubeSelect = useCallback((videoId: string) => {
    setYoutubeVideoId(videoId);
    setAudioSource("youtube");
    setAudioUrl(null);
    setShowYoutubeSearch(false);
  }, []);

  const handleSpotifySelect = useCallback((trackUrl: string) => {
    setSpotifyTrackUrl(trackUrl);
    setAudioSource("spotify");
    setAudioUrl(null);
    setYoutubeVideoId(null);
    setShowSpotifySearch(false);
  }, []);

  const handleLineOffsetChange = useCallback((lineIndex: number, newOffset: number) => {
    setPerLineOffsets((prev) => {
      const next = { ...prev, [lineIndex]: newOffset };
      if (id) saveLineOffset(id, lineIndex, newOffset);
      return next;
    });
  }, [id]);

  const handleChordEdit = useCallback((sectionIndex: number, lineIndex: number, chordIndex: number, newChord: string) => {
    const updated = sections.map((s, si) => {
      if (si !== sectionIndex) return s;
      return {
        ...s,
        lines: s.lines.map((l, li) => {
          if (li !== lineIndex) return l;
          const newChords = [...l.chords];
          if (chordIndex < newChords.length) {
            newChords[chordIndex] = newChord;
          } else {
            newChords.push(newChord);
          }
          return {
            ...l,
            chords: newChords,
            rawChord: newChords.join("  "),
          };
        }),
      };
    });
    const newContent = sectionsToContent(updated);
    setEditableContent(newContent);
    if (id?.startsWith("custom-")) {
      const existing = getCustomSong(id);
      if (existing) {
        saveCustomSong({ ...existing, content: newContent });
      }
    }
  }, [sections, id]);

  const handleRawEdit = useCallback((newContent: string) => {
    setEditableContent(newContent);
    if (id?.startsWith("custom-")) {
      const existing = getCustomSong(id);
      if (existing) {
        saveCustomSong({ ...existing, content: newContent });
      }
    }
  }, [id]);

  if (!clientLoaded) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-zinc-500 text-lg">Chargement...</p>
      </div>
    );
  }

  if (!song) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-zinc-500 text-lg">Chanson introuvable</p>
        <button
          onClick={() => router.push("/")}
          className="text-amber-400 hover:text-amber-300 flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Retour
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      <header className="sticky top-0 z-10 bg-black/80 backdrop-blur-lg border-b border-zinc-800/50">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-4">
          <button
            onClick={() => router.push("/")}
            className="p-2 hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-zinc-400" />
          </button>

          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-white truncate">{song.title}</h1>
            <p className="text-sm text-zinc-400 truncate">{song.artist}</p>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setViewMode("chords")}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                viewMode === "chords"
                  ? "text-black bg-amber-400"
                  : "text-zinc-400 bg-zinc-800 hover:bg-zinc-700"
              }`}
            >
              <Music2 className="w-3.5 h-3.5" />
              Accords
            </button>
            <button
              onClick={() => setViewMode("lyrics")}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                viewMode === "lyrics"
                  ? "text-black bg-emerald-400"
                  : "text-zinc-400 bg-zinc-800 hover:bg-zinc-700"
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              Paroles
            </button>
            <button
              onClick={() => setViewMode("sync")}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                viewMode === "sync"
                  ? "text-black bg-blue-400"
                  : "text-zinc-400 bg-zinc-800 hover:bg-zinc-700"
              }`}
            >
              <Wand2 className="w-3.5 h-3.5" />
              Sync
            </button>
          </div>

          <div className="flex items-center gap-3 flex-shrink-0">
            {song.key && (
              <span className="flex items-center gap-1 text-xs text-zinc-500 bg-zinc-800 px-2 py-1 rounded-full">
                <Key className="w-3 h-3" />
                {song.key}
              </span>
            )}
            {song.capo && song.capo > 0 && (
              <span className="text-xs text-amber-400 bg-amber-400/10 px-2 py-1 rounded-full font-medium">
                Capo {song.capo}
              </span>
            )}
            {song.tuning && (
              <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-1 rounded-full">
                {song.tuning}
              </span>
            )}
            <span className="flex items-center gap-1 text-xs text-zinc-500 bg-zinc-800 px-2 py-1 rounded-full">
              <Music className="w-3 h-3" />
              {song.type}
            </span>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6 flex flex-col gap-6">
        {!audioSource && (
          <div className="flex gap-3">
            <button
              onClick={() => setShowYoutubeSearch(true)}
              className="flex-1 flex items-center justify-center gap-2 p-4 bg-red-600/10 border border-red-600/30 rounded-xl hover:bg-red-600/20 transition-colors"
            >
              <svg className="w-5 h-5 text-red-500" viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
              <span className="text-sm font-medium text-red-400">YouTube</span>
            </button>
            <button
              onClick={() => setShowSpotifySearch(true)}
              className="flex-1 flex items-center justify-center gap-2 p-4 bg-green-600/10 border border-green-600/30 rounded-xl hover:bg-green-600/20 transition-colors"
            >
              <svg className="w-5 h-5 text-green-500" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
              <span className="text-sm font-medium text-green-400">Spotify</span>
            </button>
            <button
              onClick={() => {
                const q = encodeURIComponent(`${song.artist} ${song.title}`);
                window.open(`https://www.songsterr.com/a/wa/search?pattern=${q}`, "_blank");
              }}
              className="flex-1 flex items-center justify-center gap-2 p-4 bg-blue-600/10 border border-blue-600/30 rounded-xl hover:bg-blue-600/20 transition-colors"
            >
              <svg className="w-5 h-5 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
              <span className="text-sm font-medium text-blue-400">Songsterr</span>
            </button>
            <a
              href={`https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(`${song.artist} ${song.title}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-2 p-4 bg-amber-600/10 border border-amber-600/30 rounded-xl hover:bg-amber-600/20 transition-colors"
            >
              <ExternalLink className="w-5 h-5 text-amber-500" />
              <span className="text-sm font-medium text-amber-500">Ultimate Guitar</span>
            </a>
            <label className="flex-1 flex items-center justify-center gap-2 p-4 bg-zinc-700/10 border border-zinc-600/30 rounded-xl hover:bg-zinc-700/20 transition-colors cursor-pointer">
              <Upload className="w-5 h-5 text-zinc-400" />
              <span className="text-sm font-medium text-zinc-400">Upload</span>
              <input
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const url = URL.createObjectURL(file);
                    setAudioUrl(url);
                    setAudioSource("upload");
                  }
                }}
              />
            </label>
          </div>
        )}

        {audioSource && (
          <div className="flex items-center gap-3 p-3 bg-zinc-800/30 rounded-xl border border-zinc-700/30">
            <span className="text-xs text-zinc-500 flex-shrink-0">Décalage :</span>
            <button
              onClick={() => setLyricsOffset((o) => Math.max(-30, o - 5))}
              className="w-7 h-7 rounded bg-zinc-700 hover:bg-zinc-600 text-white flex items-center justify-center text-xs font-bold transition-colors"
            >
              -5
            </button>
            <button
              onClick={() => setLyricsOffset((o) => Math.max(-30, o - 1))}
              className="w-7 h-7 rounded bg-zinc-700 hover:bg-zinc-600 text-white flex items-center justify-center text-xs font-bold transition-colors"
            >
              -1
            </button>
            <input
              type="range"
              min={-30}
              max={30}
              step={0.1}
              value={lyricsOffset}
              onChange={(e) => setLyricsOffset(parseFloat(e.target.value))}
              className="flex-1 h-1 accent-amber-500 cursor-pointer"
            />
            <button
              onClick={() => setLyricsOffset((o) => Math.min(30, o + 1))}
              className="w-7 h-7 rounded bg-zinc-700 hover:bg-zinc-600 text-white flex items-center justify-center text-xs font-bold transition-colors"
            >
              +1
            </button>
            <button
              onClick={() => setLyricsOffset((o) => Math.min(30, o + 5))}
              className="w-7 h-7 rounded bg-zinc-700 hover:bg-zinc-600 text-white flex items-center justify-center text-xs font-bold transition-colors"
            >
              +5
            </button>
            <span className="text-sm font-mono text-amber-400 min-w-[55px] text-center">
              {lyricsOffset >= 0 ? "+" : ""}{lyricsOffset.toFixed(1)}s
            </span>
            <button
              onClick={() => { if (id) { saveGlobalOffset(id, lyricsOffset); setSavedOffset(lyricsOffset); } }}
              title="Sauvegarder le décalage"
              className={`w-7 h-7 rounded flex items-center justify-center transition-colors ${
                savedOffset === lyricsOffset
                  ? "bg-emerald-600/80 text-white"
                  : "bg-emerald-700 hover:bg-emerald-600 text-white"
              }`}
            >
              <Check className="w-3.5 h-3.5" />
            </button>
            {lrcTimestamps.length > 0 && (
              <button
                onClick={() => {
                  const firstChordTs = timestamps.find((t) => t.time > 0);
                  const firstLrcTs = lrcTimestamps[0];
                  if (firstChordTs && firstLrcTs) {
                    const autoOffset = firstChordTs.time - firstLrcTs.time;
                    setLyricsOffset(Math.round(autoOffset * 10) / 10);
                  }
                }}
                title="Auto-détection du décalage"
                className="w-7 h-7 rounded bg-blue-700 hover:bg-blue-600 text-white flex items-center justify-center transition-colors"
              >
                <Wand2 className="w-3.5 h-3.5" />
              </button>
            )}
            {lyricsOffset !== 0 && (
              <button
                onClick={() => setLyricsOffset(0)}
                className="text-xs text-zinc-500 hover:text-zinc-300 underline transition-colors"
              >
                Reset
              </button>
            )}
          </div>
        )}

        {audioSource === "youtube" && youtubeVideoId && (
          <YouTubePlayer
            videoId={youtubeVideoId}
            onTimeUpdate={handleTimeUpdate}
            onDurationChange={handleDurationChange}
            onPlayStateChange={setIsPlaying}
            seekTo={seekTo}
            playToggle={playToggle}
          />
        )}

        {audioSource === "spotify" && spotifyTrackUrl && (
          <SpotifyPlayer trackUrl={spotifyTrackUrl} />
        )}

        {audioSource === "upload" && (
          <AudioPlayer
            audioUrl={audioUrl}
            onTimeUpdate={handleTimeUpdate}
            onDurationChange={handleDurationChange}
            seekTo={seekTo}
          />
        )}

        {audioSource === "youtube" && (
          <div className="flex items-center justify-center">
            <button
              onClick={() => setPlayToggle((t) => t + 1)}
              className="w-14 h-14 rounded-full bg-amber-500 hover:bg-amber-400 text-black flex items-center justify-center transition-colors shadow-lg shadow-amber-500/20"
            >
              {isPlaying ? (
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                </svg>
              ) : (
                <svg className="w-6 h-6 ml-1" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>
          </div>
        )}

        {audioSource && audioUrl && duration > 0 && (
          <div className="bg-zinc-800/50 rounded-xl border border-zinc-700/50 p-4">
            <Waveform
              audioUrl={audioUrl}
              currentTime={currentTime}
              duration={duration}
              onSeek={handleSeek}
            />
          </div>
        )}

        {audioSource && duration > 0 && (
          <RhythmTimeline
            timestamps={timestamps}
            duration={duration}
            currentTime={currentTime}
            onSeek={handleSeek}
          />
        )}

        {viewMode === "chords" ? (
          <ChordDisplay
            sections={sections}
            currentTime={currentTime}
            timestamps={timestamps}
            onSeek={handleSeek}
            offset={lyricsOffset}
            onChordEdit={handleChordEdit}
            onRawEdit={handleRawEdit}
          />
        ) : viewMode === "lyrics" ? (
          <SyncedLyrics
            songId={id}
            artist={song.artist}
            title={song.title}
            plainLyrics={song.officialPlain || ""}
            syncedLrc={song.officialSynced || undefined}
            currentTime={currentTime}
            onSeek={handleSeek}
            offset={lyricsOffset}
          />
        ) : (
          <ChordLyricSync
            sections={sections}
            syncedLrc={song.officialSynced || undefined}
            plainLyrics={song.officialPlain || ""}
            currentTime={currentTime}
            onSeek={handleSeek}
            offset={lyricsOffset}
            lineOffsets={perLineOffsets}
            onLineOffsetChange={handleLineOffsetChange}
          />
        )}
      </main>

      {showYoutubeSearch && (
        <YouTubeSearch
          artist={song.artist}
          title={song.title}
          onSelect={handleYoutubeSelect}
          onClose={() => setShowYoutubeSearch(false)}
        />
      )}

      {showSpotifySearch && (
        <SpotifySearch
          artist={song.artist}
          title={song.title}
          onSelect={handleSpotifySelect}
          onClose={() => setShowSpotifySearch(false)}
        />
      )}
    </div>
  );
}
