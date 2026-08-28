"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.


import { useRouter } from "next/navigation";
import { SongResult } from "@/lib/types";

interface SongCardProps {
  song: SongResult;
}

const DIFFICULTY_COLORS: Record<string, string> = {
  Beginner: "text-emerald-400 bg-emerald-400/10",
  Intermediate: "text-amber-400 bg-amber-400/10",
  Advanced: "text-red-400 bg-red-400/10",
};

export default function SongCard({ song }: SongCardProps) {
  const router = useRouter();

  return (
    <div
      onClick={() => router.push(`/song/${song.id}`)}
      className="group cursor-pointer p-5 bg-zinc-800/50 border border-zinc-700/50 rounded-xl hover:border-amber-500/30 hover:bg-zinc-800 transition-all duration-200"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-white group-hover:text-amber-400 transition-colors truncate">
            {song.title}
          </h3>
          <p className="text-sm text-zinc-400 mt-0.5">{song.artist}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span
            className={`text-xs font-medium px-2 py-1 rounded-full ${
              DIFFICULTY_COLORS[song.difficulty || "Beginner"] ||
              DIFFICULTY_COLORS.Beginner
            }`}
          >
            {song.difficulty || "N/A"}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-4 mt-3 text-sm text-zinc-500">
        <span className="flex items-center gap-1">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" />
          </svg>
          {song.type}
        </span>
        <span className="flex items-center gap-1">
          <svg className="w-4 h-4 fill-amber-400" viewBox="0 0 24 24">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
          {song.rating.toFixed(1)}
        </span>
      </div>
    </div>
  );
}
