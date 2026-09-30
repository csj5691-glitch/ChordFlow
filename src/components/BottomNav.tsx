// Copyright (c) 2026 Claude St-Jean. All rights reserved.

"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, BookOpen, Edit3, Home, ListMusic } from "lucide-react";
import { generateSongId, saveLocalSong } from "@/lib/custom-songs";
import { SongTab } from "@/lib/types";

export default function BottomNav() {
  const router = useRouter();

  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  };

  const handleEditor = async () => {
    const id = generateSongId();
    const song: SongTab = {
      id,
      title: "",
      artist: "",
      type: "Chords",
      content: "",
      officialPlain: "",
      officialSynced: "",
    };
    await saveLocalSong(song);
    router.push(`/song/${id}/edit`);
  };

  return (
    <nav className="sticky bottom-0 z-20 border-t border-zinc-800 bg-black/90 backdrop-blur-lg pb-[env(safe-area-inset-bottom)]">
      <div className="max-w-5xl mx-auto flex items-stretch">
        <button
          onClick={() => router.push("/")}
          className="flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 py-3 sm:py-4 text-zinc-300 hover:text-white hover:bg-zinc-900/60 transition-colors"
        >
          <Home className="w-5 h-5" />
          <span className="text-[11px] sm:text-sm font-medium">Accueil</span>
        </button>
        <div className="w-px bg-zinc-800 my-2" />
        <button
          onClick={handleEditor}
          className="flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 py-3 sm:py-4 text-zinc-300 hover:text-white hover:bg-zinc-900/60 transition-colors"
        >
          <Edit3 className="w-5 h-5" />
          <span className="text-[11px] sm:text-sm font-medium">Éditeur</span>
        </button>
        <div className="w-px bg-zinc-800 my-2" />
        <button
          onClick={() => router.push("/dico")}
          className="flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 py-3 sm:py-4 text-zinc-300 hover:text-white hover:bg-zinc-900/60 transition-colors"
        >
          <BookOpen className="w-5 h-5" />
          <span className="text-[11px] sm:text-sm font-medium">Accords</span>
        </button>
        <div className="w-px bg-zinc-800 my-2" />
        <button
          onClick={() => router.push("/playlists")}
          className="flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 py-3 sm:py-4 text-zinc-300 hover:text-white hover:bg-zinc-900/60 transition-colors"
        >
          <ListMusic className="w-5 h-5" />
          <span className="text-[11px] sm:text-sm font-medium">Playlists</span>
        </button>
        <div className="w-px bg-zinc-800 my-2" />
        <button
          onClick={handleBack}
          className="flex-1 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 py-3 sm:py-4 text-zinc-300 hover:text-white hover:bg-zinc-900/60 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="text-[11px] sm:text-sm font-medium">Retour</span>
        </button>
      </div>
    </nav>
  );
}
