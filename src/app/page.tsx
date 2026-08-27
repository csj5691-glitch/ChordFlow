"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { Suspense, useState, useCallback, useMemo } from "react";
import SearchBar from "@/components/SearchBar";
import SongCard from "@/components/SongCard";
import AddSong from "@/components/AddSong";
import { searchSongs, MOCK_SEARCH_RESULTS } from "@/lib/mock-data";
import {
  getCustomSongs,
  saveCustomSong,
  deleteCustomSong,
  generateSongId,
} from "@/lib/custom-songs";
import {
  loadRepertoireSort,
  saveRepertoireSort,
  RepertoireSort,
  SortField,
  SortDirection,
} from "@/lib/repertoire-sort";
import { SongTab } from "@/lib/types";
import { Plus, Trash2, ArrowUpAZ, ArrowDownAZ, ListFilter } from "lucide-react";

function SearchResults() {
  const searchParams = useSearchParams();
  const query = searchParams.get("q") || "";
  const results = query ? searchSongs(query) : MOCK_SEARCH_RESULTS;

  return (
    <div className="w-full max-w-2xl mt-8">
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

export default function Home() {
  const router = useRouter();
  const [customSongs, setCustomSongs] = useState<SongTab[]>(() => getCustomSongs());
  const [showAddSong, setShowAddSong] = useState(false);
  const [sort, setSort] = useState<RepertoireSort>(() => loadRepertoireSort());

  const handleSortChange = useCallback(
    (field: SortField, direction: SortDirection) => {
      const next = { field, direction };
      setSort(next);
      saveRepertoireSort(next);
    },
    []
  );

  const handleAddSong = useCallback((data: {
    artist: string;
    title: string;
    content: string;
    officialPlain: string;
    officialSynced: string;
    capo?: number;
    tuning?: string;
    key?: string;
  }) => {
    const id = generateSongId();
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
    saveCustomSong(song);
    setCustomSongs(getCustomSongs());
    setShowAddSong(false);
    router.push(`/song/${id}`);
  }, [router]);

  const handleDeleteSong = useCallback((id: string) => {
    deleteCustomSong(id);
    setCustomSongs(getCustomSongs());
  }, []);

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
        {customSongs.length > 0 && (
          <div className="w-full max-w-2xl mt-6">
            <div className="flex items-center justify-between mb-4">
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
            <div className="flex flex-col gap-2">
              {sortedSongs.map((song) => (
                <div
                  key={song.id}
                  className="flex items-center gap-3 p-3 bg-zinc-900/80 border border-zinc-800 rounded-xl hover:border-zinc-700 transition-colors group cursor-pointer"
                  onClick={() => router.push(`/song/${song.id}`)}
                >
                  <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-amber-400 text-lg">♪</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{song.title}</p>
                    <p className="text-xs text-zinc-500 truncate">{song.artist}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
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
                      onClick={(e) => { e.stopPropagation(); handleDeleteSong(song.id); }}
                      className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-zinc-800 rounded-lg transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-zinc-500 hover:text-red-400" />
                    </button>
                  </div>
                </div>
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
          </div>
        )}

        <Suspense
          fallback={<div className="mt-8 text-zinc-500">Chargement...</div>}
        >
          <SearchResults />
        </Suspense>
      </main>

      {showAddSong && (
        <AddSong onAdd={handleAddSong} onClose={() => setShowAddSong(false)} />
      )}
    </div>
  );
}
