// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { SongTab } from "./types";
import {
  loadLocalSongs,
  loadLocalSong,
  saveLocalSong,
  deleteLocalSong,
  migrateSong,
} from "./custom-songs";


const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let client: SupabaseClient | null = null;

// Délai maximal d'une requête Supabase. Sans ça, une requête qui n'aboutit pas
// (réseau, projet en veille) bloque indéfiniment l'appelant (ex. la fusion des
// doublons restait figée sur une chanson).
const REQUEST_TIMEOUT_MS = 20000;

export const SUPABASE_TIMEOUT_ERROR = "SupabaseTimeout";

const fetchWithTimeout: typeof fetch = (input, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const signal = init?.signal
    ? AbortSignal.any([init.signal, controller.signal])
    : controller.signal;
  return fetch(input, { ...init, signal }).finally(() => clearTimeout(timer));
};

export function getSupabase(): SupabaseClient | null {
  if (client) return client;
  if (!url || !key) return null;
  client = createClient(url, key, {
    realtime: { params: { eventsPerSecond: 10 } },
    global: { fetch: fetchWithTimeout },
  });
  return client;
}

// Vrai si l'erreur vient d'une requête restée sans réponse.
export function isSupabaseTimeout(error: unknown): boolean {
  if (!error) return false;
  const message =
    error instanceof Error ? error.message : String(error);
  return (
    /abort/i.test(message) ||
    /timeout/i.test(message) ||
    message === SUPABASE_TIMEOUT_ERROR
  );
}

export interface SharedRow {
  id: string;
  title: string;
  artist: string;
  data: unknown;
  updated_at: string;
}


export async function loadSharedSongs(): Promise<SongTab[]> {
  const sb = getSupabase();
  if (!sb) return loadLocalSongs();
  const PAGE = 1000;
  const migrated: SongTab[] = [];
  const seen = new Set<string>();

  // Requete legere : on ne transfere que id/title/artist (pas le gros JSON
  // "data"), ce qui evite le statement timeout (57014) sur les gros
  // repertoires. Le contenu complet est charge a la demande via
  // loadSharedSong(id) quand l'utilisateur ouvre une chanson.
  async function fetchLightweight(from: number): Promise<{ data: { id: string; title: string; artist: string; key?: string; capo?: number; youtube_id?: string; spotify_id?: string }[] | null; error: { message: string; code: string } | null }> {
    const { data, error } = await sb!
      .from("songs")
      .select("id,title,artist,key,capo,youtube_id,spotify_id")
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return { data: null, error: { message: error.message, code: error.code } };
    return { data: (data as { id: string; title: string; artist: string }[] | null) ?? [], error: null };
  }

  // Requete lourde (fallback) : transfere le JSON complet.
  async function fetchHeavy(from: number): Promise<{ data: { data: unknown }[] | null; error: { message: string; code: string } | null }> {
    const { data, error } = await sb!
      .from("songs")
      .select("data")
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return { data: null, error: { message: error.message, code: error.code } };
    return { data: (data as { data: unknown }[] | null) ?? [], error: null };
  }

  // Essai 1 : requete legere (3 tentatives)
  let lightRows: { id: string; title: string; artist: string; key?: string; capo?: number; youtube_id?: string; spotify_id?: string }[] | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2000 * attempt));
    const res = await fetchLightweight(0);
    if (!res.error) { lightRows = res.data; break; }
    console.log("[ChordFlow] repertoire : erreur legere", res.error);
  }

  if (lightRows === null) {
    // Repli : requete lourde (comportement original)
    console.log("[ChordFlow] repertoire : repli sur requete lourde");
    const res = await fetchHeavy(0);
    if (res.error || !res.data) return loadLocalSongs();
    for (const r of res.data) {
      const s = r.data as SongTab;
      if (typeof s !== "object" || s === null || !s.id) continue;
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      migrated.push(migrateSong(s));
    }
    let from = PAGE;
    while (true) {
      const r2 = await fetchHeavy(from);
      if (r2.error || !r2.data || r2.data.length === 0) break;
      for (const r of r2.data) {
        const s = r.data as SongTab;
        if (typeof s !== "object" || s === null || !s.id) continue;
        if (seen.has(s.id)) continue;
        seen.add(s.id);
        migrated.push(migrateSong(s));
      }
      if (r2.data.length < PAGE) break;
      from += PAGE;
    }
    return migrated;
  }

  // Mode leger : recuperer toutes les pages
  const allLight: { id: string; title: string; artist: string; key?: string; capo?: number; youtube_id?: string; spotify_id?: string }[] = [...lightRows];
  let from = PAGE;
  while (lightRows.length === PAGE) {
    const r2 = await fetchLightweight(from);
    if (r2.error || !r2.data || r2.data.length === 0) break;
    allLight.push(...r2.data);
    if (r2.data.length < PAGE) break;
    from += PAGE;
  }

  for (const r of allLight) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    migrated.push({
      id: r.id,
      title: r.title || r.id,
      artist: r.artist || "",
      type: "chord",
      content: "",
      key: r.key,
      capo: r.capo,
      youtubeId: r.youtube_id,
      spotifyId: r.spotify_id,
    } as SongTab);
  }
  return migrated;
}
export async function loadSharedSong(id: string): Promise<SongTab | null> {
  const sb = getSupabase();
  if (!sb) return loadLocalSong(id);
  const { data, error } = await sb
    .from("songs")
    .select("data")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.log("[ChordFlow] chanson : erreur Supabase requete", {
      id,
      message: error.message,
      code: error.code,
    });
    return loadLocalSong(id);
  }
  const s = (data as { data: unknown } | null)?.data as SongTab | undefined;
  if (!s || typeof s !== "object" || !s.id) return loadLocalSong(id);
  return migrateSong(s);
}

