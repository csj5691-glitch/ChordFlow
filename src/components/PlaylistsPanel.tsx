"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.


import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { SongTab } from "@/lib/types";
import {
  addToPlaylist,
  createPlaylist,
  deletePlaylist,
  loadPlaylists,
  movePlaylistEntry,
  removeFromPlaylist,
  renamePlaylist,
  saveSession,
  Playlist,
  PlaylistEntry,
} from "@/lib/playlists";
import { Play, ChevronDown, ChevronRight, Pencil, Trash2, Plus, X, ArrowUp, ArrowDown, Check, ListMusic } from "lucide-react";
import { SourceBadges } from "@/components/SourceBadges";
import { songHasYoutube, songHasSpotify } from "@/lib/song-sources";

interface PlaylistsPanelProps {
  songs: SongTab[];
  uploads: Set<string>;
}

export default function PlaylistsPanel({ songs, uploads }: PlaylistsPanelProps) {
  const router = useRouter();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    setPlaylists(loadPlaylists());
  }, []);

  const refresh = useCallback(() => {
    setPlaylists(loadPlaylists());
  }, []);

  const handleCreate = () => {
    if (!newName.trim()) return;
    const p = createPlaylist(newName);
    setNewName("");
    setCreateOpen(false);
    setExpanded(p.id);
    refresh();
  };

  const handleRename = (id: string) => {
    if (renameValue.trim()) renamePlaylist(id, renameValue);
    setRenameId(null);
    refresh();
  };

  const handleDelete = (id: string) => {
    deletePlaylist(id);
    setExpanded((e) => (e === id ? null : e));
    refresh();
  };

  const handlePlay = (p: Playlist) => {
    if (p.entries.length === 0) return;
    saveSession({ playlistId: p.id, index: 0 });
    router.push(`/song/${p.entries[0].id}`);
  };

  const handlePlayFrom = (p: Playlist, index: number) => {
    if (p.entries.length === 0) return;
    saveSession({ playlistId: p.id, index });
    router.push(`/song/${p.entries[index].id}`);
  };

  const handleAddSong = (p: Playlist, songId: string) => {
    const song = songs.find((s) => s.id === songId);
    if (!song) return;
    addToPlaylist(p.id, {
      id: song.id,
      title: song.title,
      artist: song.artist,
    });
    refresh();
  };

  const addableSongs = (p: Playlist): SongTab[] =>
    songs.filter((s) => !p.entries.some((e) => e.id === s.id));

  if (playlists.length === 0 && !createOpen) {
    return (
      <div className="w-full max-w-2xl">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <ListMusic className="w-4 h-4 text-amber-400" />
            Mes playlists
          </h2>
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-amber-500 text-black rounded-full hover:bg-amber-400 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Créer
          </button>
        </div>
        {createOpen && (
          <CreatePlaylistRow
            value={newName}
            onChange={setNewName}
            onSave={handleCreate}
            onCancel={() => setCreateOpen(false)}
          />
        )}
        {!createOpen && (
          <p className="text-sm text-zinc-500">
            Créez des playlists pour jouer vos chansons en continu.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <ListMusic className="w-4 h-4 text-amber-400" />
          Mes playlists
          <span className="text-sm font-normal text-zinc-500">
            ({playlists.length})
          </span>
        </h2>
        <button
          onClick={() => setCreateOpen((v) => !v)}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 bg-amber-500 text-black rounded-full hover:bg-amber-400 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Créer
        </button>
      </div>
      {createOpen && (
        <CreatePlaylistRow
          value={newName}
          onChange={setNewName}
          onSave={handleCreate}
          onCancel={() => setCreateOpen(false)}
        />
      )}
      <div className="flex flex-col gap-2">
        {playlists.map((p) => {
          const isOpen = expanded === p.id;
          return (
            <div
              key={p.id}
              className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden"
            >
              <div className="flex items-center gap-2 p-3">
                <button
                  onClick={() => setExpanded(isOpen ? null : p.id)}
                  className="flex flex-1 items-center gap-2 min-w-0 text-left"
                  title={isOpen ? "Réduire" : "Afficher les chansons"}
                >
                  {isOpen ? (
                    <ChevronDown className="w-4 h-4 text-zinc-500 flex-shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-zinc-500 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    {renameId === p.id ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRename(p.id);
                          if (e.key === "Escape") setRenameId(null);
                        }}
                        className="w-full bg-zinc-800 text-white text-sm rounded-lg px-2 py-1 focus:outline-none border border-amber-500/50"
                      />
                    ) : (
                      <>
                        <p className="text-sm font-medium text-white truncate">
                          {p.name}
                        </p>
                        <p className="text-xs text-zinc-500">
                          {p.entries.length} chanson{p.entries.length !== 1 ? "s" : ""}
                        </p>
                      </>
                    )}
                  </div>
                </button>
                <button
                  onClick={() => handlePlay(p)}
                  disabled={p.entries.length === 0}
                  title={p.entries.length === 0 ? "Ajoutez d'abord des chansons" : "Lire la playlist"}
                  className="w-9 h-9 rounded-full bg-amber-500 hover:bg-amber-400 disabled:opacity-30 text-black flex items-center justify-center transition-colors flex-shrink-0"
                >
                  <Play className="w-4 h-4 ml-0.5" />
                </button>
                <button
                  onClick={() => {
                    if (renameId === p.id) {
                      handleRename(p.id);
                    } else {
                      setRenameValue(p.name);
                      setRenameId(p.id);
                    }
                  }}
                  title="Renommer"
                  className="w-8 h-8 rounded-lg hover:bg-zinc-800 flex items-center justify-center transition-colors flex-shrink-0"
                >
                  {renameId === p.id ? (
                    <Check className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Pencil className="w-4 h-4 text-zinc-500 hover:text-amber-400" />
                  )}
                </button>
                <button
                  onClick={() => handleDelete(p.id)}
                  title="Supprimer la playlist"
                  className="w-8 h-8 rounded-lg hover:bg-zinc-800 flex items-center justify-center transition-colors flex-shrink-0"
                >
                  <Trash2 className="w-4 h-4 text-zinc-500 hover:text-red-400" />
                </button>
              </div>
              {isOpen && (
                <div className="border-t border-zinc-800 p-2 flex flex-col gap-1">
                  {p.entries.length === 0 ? (
                    <p className="text-xs text-zinc-500 px-2 py-2">
                      Aucune chanson pour l&apos;instant.
                    </p>
                  ) : (
                    p.entries.map((e, i) => (
                      <PlaylistEntryRow
                        key={e.id}
                        entry={e}
                        index={i}
                        total={p.entries.length}
                        onOpen={() => handlePlayFrom(p, i)}
                        onUp={() => {
                          movePlaylistEntry(p.id, e.id, -1);
                          refresh();
                        }}
                        onDown={() => {
                          movePlaylistEntry(p.id, e.id, 1);
                          refresh();
                        }}
                        onRemove={() => {
                          removeFromPlaylist(p.id, e.id);
                          refresh();
                        }}
                      />
                    ))
                  )}
                  <AddSongRow
                    playlist={p}
                    songs={addableSongs(p)}
                    uploads={uploads}
                    onAdd={handleAddSong}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CreatePlaylistRow({
  value,
  onChange,
  onSave,
  onCancel,
}: {
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave();
          if (e.key === "Escape") onCancel();
        }}
        placeholder="Nom de la playlist"
        className="flex-1 bg-zinc-900 text-white text-sm rounded-lg px-3 py-2 border border-zinc-700 focus:outline-none focus:border-amber-500/50"
      />
      <button
        onClick={onSave}
        className="px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-sm font-medium transition-colors"
      >
        Créer
      </button>
      <button
        onClick={onCancel}
        className="w-9 h-9 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 flex items-center justify-center transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

function PlaylistEntryRow({
  entry,
  index,
  total,
  onOpen,
  onUp,
  onDown,
  onRemove,
}: {
  entry: PlaylistEntry;
  index: number;
  total: number;
  onOpen: () => void;
  onUp: () => void;
  onDown: () => void;
  onRemove: () => void;
}) {
  return (
    <div
      onClick={onOpen}
      title="Jouer à partir de ce morceau, puis enchaîner"
      className="group flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-zinc-800/70 cursor-pointer transition-colors"
    >
      <span className="text-xs font-mono text-zinc-600 w-6 flex-shrink-0">
        {index + 1}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-zinc-200 truncate">{entry.title}</p>
        <p className="text-xs text-zinc-500 truncate">{entry.artist}</p>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onUp();
        }}
        disabled={index === 0}
        title="Monter"
        className="w-7 h-7 rounded-lg hover:bg-zinc-700 disabled:opacity-30 flex items-center justify-center transition-colors flex-shrink-0"
      >
        <ArrowUp className="w-3.5 h-3.5 text-zinc-400" />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDown();
        }}
        disabled={index === total - 1}
        title="Descendre"
        className="w-7 h-7 rounded-lg hover:bg-zinc-700 disabled:opacity-30 flex items-center justify-center transition-colors flex-shrink-0"
      >
        <ArrowDown className="w-3.5 h-3.5 text-zinc-400" />
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        title="Retirer de la playlist"
        className="w-7 h-7 rounded-lg hover:bg-zinc-700 flex items-center justify-center transition-colors flex-shrink-0"
      >
        <X className="w-3.5 h-3.5 text-zinc-500 hover:text-red-400" />
      </button>
    </div>
  );
}

function AddSongRow({
  playlist,
  songs,
  uploads,
  onAdd,
}: {
  playlist: Playlist;
  songs: SongTab[];
  uploads: Set<string>;
  onAdd: (p: Playlist, songId: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  if (songs.length === 0) return null;
  return (
    <div className="mt-1 pt-1 border-t border-zinc-800/70">
      <p className="text-xs text-zinc-500 px-2 py-1.5">
        Ajouter une chanson du répertoire :
      </p>
      <div className="max-h-48 overflow-y-auto flex flex-col gap-0.5">
        {songs.map((s) => {
          const isSelected = selectedId === s.id;
          return (
            <div
              key={s.id}
              onClick={() => {
                onAdd(playlist, s.id);
                setSelectedId(null);
              }}
              className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${
                isSelected ? "bg-amber-500/15" : "hover:bg-zinc-800/70"
              }`}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm text-zinc-200 truncate">{s.title}</p>
                <p className="text-xs text-zinc-500 truncate">{s.artist}</p>
              </div>
              <SourceBadges
                youtube={songHasYoutube(s)}
                spotify={songHasSpotify(s)}
                file={uploads.has(s.id)}
              />
              <span className="text-amber-400 text-sm font-bold flex-shrink-0">
                +
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}