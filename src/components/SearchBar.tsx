"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

export default function SearchBar() {
  const [query, setQuery] = useState("");
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
        </div>
      </div>
    </form>
  );
}
