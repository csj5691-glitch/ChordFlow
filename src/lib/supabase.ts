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

const PAGE = 1000;

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

// Une page Supabase (max 1000 lignes) avec reprises automatiques : une declaration
// de timeout serveur (statement timeout, code 57014) est souvent transiente
// (projet en veille / surcharge momentanee), une nouvelle tentative reussit en
// general. Backoff exponentiel pour laisser le temps au projet de se reveiller.
async function fetchSongsPage(
  sb: SupabaseClient,
  from: number,
  ordered: boolean
): Promise<{ data: { data: unknown }[] | null; error: { message: string; code: string } | null }> {
  const MAX_ATTEMPTS = 5;
  let lastError: { message: string; code: string } | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, attempt - 1)));
    }
    let q = sb.from("songs").select("data");
    if (ordered) {
      q = q.order("updated_at", { ascending: false }).order("id", { ascending: true });
    }
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (!error) {
      return { data: (data as { data: unknown }[] | null) ?? [], error: null };
    }
    lastError = { message: error.message, code: error.code };
    console.log("[ChordFlow] repertoire : erreur Supabase requete", {
      from,
      message: error.message,
      code: error.code,
      attempt: attempt + 1,
      ordered,
    });
  }
  return { data: null, error: lastError };
}

export async function loadSharedSongs(): Promise<SongTab[]> {
  const sb = getSupabase();
  if (!sb) return loadLocalSongs();
  const migrated: SongTab[] = [];
  const seen = new Set<string>();

  // Première page : tentative ordonnée, puis repli sans tri (le tri se fait
  // alors cote client) si toutes les tentatives ordonnees echouent.
  let ordered = true;
  let first = await fetchSongsPage(sb, 0, true);
  if (first.error) {
    console.log("[ChordFlow] repertoire : tentative sans tri...");
    first = await fetchSongsPage(sb, 0, false);
    ordered = false;
  }
  if (first.error || !first.data) {
    // Echec total : repli sur le repertoire local.
    return loadLocalSongs();
  }

  const processPage = async (rows: { data: unknown }[]) => {
    for (const r of rows) {
      const s = r.data as SongTab;
      if (typeof s !== "object" || s === null || !s.id) continue;
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      const m = migrateSong(s);
      migrated.push(m);
      if (m !== s) {
        await sb.from("songs").upsert(
          {
            id: m.id,
            title: m.title,
            artist: m.artist,
            data: m,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "id" }
        );
      }
    }
  };

  await processPage(first.data);

  // Pages suivantes (meme mode de tri que la premiere).
  let from = PAGE;
  let lastSize = first.data.length;
  while (lastSize === PAGE) {
    const { data, error } = await fetchSongsPage(sb, from, ordered);
    if (error || !data || data.length === 0) break;
    await processPage(data);
    lastSize = data.length;
    from += PAGE;
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
    data: song,
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from("songs").upsert(row, { onConflict: "id" });
  if (error) throw new Error(error.message || "Echec de l'enregistrement Supabase");
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
