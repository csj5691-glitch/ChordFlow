// Copyright (c) 2026 Claude St-Jean. All rights reserved.

"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, Home, ListMusic } from "lucide-react";

export default function BottomNav() {
  const router = useRouter();

  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  };

  return (
    <nav className="sticky bottom-0 z-20 border-t border-zinc-800 bg-black/90 backdrop-blur-lg">
      <div className="max-w-5xl mx-auto flex items-stretch">
        <button
          onClick={() => router.push("/")}
          className="flex-1 flex items-center justify-center gap-2 py-4 text-zinc-300 hover:text-white hover:bg-zinc-900/60 transition-colors"
        >
          <Home className="w-5 h-5" />
          <span className="text-sm font-medium">Accueil</span>
        </button>
        <div className="w-px bg-zinc-800 my-2" />
        <button
          onClick={() => router.push("/playlists")}
          className="flex-1 flex items-center justify-center gap-2 py-4 text-zinc-300 hover:text-white hover:bg-zinc-900/60 transition-colors"
        >
          <ListMusic className="w-5 h-5" />
          <span className="text-sm font-medium">Playlists</span>
        </button>
        <div className="w-px bg-zinc-800 my-2" />
        <button
          onClick={handleBack}
          className="flex-1 flex items-center justify-center gap-2 py-4 text-zinc-300 hover:text-white hover:bg-zinc-900/60 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="text-sm font-medium">Retour</span>
        </button>
      </div>
    </nav>
  );
}
