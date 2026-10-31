"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.


import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useState, useCallback, useMemo, useSyncExternalStore, useEffect, useRef } from "react";
import SearchBar from "@/components/SearchBar";
import SongCard from "@/components/SongCard";
import AddSong from "@/components/AddSong";
import { searchSongs, MOCK_SEARCH_RESULTS } from "@/lib/mock-data";
import { generateSongId, saveLocalSong } from "@/lib/custom-songs";
import { useSharedSongs } from "@/lib/use-shared-songs";
import {
  loadRepertoireSort,
  saveRepertoireSort,
  RepertoireSort,
  SortField,
  SortDirection,
} from "@/lib/repertoire-sort";
import { SongTab } from "@/lib/types";
import { songHasYoutube, songHasSpotify, usePersistedUploads } from "@/lib/song-sources";
import { Plus, Trash2, Pencil, ArrowUpAZ, ArrowDownAZ, ListFilter, ArrowUp, ListMusic, Search, Mic2 } from "lucide-react";
import { SourceBadges } from "@/components/SourceBadges";
import { loadHomeScroll, saveHomeScroll } from "@/lib/home-scroll-store";
import { saveYouTubeId, loadYouTubeId } from "@/lib/youtube-store";
import { saveAudioStem } from "@/lib/audio-store";
import { authorize, getValidToken, isLoggedIn, clearToken, loadToken } from "@/lib/spotify-auth";

function SearchResults({
  repertoire,
  uploads,
  onEdit,
  onDelete,
}: {
  repertoire: SongTab[];
  uploads: Set<string>;
  onEdit: (song: SongTab) => void;
  onDelete: (id: string) => void;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = searchParams.get("q") || "";
  const results = query ? searchSongs(query) : MOCK_SEARCH_RESULTS;

  const q = query.trim().toLowerCase();
  const repertoireMatches: SongTab[] = q
    ? repertoire.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          (s.artist || "").toLowerCase().includes(q)
      )
    : [];

  return (
    <div className="w-full max-w-2xl mt-8">
      {query && repertoireMatches.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
            <span className="text-amber-400 text-lg">♪</span>
            Dans mon répertoire
            <span className="text-sm font-normal text-zinc-500">
              ({repertoireMatches.length})
            </span>
          </h2>
          <div className="flex flex-col gap-2">
            {repertoireMatches.map((song) => (
              <RepertoireRow
                key={song.id}
                song={song}
                hasFile={uploads.has(song.id)}
                onOpen={() => router.push(`/song/${song.id}`)}
                onEdit={() => onEdit(song)}
                onDelete={() => onDelete(song.id)}
              />
            ))}
          </div>
        </div>
      )}
      {query && (
        <p className="text-sm text-zinc-500 mb-4">
          {results.length} résultat{results.length !== 1 ? "s" : ""} pour &ldquo;{query}&rdquo;
        </p>
      )}
      <div className="flex flex-col gap-3">
        {results.map((song) => (
          <SongCard key={song.id} song={song} />
        ))}
      </div>
      {results.length === 0 && query && (
        <div className="text-center py-12">
          <p className="text-zinc-500 text-lg">Aucun résultat trouvé</p>
          <p className="text-zinc-600 text-sm mt-2">
            Essayez avec un autre terme de recherche
          </p>
        </div>
      )}
    </div>
  );
}

function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

function HideOnSearch({ children }: { children: React.ReactNode }) {
  const searchParams = useSearchParams();
  const hasQuery = (searchParams.get("q") || "").trim().length > 0;
  if (hasQuery) return null;
  return <>{children}</>;
}

