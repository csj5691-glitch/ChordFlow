"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.


import { useRouter } from "next/navigation";
import { WifiOff } from "lucide-react";

export default function OfflinePage() {
  const router = useRouter();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-900">
        <WifiOff className="h-8 w-8 text-zinc-400" />
      </div>
      <div>
        <h1 className="text-xl font-semibold text-white">Vous êtes hors ligne</h1>
        <p className="mt-2 text-sm text-zinc-500">
          ChordFlow fonctionne hors ligne, mais cette page n&rsquo;est pas encore
          dans le cache. Reconnectez-vous et réessayez.
        </p>
      </div>
      <button
        onClick={() => router.refresh()}
        className="rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-200 hover:bg-zinc-700"
      >
        Réessayer
      </button>
    </div>
  );
}
