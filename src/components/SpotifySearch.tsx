"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { useCallback, useEffect, useState } from "react";
import { X, ExternalLink, Link, Search, Loader2 } from "lucide-react";
import { authorize, getValidToken, isLoggedIn } from "@/lib/spotify-auth";

interface SpotifyTrackItem {
  id: string;
  uri: string;
  name: string;
  artists: { name: string }[];
  album: { name: string };
  duration_ms: number;
}

interface SpotifySearchProps {
  artist: string;
  title: string;
  onSelect: (trackUrl: string) => void;
  onClose: () => void;
}

function extractSpotifyUrl(input: string): string | null {
  const trimmed = input.trim();

  if (/open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(track|album|playlist|episode|show)\/[a-zA-Z0-9]+/.test(trimmed)) {
    return trimmed;
  }

  if (/^spotify:(track|album|playlist|episode|show):[a-zA-Z0-9]+$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function SpotifySearch({
  artist,
  title,
  onSelect,
  onClose,
}: SpotifySearchProps) {
  const [query, setQuery] = useState(`${artist} ${title}`.trim());
  const [urlInput, setUrlInput] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [results, setResults] = useState<SpotifyTrackItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    setLoggedIn(isLoggedIn());
  }, []);

  const runSearch = useCallback(async (q: string) => {
    const token = await getValidToken();
    if (!token) {
      setLoggedIn(false);
      setSearchError("Connectez votre compte Spotify pour rechercher.");
      return;
    }
    setLoading(true);
    setSearchError(null);
    try {
      const res = await fetch(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(q)}&type=track&limit=12`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.status === 401 || res.status === 403) {
        setLoggedIn(false);
        setSearchError("Session Spotify expirée. Reconnectez-vous.");
        return;
      }
      if (!res.ok) {
        setSearchError(`Erreur de recherche Spotify (${res.status}).`);
        return;
      }
      const data = await res.json();
      setResults(data?.tracks?.items ?? []);
    } catch {
      setSearchError("Impossible d'interroger Spotify.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    runSearch(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = () => {
    const spotifyUrl = extractSpotifyUrl(urlInput);
    if (spotifyUrl) {
      onSelect(spotifyUrl);
    } else {
      setUrlError(
        "URL invalide. Collez un lien Spotify (track, album, playlist...)."
      );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm overflow-y-auto py-8">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-lg mx-4 overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <h3 className="text-lg font-bold text-white">Audio Spotify</h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-zinc-400" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {!loggedIn ? (
            <div>
              <p className="text-sm text-zinc-400 mb-3">
                Connectez votre compte Spotify pour chercher
                «&nbsp;{artist} - {title}&nbsp;» directement ici.
              </p>
              <button
                onClick={() => authorize(typeof window !== "undefined" ? window.location.pathname : "/")}
                className="w-full flex items-center justify-center gap-2 p-3 bg-green-600 hover:bg-green-500 text-white rounded-xl font-medium transition-colors"
              >
                <Search className="w-4 h-4" />
                Connecter mon compte Spotify
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && runSearch(query)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg pl-10 pr-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:border-green-500/50 text-sm"
                    placeholder="Artiste - Titre"
                  />
                </div>
                <button
                  onClick={() => runSearch(query)}
                  disabled={loading || !query.trim()}
                  className="px-4 py-2.5 bg-green-500 hover:bg-green-400 disabled:bg-zinc-700 text-black disabled:text-zinc-500 rounded-lg font-medium text-sm transition-colors"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "Rechercher"
                  )}
                </button>
              </div>

              {searchError && (
                <p className="text-red-400 text-xs">{searchError}</p>
              )}

              {results && results.length > 0 && (
                <div className="max-h-72 overflow-y-auto space-y-1.5 pr-1">
                  {results.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => onSelect(item.uri)}
                      className="w-full flex items-center gap-3 p-2.5 bg-zinc-800/60 hover:bg-green-600/20 border border-zinc-700/50 rounded-lg transition-colors text-left"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">
                          {item.name}
                        </p>
                        <p className="text-xs text-zinc-500 truncate">
                          {item.artists.map((a) => a.name).join(", ")} ·{" "}
                          {item.album.name}
                        </p>
                      </div>
                      <span className="text-xs text-zinc-500 flex-shrink-0">
                        {formatDuration(item.duration_ms)}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {results && results.length === 0 && !loading && (
                <p className="text-zinc-500 text-sm">
                  Aucun résultat pour «&nbsp;{query}&nbsp;».
                </p>
              )}
            </div>
          )}

          <div className="text-center text-zinc-500 text-xs">— ou —</div>

          <button
            onClick={() => {
              const q = encodeURIComponent(`${artist} ${title}`);
              window.open(`https://open.spotify.com/search/${q}`, "_blank");
            }}
            className="w-full flex items-center justify-center gap-2 p-3 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl font-medium transition-colors"
          >
            Ouvrir la recherche Spotify dans un onglet
            <ExternalLink className="w-4 h-4" />
          </button>

          <div>
            <label className="text-xs text-zinc-400 mb-1.5 block">
              …ou collez directement un lien Spotify :
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                  type="text"
                  value={urlInput}
                  onChange={(e) => {
                    setUrlInput(e.target.value);
                    setUrlError(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg pl-10 pr-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:border-green-500/50 text-sm"
                  placeholder="https://open.spotify.com/track/..."
                />
              </div>
              <button
                onClick={handleSubmit}
                disabled={!urlInput.trim()}
                className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 text-black disabled:text-zinc-500 rounded-lg font-medium text-sm transition-colors"
              >
                OK
              </button>
            </div>
            {urlError && <p className="text-red-400 text-xs mt-2">{urlError}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}