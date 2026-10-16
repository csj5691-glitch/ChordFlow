// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { getSupabase } from "./supabase";

const DEVICE_KEY = "chordflow-device-id";
const LOCAL_KEY = "chordflow-home-scroll";
const TABLE = "ui_state";

let lastY = 0;
let saveTimer: number | null = null;

function deviceId(): string {
  if (typeof window === "undefined") return "server";
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "server";
  }
}

function rowId(): string {
  return `home-scroll:${deviceId()}`;
}

function readLocal(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw =
      sessionStorage.getItem(LOCAL_KEY) ?? localStorage.getItem(LOCAL_KEY);
    const n = Number(raw || "0");
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function writeLocal(y: number): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(LOCAL_KEY, String(y));
  } catch {
    /* ignore */
  }
  try {
    localStorage.setItem(LOCAL_KEY, String(y));
  } catch {
    /* ignore */
  }
}

async function persistToSupabase(y: number): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  try {
    await sb
      .from(TABLE)
      .upsert(
        { id: rowId(), value: { y }, updated_at: new Date().toISOString() },
        { onConflict: "id" }
      );
  } catch {
    /* table absente ou hors ligne : repli local seulement */
  }
}

// Écrit en local immédiatement, puis diflue vers Supabase (débondé).
export function saveHomeScroll(y: number): void {
  lastY = y;
  writeLocal(y);
  if (typeof window === "undefined") return;
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    void persistToSupabase(lastY);
  }, 700);
}

export async function loadHomeScroll(): Promise<number> {
  const sb = getSupabase();
  if (sb) {
    try {
      const { data, error } = await sb
        .from(TABLE)
        .select("value")
        .eq("id", rowId())
        .maybeSingle();
      const value = data?.value as { y?: unknown } | null | undefined;
      if (!error && value && typeof value.y === "number") {
        writeLocal(value.y);
        return value.y;
      }
    } catch {
      /* repli local */
    }
  }
  return readLocal();
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
      void persistToSupabase(lastY);
    }
  });
}
