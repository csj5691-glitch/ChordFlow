"use client";

import { useState, useCallback } from "react";
import { Search, X, ExternalLink, Link } from "lucide-react";

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

export default function SpotifySearch({
  artist,
  title,
  onSelect,
  onClose,
}: SpotifySearchProps) {
  const [urlInput, setUrlInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(() => {
    const spotifyUrl = extractSpotifyUrl(urlInput);
    if (spotifyUrl) {
      onSelect(spotifyUrl);
    } else {
      setError("URL invalide. Collez un lien Spotify (track, album, playlist...).");
    }
  }, [urlInput, onSelect]);

  const openSpotifySearch = () => {
    const query = encodeURIComponent(`${artist} ${title}`);
    window.open(`https://open.spotify.com/search/${query}`, "_blank");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
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
          <button
            onClick={openSpotifySearch}
            className="w-full flex items-center justify-center gap-2 p-3 bg-green-600 hover:bg-green-500 text-white rounded-xl font-medium transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
            Ouvrir Spotify pour &ldquo;{artist} - {title}&rdquo;
            <ExternalLink className="w-4 h-4" />
          </button>

          <div className="text-center text-zinc-500 text-xs">— ou —</div>

          <div>
            <label className="text-xs text-zinc-400 mb-1.5 block">
              Collez l&apos;URL Spotify de la chanson :
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                  type="text"
                  value={urlInput}
                  onChange={(e) => { setUrlInput(e.target.value); setError(null); }}
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg pl-10 pr-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:border-green-500/50 text-sm"
                  placeholder="https://open.spotify.com/track/..."
                />
              </div>
              <button
                onClick={handleSubmit}
                disabled={!urlInput.trim()}
                className="px-4 py-2.5 bg-green-500 hover:bg-green-400 disabled:bg-zinc-700 text-black disabled:text-zinc-500 rounded-lg font-medium text-sm transition-colors"
              >
                OK
              </button>
            </div>
            {error && (
              <p className="text-red-400 text-xs mt-2">{error}</p>
            )}
          </div>

          <div className="bg-zinc-800/50 rounded-lg p-3 text-xs text-zinc-500 space-y-1">
            <p className="font-medium text-zinc-400">Comment ça marche :</p>
            <p>1. Cliquez sur le bouton Spotify ci-dessus</p>
            <p>2. Trouvez la chanson et copiez son URL</p>
            <p>3. Collez-la ci-dessus et cliquez OK</p>
          </div>
        </div>
      </div>
    </div>
  );
}