function RepertoireRow({
  song,
  hasFile,
  onOpen,
  onEdit,
  onDelete,
}: {
  song: SongTab;
  hasFile: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="flex items-center gap-3 p-3 bg-zinc-900/80 border border-zinc-800 rounded-xl hover:border-zinc-700 transition-colors group cursor-pointer"
      onClick={onOpen}
    >
      <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
        <span className="text-amber-400 text-lg">♪</span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white truncate">{song.title}</p>
        <p className="text-xs text-zinc-500 truncate">{song.artist}</p>
      </div>
      <div className="flex items-center gap-2 flex-wrap justify-end">
        <SourceBadges
          youtube={songHasYoutube(song)}
          spotify={songHasSpotify(song)}
          file={hasFile}
        />
        {song.key && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
            {song.key}
          </span>
        )}
        {song.capo && song.capo > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-400/10 text-amber-400 font-medium">
            Capo {song.capo}
          </span>
        )}
        {song.officialSynced && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">
            Sync
          </span>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          className="p-1.5 hover:bg-zinc-800 rounded-lg transition-all sm:opacity-0 sm:group-hover:opacity-100"
        >
          <Pencil className="w-3.5 h-3.5 text-zinc-500 hover:text-amber-400" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="p-1.5 hover:bg-zinc-800 rounded-lg transition-all sm:opacity-0 sm:group-hover:opacity-100"
        >
          <Trash2 className="w-3.5 h-3.5 text-zinc-500 hover:text-red-400" />
        </button>
      </div>
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const hydrated = useHydrated();
  const { songs: customSongs, loaded, importing, importError, upsertSong, removeSong, importLocal } = useSharedSongs();
  const songIds = useMemo(() => customSongs.map((s) => s.id), [customSongs]);
  const uploads = usePersistedUploads(songIds);
  const [showAddSong, setShowAddSong] = useState(false);
  const [editingSong, setEditingSong] = useState<SongTab | null>(null);
  const [editedSort, setEditedSort] = useState<RepertoireSort | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const restoredRef = useRef(false);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ current: number; total: number; label: string } | null>(null);
  const [bulkStatus, setBulkStatus] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [playlistName, setPlaylistName] = useState("Self_Guit");

  useEffect(() => {
    const onScroll = () => {
      setShowScrollTop(window.scrollY > 400);
      if (!restoredRef.current) return;
      saveHomeScroll(window.scrollY);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Replace l'accueil à la derniere position de defilement (Supabase, repli
  // local) une fois le repertoire charge (sinon la page est bornee en hauteur).
  useEffect(() => {
    if (restoredRef.current || !hydrated || !loaded) return;
    restoredRef.current = true;
    let cancelled = false;
    const timers: number[] = [];
    void (async () => {
      const saved = await loadHomeScroll();
      if (cancelled || !saved) return;
      for (const delay of [0, 120, 350]) {
        timers.push(
          window.setTimeout(() => {
            if (Math.abs(window.scrollY - saved) > 2) window.scrollTo(0, saved);
          }, delay)
        );
      }
    })();
    return () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [hydrated, loaded]);

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const sort: RepertoireSort = useMemo(
    () =>
      hydrated
        ? (editedSort ?? loadRepertoireSort())
        : { field: "title", direction: "asc" },
    [hydrated, editedSort]
  );

  const handleSortChange = useCallback(
    (field: SortField, direction: SortDirection) => {
      const next = { field, direction };
      setEditedSort(next);
      saveRepertoireSort(next);
    },
    []
  );

  const handleAddSong = useCallback(async (data: {
    id?: string;
    artist: string;
    title: string;
    content: string;
    officialPlain: string;
    officialSynced: string;
    capo?: number;
    tuning?: string;
    key?: string;
  }) => {
    const id = data.id ?? generateSongId();
    const song: SongTab = {
      id,
      title: data.title,
      artist: data.artist,
      type: "Chords",
      content: data.content,
      officialPlain: data.officialPlain,
      officialSynced: data.officialSynced,
      capo: data.capo,
      tuning: data.tuning,
      key: data.key,
    };
    await saveLocalSong(song);
    if (!data.id) {
      try {
        await Promise.race([
          upsertSong(song),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), 5000)
          ),
        ]);
      } catch {
        // base lente/indisponible : la chanson est déjà en local, on continue
      }
    } else {
      upsertSong(song);
    }
    setShowAddSong(false);
    setEditingSong(null);
    if (!data.id) {
      router.push(`/song/${id}`);
    }
  }, [router, upsertSong]);

  const handleDeleteSong = useCallback((id: string) => {
    removeSong(id);
  }, [removeSong]);

  const sortedSongs = useMemo(() => {
    const copy = [...customSongs];
    copy.sort((a, b) => {
      const av = (a[sort.field] || "").toLowerCase();
      const bv = (b[sort.field] || "").toLowerCase();
      const cmp = av.localeCompare(bv, undefined, { sensitivity: "base" });
      return sort.direction === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [customSongs, sort]);

  // Chansons affichées dans « Mon répertoire » (Accueil) qui n'ont pas encore
  // de lien YouTube. Seules celles-là sont visées par la recherche en rafale.
  const youtubeTargets = useMemo(
    () =>
      sortedSongs.filter(
        (s) => !songHasYoutube(s) && `${s.artist} ${s.title}`.trim().length > 0
      ),
    [sortedSongs]
  );

  // ---- Rafale : playlist Spotify → chansons + liens YouTube + stems ----
  const handleImportPlaylist = useCallback(async () => {
    if (!isLoggedIn()) {
      authorize(typeof window !== "undefined" ? window.location.pathname : "/");
      return;
    }
    setBulkRunning(true);
    setBulkError(null);
    setBulkStatus(null);
    setBulkProgress({ current: 0, total: 1, label: "Connexion Spotify…" });
    try {
      const token = await getValidToken();
      if (!token) throw new Error("Token Spotify indisponible. Reconnectez-vous.");
      // Vérifier que le token possède le scope playlist (sinon 403).
      const stored = loadToken();
      if (!stored?.scope?.includes("playlist-read-private")) {
        clearToken();
        authorize(typeof window !== "undefined" ? window.location.pathname : "/", true);
        return;
      }
      const res = await fetch("/api/spotify-playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name: playlistName }),
      });
      if (res.status === 401 || res.status === 403) {
        clearToken();
        const text = await res.text().catch(() => "");
        throw new Error(
          `Autorisation Spotify insuffisante (${res.status}) : reconnectez votre compte. Détail : ${text.slice(0, 200)}`
        );
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Spotify: ${res.status} ${text.slice(0, 200)}`);
      }
      const data = (await res.json()) as {
        count: number;
        tracks: { id: string; title: string; artist: string; uri: string }[];
        error?: string;
      };
      if (data.error) {
        throw new Error(data.error);
      }
      const tracks = data.tracks ?? [];
      setBulkProgress({ current: 0, total: tracks.length, label: "Import des chansons…" });
      let added = 0;
      for (let i = 0; i < tracks.length; i++) {
        const t = tracks[i];
        setBulkProgress({ current: i + 1, total: tracks.length, label: `Import : ${t.title}` });
        const exists = customSongs.some(
          (s) =>
            s.title.toLowerCase() === t.title.toLowerCase() &&
            (s.artist || "").toLowerCase() === t.artist.toLowerCase()
        );
        if (exists) continue;
        const song: SongTab = {
          id: generateSongId(),
          title: t.title,
          artist: t.artist,
          type: "Chords",
          content: "",
          officialPlain: "",
          officialSynced: "",
          spotifyId: t.uri,
        };
        await saveLocalSong(song);
        await upsertSong(song);
        added++;
      }
      setBulkStatus(`Playlist importée : ${added} nouvelle(s) chanson(s) sur ${tracks.length}.`);
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : String(e));
    } finally {
      setBulkRunning(false);
      setBulkProgress(null);
    }
  }, [customSongs, upsertSong, playlistName]);

  const handleBulkYoutube = useCallback(async () => {
    // Uniquement les chansons du répertoire affiché à l'accueil sans lien YT.
    const targets = youtubeTargets;
    if (targets.length === 0) {
      setBulkStatus("Aucune chanson du répertoire sans lien YouTube.");
      return;
    }
    if (!window.confirm(
      `Rechercher les liens YouTube pour ${targets.length} chanson(s) du répertoire ` +
        `qui n'en ont pas encore ?`
    )) {
      return;
    }
    setBulkRunning(true);
    setBulkError(null);
    setBulkStatus(null);
    setBulkProgress({ current: 0, total: targets.length, label: "Recherche YouTube…" });
    let found = 0;
    let failed = 0;
    let lastError = "";
    for (let i = 0; i < targets.length; i++) {
      const s = targets[i];
      setBulkProgress({ current: i + 1, total: targets.length, label: `YouTube : ${s.title}` });
      try {
        const res = await fetch("/api/yt-search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ q: `${s.artist} ${s.title}`.trim() }),
        });
        if (!res.ok) {
          failed++;
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          lastError = data?.error ?? `HTTP ${res.status}`;
        } else {
          const data = (await res.json()) as { videoId?: string };
          if (data.videoId) {
            saveYouTubeId(s.id, data.videoId);
            await upsertSong({ ...s, youtubeId: data.videoId });
            found++;
          } else {
            failed++;
            lastError = "aucune vidéo trouvée";
          }
        }
      } catch (e) {
        failed++;
        lastError = e instanceof Error ? e.message : String(e);
      }
      // Petite pause pour ne pas déclencher le blocage anti-robot de YouTube.
      if (i < targets.length - 1) {
        await new Promise((r) => window.setTimeout(r, 600));
      }
    }
    const detail = failed > 0 && lastError ? ` Dernière erreur : ${lastError.slice(0, 160)}` : "";
    setBulkStatus(
      `YouTube : ${found} lien(s) trouvé(s) sur ${targets.length}` +
        (failed > 0 ? ` (${failed} échec(s)).` : ".") +
        detail
    );
    setBulkRunning(false);
    setBulkProgress(null);
  }, [youtubeTargets, upsertSong]);

  const handleBulkStems = useCallback(async () => {
    const targets = customSongs.filter((s) => {
      const vid = s.youtubeId || loadYouTubeId(s.id);
      return !!vid;
    });
    if (targets.length === 0) {
      setBulkStatus("Aucune chanson avec lien YouTube.");
      return;
    }
    if (!window.confirm(
      `Extraire les stems (voix + instrumental) pour ${targets.length} chanson(s) ? ` +
        `Demucs tourne en CPU : ~9 min par chanson de 4 min. Laisser tourner.`
    )) {
      return;
    }
    setBulkRunning(true);
    setBulkError(null);
    setBulkStatus(null);
    let done = 0;
    for (let i = 0; i < targets.length; i++) {
      const s = targets[i];
      const videoId = (s.youtubeId || loadYouTubeId(s.id)) as string;
      setBulkProgress({ current: i + 1, total: targets.length, label: `Stems : ${s.title}` });
      try {
        for (const stem of ["vocals", "noVocals"] as const) {
          const token = crypto.randomUUID();
          const res = await fetch("/api/yt-stems", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ videoId, stem, progressToken: token }),
          });
          if (!res.ok) break;
          const blob = await res.blob();
          await saveAudioStem(s.id, stem, blob);
        }
        done++;
      } catch {
        // on passe au suivant
      }
    }
    setBulkStatus(`Stems : ${done} chanson(s) traitée(s) sur ${targets.length}.`);
    setBulkRunning(false);
    setBulkProgress(null);
  }, [customSongs]);

  return (
    <div className="flex flex-col items-center min-h-screen">
      <header className="w-full pt-12 pb-8">
        <div className="flex flex-col items-center gap-2 mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-amber-400 via-emerald-400 to-amber-400 bg-clip-text text-transparent">
            ChordFlow
          </h1>
          <p className="text-zinc-500 text-sm">
            Paroles & Accords synchronisés avec la musique
          </p>
        </div>
        <div className="flex justify-center px-4">
          <SearchBar />
        </div>
      </header>

      <main className="flex-1 w-full flex flex-col items-center px-4 pb-16">
        <Suspense
          fallback={<div className="mt-8 text-zinc-500">Chargement...</div>}
        >
          <HideOnSearch>
        {customSongs.length > 0 && (
          <div className="w-full max-w-2xl mt-6">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <h2 className="text-lg font-bold text-white">
                Mon répertoire
                <span className="text-sm font-normal text-zinc-500 ml-2">
                  ({customSongs.length})
                </span>
              </h2>
              <button
                onClick={() => setShowAddSong(true)}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-amber-500 text-black rounded-full hover:bg-amber-400 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Ajouter
              </button>
              <button
                onClick={() => importLocal()}
                disabled={importing}
                title="Copier mon répertoire local actuel vers le répertoire commun partagé"
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-emerald-600 text-white rounded-full hover:bg-emerald-500 transition-colors disabled:opacity-50"
              >
                {importing ? "Import..." : "Importer mon répertoire"}
              </button>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() =>
                    handleSortChange(sort.field, sort.direction === "asc" ? "desc" : "asc")
                  }
                  title={sort.direction === "asc" ? "Tri A → Z" : "Tri Z → A"}
                  className="flex items-center gap-1 text-xs px-2.5 py-1.5 bg-zinc-800 text-zinc-300 rounded-full hover:bg-zinc-700 transition-colors"
                >
                  {sort.direction === "asc" ? (
                    <ArrowUpAZ className="w-3.5 h-3.5" />
                  ) : (
                    <ArrowDownAZ className="w-3.5 h-3.5" />
                  )}
                  {sort.direction === "asc" ? "A→Z" : "Z→A"}
                </button>
                <div className="flex items-center gap-1 text-xs bg-zinc-800 rounded-full px-1 py-0.5">
                  <ListFilter className="w-3.5 h-3.5 text-zinc-500 ml-1.5" />
                  <select
                    value={sort.field}
                    onChange={(e) =>
                      handleSortChange(e.target.value as SortField, sort.direction)
                    }
                    className="bg-transparent text-zinc-300 focus:outline-none py-1 pr-2 rounded-full cursor-pointer"
                  >
                    <option value="title" className="bg-zinc-800">Titre</option>
                    <option value="artist" className="bg-zinc-800">Artiste</option>
                  </select>
                </div>
              </div>
            </div>
            {importError && (
              <p className="text-red-400 text-xs mb-4">{importError}</p>
            )}
            <div className="flex flex-col gap-2">
              {sortedSongs.map((song) => (
                <RepertoireRow
                  key={song.id}
                  song={song}
                  hasFile={uploads.has(song.id)}
                  onOpen={() => router.push(`/song/${song.id}`)}
                  onEdit={() => setEditingSong(song)}
                  onDelete={() => handleDeleteSong(song.id)}
                />
              ))}
            </div>
          </div>
        )}

        {customSongs.length === 0 && (
          <div className="w-full max-w-2xl mt-8">
            <button
              onClick={() => setShowAddSong(true)}
              className="w-full flex items-center justify-center gap-2 p-4 border-2 border-dashed border-zinc-700 rounded-xl hover:border-amber-500/50 hover:bg-amber-500/5 transition-colors"
            >
              <Plus className="w-5 h-5 text-zinc-500" />
              <span className="text-zinc-400 text-sm">Ajouter ma première chanson</span>
            </button>
            <button
              onClick={() => importLocal()}
              disabled={importing}
              className="w-full mt-3 flex items-center justify-center gap-2 p-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl shadow-lg shadow-emerald-900/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {importing ? "Import..." : "Importer mon répertoire local"}
              <span className="text-emerald-100/90 text-xs ml-1">
                (copier ici mes chansons ajoutées sur cet appareil)
              </span>
            </button>
            {importError && (
              <p className="text-red-400 text-xs mt-2">{importError}</p>
            )}
          </div>
        )}
          </HideOnSearch>
          <SearchResults
            repertoire={customSongs}
            uploads={uploads}
            onEdit={setEditingSong}
            onDelete={handleDeleteSong}
          />
        </Suspense>
        <div className="w-full max-w-2xl mt-8 flex flex-col gap-3">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <ListMusic className="w-5 h-5 text-amber-400" />
            Rafale (playlist → stems)
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                clearToken();
                authorize(typeof window !== "undefined" ? window.location.pathname : "/", true);
              }}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-green-700 text-white rounded-full hover:bg-green-600 transition-colors"
            >
              <Search className="w-3.5 h-3.5" />
              Reconnecter Spotify (nouveaux droits)
            </button>
            <input
              type="text"
              value={playlistName}
              onChange={(e) => setPlaylistName(e.target.value)}
              disabled={bulkRunning}
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white w-40 focus:outline-none focus:border-amber-500/50"
              title="Nom exact de la playlist Spotify"
            />
            <button
              type="button"
              onClick={handleImportPlaylist}
              disabled={bulkRunning}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-green-600 text-white rounded-full hover:bg-green-500 transition-colors disabled:opacity-50"
            >
              <ListMusic className="w-3.5 h-3.5" />
              {bulkRunning && bulkProgress?.label?.startsWith("Import") ? "…" : "Importer playlist Spotify"}
            </button>
            <button
              type="button"
              onClick={handleBulkYoutube}
              disabled={bulkRunning}
              title={`Rechercher les liens YouTube des ${youtubeTargets.length} chanson(s) du répertoire qui n'en ont pas`}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-red-600/20 text-red-300 border border-red-500/30 rounded-full hover:bg-red-600/30 transition-colors disabled:opacity-50"
            >
              <Search className="w-3.5 h-3.5" />
              Rechercher YouTube en rafale ({youtubeTargets.length})
            </button>
            <button
              type="button"
              onClick={handleBulkStems}
              disabled={bulkRunning}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-full hover:bg-amber-500/30 transition-colors disabled:opacity-50"
            >
              <Mic2 className="w-3.5 h-3.5" />
              Extraire stems en rafale
            </button>
          </div>
          {bulkProgress && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span className="truncate">{bulkProgress.label}</span>
                <span className="tabular-nums">
                  {bulkProgress.current}/{bulkProgress.total}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className="h-full bg-amber-400 transition-[width] duration-200"
                  style={{
                    width: `${bulkProgress.total > 0 ? (bulkProgress.current / bulkProgress.total) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          )}
          {bulkStatus && (
            <p className="text-xs text-emerald-400">{bulkStatus}</p>
          )}
          {bulkError && (
            <p className="text-xs text-red-400">{bulkError}</p>
          )}
          <p className="text-[11px] text-zinc-600">
            ⚠️ L&apos;extraction des stems tourne en CPU (~9 min par chanson de 4 min). Lance-la sur un sous-ensemble ou laisse tourner.
            Reconnexion Spotify requise (nouveaux scopes playlist).
          </p>
        </div>
      </main>

      {(showAddSong || editingSong) && (
        <AddSong
          initial={editingSong ? {
            id: editingSong.id,
            artist: editingSong.artist,
            title: editingSong.title,
            content: editingSong.content,
            officialPlain: editingSong.officialPlain ?? "",
            officialSynced: editingSong.officialSynced ?? "",
            capo: editingSong.capo,
            tuning: editingSong.tuning,
            key: editingSong.key,
          } : undefined}
          onAdd={handleAddSong}
          onClose={() => { setShowAddSong(false); setEditingSong(null); }}
        />
      )}

      {showScrollTop && (
        <button
          onClick={scrollToTop}
          aria-label="Remonter en haut de page"
          title="Remonter en haut de page"
          className="fixed bottom-20 right-4 z-50 w-12 h-12 rounded-full bg-amber-500 hover:bg-amber-400 text-black shadow-lg shadow-black/40 flex items-center justify-center transition-all hover:-translate-y-0.5"
        >
          <ArrowUp className="w-5 h-5" />
        </button>
      )}
    </div>
  );
}
