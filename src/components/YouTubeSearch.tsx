"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.


import { useState, useCallback } from "react";
import { X, ExternalLink, Link } from "lucide-react";

interface YouTubeSearchProps {
  artist: string;
  title: string;
  onSelect: (videoId: string) => void;
  onClose: () => void;
}

function extractVideoId(input: string): string | null {
  const trimmed = input.trim();

  const watchMatch = trimmed.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch) return watchMatch[1];

  const shortMatch = trimmed.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return shortMatch[1];

  const embedMatch = trimmed.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/);
  if (embedMatch) return embedMatch[1];

  const shortsMatch = trimmed.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/);
  if (shortsMatch) return shortsMatch[1];

  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

export default function YouTubeSearch({
  artist,
  title,
  onSelect,
  onClose,
}: YouTubeSearchProps) {
  const [urlInput, setUrlInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(() => {
    const videoId = extractVideoId(urlInput);
    if (videoId) {
      onSelect(videoId);
    } else {
      setError("URL invalide. Collez un lien YouTube ou un ID de vidéo.");
    }
  }, [urlInput, onSelect]);

  const openYouTubeSearch = () => {
    const query = encodeURIComponent(`${artist} ${title}`);
    window.open(`https://www.youtube.com/results?search_query=${query}`, "_blank");
  };

  return (
    <div className="yt-search fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-lg mx-4 overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <h3 className="text-lg font-bold text-white">Audio YouTube</h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-zinc-400" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <button
            onClick={openYouTubeSearch}
            className="w-full flex items-center justify-center gap-2 p-3 bg-red-600 hover:bg-red-500 text-white rounded-xl font-medium transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
            </svg>
            Ouvrir YouTube pour &ldquo;{artist} - {title}&rdquo;
            <ExternalLink className="w-4 h-4" />
          </button>

          <div className="text-center text-zinc-500 text-xs">— ou —</div>

          <div>
            <label className="text-xs text-zinc-400 mb-1.5 block">
              Collez l&apos;URL YouTube de la chanson :
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                  type="text"
                  value={urlInput}
                  onChange={(e) => { setUrlInput(e.target.value); setError(null); }}
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg pl-10 pr-4 py-2.5 text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500/50 text-sm"
                  placeholder="https://www.youtube.com/watch?v=..."
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
            {error && (
              <p className="text-red-400 text-xs mt-2">{error}</p>
            )}
          </div>

          <div className="bg-zinc-800/50 rounded-lg p-3 text-xs text-zinc-500 space-y-1">
            <p className="font-medium text-zinc-400">Comment ça marche :</p>
            <p>1. Cliquez sur le bouton YouTube ci-dessus</p>
            <p>2. Copiez l&apos;URL de la vidéo que vous voulez</p>
            <p>3. Collez-la ci-dessus et cliquez OK</p>
          </div>
        </div>
      </div>
    </div>
  );
}
