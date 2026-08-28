"use client";

import { useState, useCallback } from "react";
import { X, Search, Plus, Loader2, Music, RefreshCw, Download } from "lucide-react";
import ChordReference from "./ChordReference";
import { detectKeyFromContent } from "@/lib/key-detection";

interface AddSongProps {
  initial?: {
    id: string;
    artist: string;
    title: string;
    content: string;
    officialPlain: string;
    officialSynced: string;
    capo?: number;
    tuning?: string;
    key?: string;
  };
  onAdd: (song: {
    id?: string;
    artist: string;
    title: string;
    content: string;
    officialPlain: string;
    officialSynced: string;
    capo?: number;
    tuning?: string;
    key?: string;
  }) => void;
  onClose: () => void;
}

export default function AddSong({ initial, onAdd, onClose }: AddSongProps) {
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [artist, setArtist] = useState(initial?.artist ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [plainLyrics, setPlainLyrics] = useState(initial?.officialPlain ?? "");
  const [syncedLyrics, setSyncedLyrics] = useState(initial?.officialSynced ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"search" | "lyrics" | "chords">(initial ? "chords" : "search");
  const [showChordRef, setShowChordRef] = useState(false);
  const [tuning, setTuning] = useState(initial?.tuning ?? "Standard (EADGBE)");
  const [capo, setCapo] = useState<number | null>(initial?.capo ?? null);
  const [songsterrLoading, setSongsterrLoading] = useState(false);
  const [songsterrTip, setSongsterrTip] = useState<string | null>(null);
  const [ugLoading, setUgLoading] = useState(false);
  const [ugError, setUgError] = useState<string | null>(null);

  const fetchSongsterrTuning = useCallback(async () => {
    if (!artist.trim() || !title.trim()) return;
    setSongsterrLoading(true);
    setSongsterrTip(null);
    try {
      const res = await fetch(
        `/api/songsterr?artist=${encodeURIComponent(artist.trim())}&title=${encodeURIComponent(title.trim())}`
      );
      const data = await res.json();
      if (res.ok && data.tuning) {
        setTuning(data.tuning);
        setSongsterrTip(
          `Accordage trouvé sur Songsterr (${data.artist} - ${data.title})`
        );
      } else {
        setSongsterrTip("Aucun accordage trouvé sur Songsterr.");
      }
    } catch {
      setSongsterrTip("Impossible de contacter Songsterr.");
    } finally {
      setSongsterrLoading(false);
    }
  }, [artist, title]);

  const insertChord = useCallback((chordName: string) => {
    setContent((prev) => prev + (prev && !prev.endsWith("\n") ? "\n" : "") + chordName + "  ");
  }, []);

  const fetchUgChords = useCallback(async () => {
    if (!artist.trim() && !title.trim()) return;
    setUgLoading(true);
    setUgError(null);
    try {
      const res = await fetch(
        `/api/ug?query=${encodeURIComponent(`${artist.trim()} ${title.trim()}`)}`
      );
      const data = await res.json();
      if (res.ok && data.content) {
        setArtist(data.artist || artist);
        setTitle(data.title || title);
        setContent(data.content);
        if (data.tuning) {
          setTuning(data.tuning);
        }
        if (typeof data.capo === "number") {
          setCapo(data.capo);
        }
        setStep("chords");
      } else {
        setUgError(data.error || "Aucun accord trouvé sur Ultimate Guitar.");
      }
    } catch {
      setUgError("Impossible de contacter Ultimate Guitar.");
    } finally {
      setUgLoading(false);
    }
  }, [artist, title]);

  const searchLyrics = useCallback(async () => {
    if (!artist.trim() || !title.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/lyrics?artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(title)}`
      );
      if (res.ok) {
        const data = await res.json();
        setPlainLyrics(data.plain || "");
        setSyncedLyrics(data.synced || "");
        setStep("chords");
      } else {
        setError("Paroles introuvables. Essayez en mode manuel.");
        setStep("lyrics");
      }
    } catch {
      setError("Erreur lors de la recherche. Essayez en mode manuel.");
      setStep("lyrics");
    } finally {
      setLoading(false);
    }
  }, [artist, title]);

  const handleSubmit = useCallback(() => {
    if (!artist.trim() || !title.trim()) return;
    const detectedKey = detectKeyFromContent(content) || undefined;
    onAdd({
      id: initial?.id,
      artist: artist.trim(),
      title: title.trim(),
      content: content.trim(),
      officialPlain: plainLyrics.trim(),
      officialSynced: syncedLyrics.trim(),
      capo: capo ?? undefined,
      tuning: tuning !== "Standard (EADGBE)" ? tuning : undefined,
      key: detectedKey,
    });
  }, [initial, artist, title, content, plainLyrics, syncedLyrics, tuning, capo, onAdd]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-2xl mx-4 overflow-hidden shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <h3 className="text-lg font-bold text-white">
            {initial ? "Modifier la chanson" : "Ajouter une chanson"}
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-zinc-800 rounded-lg transition-colors">
            <X className="w-5 h-5 text-zinc-400" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          <div className="flex gap-2">
            <button
              onClick={() => setMode("auto")}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                mode === "auto" ? "bg-amber-500 text-black" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
              }`}
            >
              Recherche auto
            </button>
            <button
              onClick={() => { setMode("manual"); setStep("lyrics"); }}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                mode === "manual" ? "bg-amber-500 text-black" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
              }`}
            >
              Saisie manuelle
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Artiste</label>
              <input
                type="text"
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500/50"
                placeholder="ex: Eagles"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Titre</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500/50"
                placeholder="ex: Hotel California"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                onClick={fetchSongsterrTuning}
                disabled={!artist.trim() || !title.trim() || songsterrLoading}
                className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-amber-400 disabled:text-zinc-600 transition-colors"
              >
                {songsterrLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                {songsterrLoading ? "Recherche..." : "Vérifier l'accordage sur Songsterr"}
              </button>
              {songsterrTip && <span className="text-[10px] text-emerald-400/80">{songsterrTip}</span>}
            </div>
            {content.trim() && detectKeyFromContent(content) && (
              <span className="flex items-center gap-1 text-[10px] text-zinc-500 bg-zinc-800 px-2 py-1 rounded-full">
                Tonalité détectée : <span className="text-amber-400 font-mono">{detectKeyFromContent(content)}</span>
              </span>
            )}
          </div>

          {(capo !== null || tuning !== "Standard (EADGBE)") && (
            <div className="flex flex-wrap items-center gap-3 bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2">
              <label className="flex items-center gap-2 text-xs text-zinc-400">
                <span>Capo</span>
                <input
                  type="number"
                  min={0}
                  max={12}
                  value={capo ?? 0}
                  onChange={(e) =>
                    setCapo(e.target.value === "" ? null : Math.max(0, Number(e.target.value)))
                  }
                  className="w-14 bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-amber-500/50"
                />
                <span>fret</span>
              </label>
              <label className="flex items-center gap-2 text-xs text-zinc-400">
                <span>Accordage</span>
                <input
                  type="text"
                  value={tuning}
                  onChange={(e) => setTuning(e.target.value)}
                  className="bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-white text-sm focus:outline-none focus:border-amber-500/50"
                />
              </label>
            </div>
          )}

          {mode === "auto" && (
            <div className="space-y-2">
              <button
                onClick={searchLyrics}
                disabled={!artist.trim() || !title.trim() || loading}
                className="w-full flex items-center justify-center gap-2 py-3 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 text-black disabled:text-zinc-500 rounded-xl font-medium transition-colors"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                {loading ? "Recherche..." : "Chercher les paroles"}
              </button>
              <button
                onClick={fetchUgChords}
                disabled={(!artist.trim() && !title.trim()) || ugLoading}
                className="w-full flex items-center justify-center gap-2 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 text-white disabled:text-zinc-500 rounded-xl font-medium transition-colors"
              >
                {ugLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                {ugLoading ? "Import depuis UG..." : "Importer les accords depuis Ultimate Guitar"}
              </button>
              {ugError && (
                <p className="text-red-400 text-xs text-center">{ugError}</p>
              )}
            </div>
          )}

          {error && <p className="text-red-400 text-xs">{error}</p>}

          {(step === "lyrics" || mode === "manual") && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-zinc-400">
                  Paroles {syncedLyrics ? "(sync LRCLIB chargées)" : "(optionnel - collez le texte)"}
                </label>
                {artist.trim() && title.trim() && !plainLyrics && (
                  <button
                    onClick={searchLyrics}
                    disabled={loading}
                    className="text-[10px] text-zinc-500 hover:text-amber-400 flex items-center gap-1 transition-colors"
                  >
                    {loading ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Search className="w-2.5 h-2.5" />}
                    {loading ? "Chargement..." : "Chercher les paroles"}
                  </button>
                )}
              </div>
              <textarea
                value={plainLyrics}
                onChange={(e) => setPlainLyrics(e.target.value)}
                rows={6}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-amber-500/50 resize-none"
                placeholder="Collez les paroles ici..."
              />
            </div>
          )}

          {(step === "lyrics" || mode === "manual") && (
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">
                Paroles synchronisées LRC (optionnel)
              </label>
              <textarea
                value={syncedLyrics}
                onChange={(e) => setSyncedLyrics(e.target.value)}
                rows={4}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-amber-500/50 resize-none"
                placeholder="[00:12.00] Première ligne&#10;[00:15.50] Deuxième ligne..."
              />
            </div>
          )}

          {(step === "chords" || mode === "manual") && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-zinc-400">
                  Accords {plainLyrics ? `(paroles chargées: ${plainLyrics.slice(0, 50)}...)` : ""}
                </label>
                {artist.trim() && title.trim() && !plainLyrics && (
                  <button
                    onClick={searchLyrics}
                    disabled={loading}
                    className="text-[10px] text-zinc-500 hover:text-amber-400 flex items-center gap-1 transition-colors"
                  >
                    {loading ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Search className="w-2.5 h-2.5" />}
                    {loading ? "Chargement..." : "Chercher les paroles automatiquement"}
                  </button>
                )}
              </div>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={12}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-amber-500/50 resize-none"
                placeholder={`[Verse 1]\nAm              F\nOn a dark desert highway\nC               G\nCool wind in my hair...`}
              />
              <div className="flex items-center justify-between mt-1">
                <p className="text-[10px] text-zinc-600">
                  Format: accords au-dessus des paroles, sections entre crochets [Verse], [Chorus]...
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowChordRef(!showChordRef)}
                    className={`text-[10px] flex items-center gap-1 transition-colors ${
                      showChordRef ? "text-amber-400" : "text-zinc-500 hover:text-amber-400"
                    }`}
                  >
                    <Music className="w-2.5 h-2.5" />
                    {showChordRef ? "Masquer" : "Diagrammes"}
                  </button>
                </div>
              </div>
              {showChordRef && (
                <div className="mt-3">
                  <ChordReference onInsert={insertChord} />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-zinc-800 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-zinc-400 hover:text-white text-sm transition-colors"
          >
            Annuler
          </button>
          <button
            onClick={handleSubmit}
            disabled={!artist.trim() || !title.trim()}
            className="flex items-center gap-2 px-5 py-2 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 text-black disabled:text-zinc-500 rounded-lg font-medium text-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            {initial ? "Enregistrer" : "Ajouter"}
          </button>
        </div>
      </div>
    </div>
  );
}
