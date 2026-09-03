// Copyright (c) 2026 Claude St-Jean. All rights reserved.

const DB_NAME = "chordflow-audio";
const STORE = "stems";
const DB_VERSION = 1;

export interface AudioStemBlobs {
  noVocals: Blob | null;
  vocals: Blob | null;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
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
  return dbPromise;
}

export function saveAudioStem(
  songId: string,
  kind: "noVocals" | "vocals",
  blob: Blob | null
): Promise<void> {
  return getDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        const store = tx.objectStore(STORE);
        store.get(songId).onsuccess = (ev) => {
          const existing = (ev.target as IDBRequest).result as
            | Partial<AudioStemBlobs>
            | undefined;
          const next: Partial<AudioStemBlobs> = { ...(existing || {}) };
          if (blob) {
            next[kind] = blob;
          } else {
            delete next[kind];
          }
          store.put(next, songId);
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}

export function loadAudioStems(songId: string): Promise<AudioStemBlobs | null> {
  return getDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const store = tx.objectStore(STORE);
        const req = store.get(songId);
        req.onsuccess = () => {
          const result = req.result as AudioStemBlobs | null;
          resolve(
            result && (result.noVocals || result.vocals) ? result : null
          );
        };
        req.onerror = () => reject(req.error);
      })
  );
}

export function getAudioStemUrl(blob: Blob | null): string | null {
  return blob ? URL.createObjectURL(blob) : null;
}

export function clearAudioStems(songId: string): Promise<void> {
  return getDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(songId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      })
  );
}
