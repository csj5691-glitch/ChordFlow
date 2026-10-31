// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { SongTab } from "./types";
import {
  loadLocalSongs,
  saveLocalSong,
  deleteLocalSong,
  migrateSong,
} from "./custom-songs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (client) return client;
  if (!url || !key) return null;
  client = createClient(url, key, {
    realtime: { params: { eventsPerSecond: 10 } },
  });
  return client;
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
  // Supabase plafonne une requête à 1000 lignes : paginer pour ne pas
  // tronquer le répertoire (les chansons au-delà de 1000 disparaissaient).
  const PAGE = 1000;
  const migrated: SongTab[] = [];
  const seen = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("songs")
      .select("data")
      .order("updated_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      if (from === 0) return loadLocalSongs();
      break;
    }
    const rows = (data as { data: unknown }[] | null) ?? [];
    if (rows.length === 0) break;
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
    if (rows.length < PAGE) break;
  }
  return migrated;
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
  await sb.from("songs").upsert(row, { onConflict: "id" });
  return drops;
}

export async function deleteSharedSong(id: string): Promise<void> {
  const sb = getSupabase();
  await deleteLocalSong(id);
  if (!sb) return;
  await sb.from("songs").delete().eq("id", id);
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
