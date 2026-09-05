"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { Suspense, useEffect, useState } from "react";
import {
  decodeState,
  exchangeCode,
  getReturnPath,
  getValidToken,
} from "@/lib/spotify-auth";

function CallbackBody() {
  const [status, setStatus] = useState<string>("Connexion à Spotify...");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const error = params.get("error");
    const decoded = decodeState(params.get("state"));
    const returnPath = decoded?.r ?? getReturnPath() ?? "/";

    const finish = (ms: number) => {
      window.sessionStorage.removeItem("chordflow-spotify-return");
      setTimeout(() => {
        window.location.assign(`${window.location.origin}${returnPath}`);
      }, ms);
    };

    if (error) {
      setStatus("Connexion annulée ou refusée par Spotify.");
      finish(1500);
      return;
    }

    if (!code) {
      setStatus("Aucun code d'autorisation reçu.");
      finish(1500);
      return;
    }

    if (window.location.hostname === "127.0.0.1") {
      const port = window.location.port || "3000";
      window.location.replace(
        `http://localhost:${port}/auth/callback?${params.toString()}`
      );
      return;
    }

    (async () => {
      try {
        await exchangeCode(code, decoded?.v ?? null);
        await getValidToken();
        setStatus("Connecté à Spotify !");
      } catch (e) {
        setStatus(
          `Erreur de connexion : ${e instanceof Error ? e.message : "inconnue"}`
        );
      }
      finish(800);
    })();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950">
      <div className="text-center p-8">
        <div className="inline-flex items-center gap-3">
          <span className="w-5 h-5 rounded-full bg-green-500 animate-pulse" />
          <p className="text-zinc-300 font-medium">{status}</p>
        </div>
      </div>
    </div>
  );
}

export default function AuthCallback() {
  return (
    <Suspense fallback={<p className="text-zinc-500 p-8">Chargement...</p>}>
      <CallbackBody />
    </Suspense>
  );
}