export async function saveSharedSong(song: SongTab): Promise<string[]> {
  const sb = getSupabase();
  let drops: string[] = [];
  try {
    drops = await saveLocalSong(song);
  } catch (err) {
    console.warn(
      "[ChordFlow] Stockage local saturé, sauvegarde serveur uniquement.",
      err
    );
  }
  if (!sb) return drops;
  const row = {
    id: song.id,
    title: song.title,
    artist: song.artist,
    key: song.key,
    capo: song.capo,
    youtube_id: song.youtubeId,
    spotify_id: song.spotifyId,
    data: song,
    updated_at: new Date().toISOString(),
  };
  // Synchronisation serveur en best-effort : le local fait foi. Si Supabase est
  // lent (cold start, 20 s+), on ne bloque pas l'utilisateur : la chanson est
  // deja sauvegardee localement et sera resynchronisee plus tard.
  try {
    const { error } = await sb.from("songs").upsert(row, { onConflict: "id" });
    if (error) {
      console.warn("[ChordFlow] Sauvegarde serveur echouee (local OK) :", error.message);
    }
  } catch (err) {
    console.warn("[ChordFlow] Sauvegarde serveur echouee (local OK) :", err);
  }
  return drops;
}

export async function deleteSharedSong(id: string): Promise<void> {
  const sb = getSupabase();
  await deleteLocalSong(id);
  if (!sb) return;
  const { error } = await sb.from("songs").delete().eq("id", id);
  if (error) throw new Error(error.message || "Echec de la suppression Supabase");
}

export async function importAllLocalSongs(): Promise<number> {
  const sb = getSupabase();
  const local = await loadLocalSongs();
  if (!sb || local.length === 0) return local.length;
  const rows = local.map((s) => ({
    id: s.id,
    title: s.title,
    artist: s.artist,
    data: s,
    updated_at: new Date().toISOString(),
  }));
  await sb.from("songs").upsert(rows, { onConflict: "id" });
  return rows.length;
}
