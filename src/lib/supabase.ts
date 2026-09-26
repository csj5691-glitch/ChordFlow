// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { SongTab } from "./types";
import {
  getCustomSongs as getLocalSongs,
  saveCustomSong as saveLocalSong,
  deleteCustomSong as deleteLocalSong,
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
  if (!sb) return getLocalSongs();
  const { data, error } = await sb.from("songs").select("data").order("updated_at", { ascending: false });
  if (error) return getLocalSongs();
  const rows = (data as { data: unknown }[] | null) ?? [];
  const migrated: SongTab[] = [];
  for (const r of rows) {
    const s = r.data as SongTab;
    if (typeof s !== "object" || s === null || !s.id) continue;
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
  return migrated;
}

export async function saveSharedSong(song: SongTab): Promise<string[]> {
  const sb = getSupabase();
  let drops: string[] = [];
  try {
    drops = saveLocalSong(song);
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
  deleteLocalSong(id);
  if (!sb) return;
  await sb.from("songs").delete().eq("id", id);
}

export async function importAllLocalSongs(): Promise<number> {
  const sb = getSupabase();
  const local = getLocalSongs();
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
