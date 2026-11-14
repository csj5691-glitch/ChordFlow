// Copyright (c) 2026 Claude St-Jean. All rights reserved.

// Stockage local (IndexedDB) de l'audio utilise pour le calage des paroles
// dans la page /song/[id]/lyrics. Permet a l'audio de survivre au
// rafraichissement de la page.

const DB_NAME = "chordflow-lyrics-audio";
const STORE = "audio";
const DB_VERSION = 1;

function getDB(): Promise<IDBDatabase> {
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
  });
}

export async function saveLyricsAudio(songId: string, blob: Blob | null): Promise<void> {
  console.log("[lyrics-audio] save start", songId, blob?.size);
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    if (blob) {
      store.put(blob, songId);
    } else {
      store.delete(songId);
    }
    tx.oncomplete = () => {
      console.log("[lyrics-audio] save complete", songId);
      resolve();
    };
    tx.onerror = () => {
      console.error("[lyrics-audio] save error", tx.error);
      reject(tx.error);
    };
  });
}

export async function loadLyricsAudio(songId: string): Promise<Blob | null> {
  console.log("[lyrics-audio] load start", songId);
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(songId);
    req.onsuccess = () => {
      const result = (req.result as Blob) || null;
      console.log("[lyrics-audio] load result", songId, result?.size ?? "null");
      resolve(result);
    };
    req.onerror = () => {
      console.error("[lyrics-audio] load error", req.error);
      reject(req.error);
    };
  });
}