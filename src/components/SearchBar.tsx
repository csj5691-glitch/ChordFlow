"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.


import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, Download, Loader2 } from "lucide-react";
import { saveCustomSong, generateSongId } from "@/lib/custom-songs";

export default function SearchBar() {
  const [query, setQuery] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (query.trim()) {
        router.push(`/?q=${encodeURIComponent(query.trim())}`);
      }
    },
    [query, router]
  );

  const handleImportFromUg = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setImporting(true);
    setError(null);
    try {
      const res = await fetch(`/api/ug?query=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (res.ok && data.content) {
        saveCustomSong({
          id: generateSongId(),
          title: data.title || q,
          artist: data.artist || "",
          type: data.type || "Chords",
          content: data.content,
          key: data.key,
          tuning: data.tuning,
        });
        router.push("/");
      } else {
        setError(data.error || "Aucun accord trouvé sur Ultimate Guitar.");
      }
    } catch {
      setError("Impossible de contacter Ultimate Guitar.");
    } finally {
      setImporting(false);
    }
  }, [query, router]);

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-2xl">
      <div className="relative group">
        <div className="absolute inset-0 bg-gradient-to-r from-amber-500/20 via-emerald-500/20 to-amber-500/20 rounded-2xl blur-xl opacity-0 group-focus-within:opacity-100 transition-opacity duration-500" />
        <div className="relative flex items-center bg-zinc-800 border border-zinc-700 rounded-2xl overflow-hidden focus-within:border-amber-500/50 transition-colors">
          <Search className="ml-4 w-5 h-5 text-zinc-400 flex-shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un morceau... (ex: Wonderwall, Oasis)"
            className="flex-1 bg-transparent px-4 py-4 text-white placeholder-zinc-500 focus:outline-none text-lg"
          />
          <button
            type="submit"
            className="px-6 py-4 bg-amber-500 hover:bg-amber-400 text-black font-semibold transition-colors"
          >
            Chercher
          </button>
          {query.trim() && (
            <button
              type="button"
              onClick={handleImportFromUg}
              disabled={importing}
              className="flex items-center gap-1.5 px-4 py-4 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 text-white disabled:text-zinc-500 text-sm font-semibold transition-colors"
            >
              {importing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Download className="w-4 h-4" />
              )}
              {importing ? "Import..." : "Importer UG"}
            </button>
          )}
        </div>
      </div>
      {error && (
        <p className="mt-3 text-center text-xs text-red-400">{error}</p>
      )}
    </form>
  );
}
