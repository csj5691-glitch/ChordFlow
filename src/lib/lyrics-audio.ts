// Copyright (c) 2026 Claude St-Jean. All rights reserved.

// Stockage local (IndexedDB) de l'audio utilise pour le calage des paroles
// dans la page /song/[id]/lyrics. Permet a l'audio de survivre au
// rafraichissement de la page.

const DB_NAME = "chordflow-lyrics-audio";
const STORE = "audio";
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => {
      console.warn("[lyrics-audio] DB open blocked");
      reject(new Error("DB open blocked"));
    };
  });
}

export async function saveLyricsAudio(songId: string, blob: Blob | null): Promise<void> {
  console.log("[lyrics-audio] save start", songId, blob?.size);
  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      if (blob) {
        store.put(blob, songId);
      } else {
        store.delete(songId);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("tx aborted"));
    });
    console.log("[lyrics-audio] save complete", songId);
  } finally {
    db.close();
  }
}

export async function loadLyricsAudio(songId: string): Promise<Blob | null> {
  console.log("[lyrics-audio] load start", songId);
  const db = await openDB();
  try {
    const result = await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(songId);
      req.onsuccess = () => resolve((req.result as Blob) || null);
      req.onerror = () => reject(req.error);
      tx.onabort = () => reject(tx.error || new Error("tx aborted"));
    });
    console.log("[lyrics-audio] load result", songId, result?.size ?? "null");
    return result;
  } finally {
    db.close();
  }
}