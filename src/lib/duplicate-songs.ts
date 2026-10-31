// Copyright (c) 2026 Claude St-Jean. All rights reserved.

// Fusion des chansons en double : même titre + même artiste (insensible à la
// casse, aux accents et aux espaces). On conserve la fiche la plus complète et
// on complète ses champs manquants avec les autres, puis on supprime les
// doublons (Supabase + IndexedDB + annotations locales).

import { SongTab } from "./types";
import {
  loadAudioStems,
  saveAudioStem,
  loadMidiBlob,
} from "./audio-store";
import { loadStems, saveStem } from "./stems-db";
import {
  loadYouTubeId,
  saveYouTubeId,
  removeYouTubeId,
} from "./youtube-store";
import {
  loadSpotifyId,
  saveSpotifyId,
  removeSpotifyId,
} from "./spotify-store";
import {
  loadLineChords,
  saveLineChords,
  loadLineSpacers,
  saveLineSpacers,
  loadExtraChordLines,
  saveExtraChordLines,
  deleteLocalSong,
} from "./custom-songs";

export function normalizeSongText(value: string | undefined): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019\u201b]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function songDuplicateKey(song: SongTab): string | null {
  const title = normalizeSongText(song.title);
  const artist = normalizeSongText(song.artist);
  if (!title || !artist) return null;
  return `${title}||${artist}`;
}

// Groupes de chansons qui partagent le même titre et le même artiste.
export function findDuplicateGroups(songs: SongTab[]): SongTab[][] {
  const byKey = new Map<string, SongTab[]>();
  const seen = new Set<string>();
  for (const song of songs) {
    const key = songDuplicateKey(song);
    if (!key) continue;
    if (seen.has(song.id)) continue;
    seen.add(song.id);
    const group = byKey.get(key);
    if (group) group.push(song);
    else byKey.set(key, [song]);
  }
  return [...byKey.values()].filter((g) => g.length > 1);
}

function richness(song: SongTab): number {
  return (
    (song.content?.length ?? 0) +
    (song.officialPlain?.length ?? 0) +
    (song.officialSynced?.length ?? 0) +
    (song.sections?.length ?? 0) * 50 +
    (song.diagrams?.length ?? 0) * 100 +
    (song.mainDiagrams?.length ?? 0) * 50 +
    (song.gpTracks?.length ?? 0) * 100 +
    (song.youtubeId ? 30 : 0) +
    (song.spotifyId ? 10 : 0) +
    (typeof song.capo === "number" ? 5 : 0) +
    (song.key ? 5 : 0) +
    (song.tuning ? 5 : 0) +
    (song.bpm ? 5 : 0)
  );
}

function longestString(values: (string | undefined)[]): string {
  let best = "";
  for (const v of values) {
    if (typeof v === "string" && v.length > best.length) best = v;
  }
  return best;
}

function longestArray<T>(values: (T[] | undefined)[]): T[] | undefined {
  let best: T[] | undefined;
  for (const v of values) {
    if (Array.isArray(v) && (!best || v.length > best.length)) best = v;
  }
  return best;
}

// Fiche fusionnée : garde l'id de la fiche la plus complète, complète les
// champs vides avec les autres doublons.
export function mergeSongGroup(group: SongTab[]): SongTab {
  const sorted = [...group].sort((a, b) => richness(b) - richness(a));
  const kept = sorted[0];
  const merged: SongTab = { ...kept };

  const content = longestString(group.map((s) => s.content));
  if (content) merged.content = content;
  const officialPlain = longestString(group.map((s) => s.officialPlain));
  if (officialPlain) merged.officialPlain = officialPlain;
  const officialSynced = longestString(group.map((s) => s.officialSynced));
  if (officialSynced) merged.officialSynced = officialSynced;

  const diagrams = longestArray(group.map((s) => s.diagrams));
  if (diagrams?.length) merged.diagrams = diagrams;
  const mainDiagrams = longestArray(group.map((s) => s.mainDiagrams));
  if (mainDiagrams?.length) merged.mainDiagrams = mainDiagrams;
  const sections = longestArray(group.map((s) => s.sections));
  if (sections?.length) merged.sections = sections;
  const gpTracks = longestArray(group.map((s) => s.gpTracks));
  if (gpTracks?.length) merged.gpTracks = gpTracks;

  const informative = group.filter((s) => (s.content?.length ?? 0) >= 100);
  const hasValue = <K extends keyof SongTab>(s: SongTab, field: K): boolean =>
    s[field] !== undefined && s[field] !== null && (s[field] as unknown) !== "";
  const pick = <K extends keyof SongTab>(field: K): SongTab[K] | undefined => {
    if (hasValue(kept, field)) return kept[field];
    const fromReal = informative.find((s) => hasValue(s, field));
    if (fromReal) return fromReal[field];
    return group.find((s) => hasValue(s, field))?.[field];
  };

  merged.youtubeId = pick("youtubeId");
  merged.spotifyId = pick("spotifyId");
  merged.capo = pick("capo");
  merged.tuning = pick("tuning");
  merged.key = pick("key");
  merged.bpm = pick("bpm");
  merged.timeSignature = pick("timeSignature");
  merged.lyricAnchorDiagram = pick("lyricAnchorDiagram");

  return merged;
}

// Copie les ressources locales du doublon (stems, MIDI, liens, annotations)
// vers la fiche conservée, sans écraser ce qu'elle possède déjà.
export async function migrateSongExtras(fromId: string, toId: string): Promise<void> {
  try {
    const srcAudio = await loadAudioStems(fromId);
    if (srcAudio) {
      const dstAudio = await loadAudioStems(toId);
      if (srcAudio.vocals && !dstAudio?.vocals) {
        await saveAudioStem(toId, "vocals", srcAudio.vocals);
      }
      if (srcAudio.noVocals && !dstAudio?.noVocals) {
        await saveAudioStem(toId, "noVocals", srcAudio.noVocals);
      }
    }
    const srcMidi = await loadMidiBlob(fromId);
    if (srcMidi && !(await loadMidiBlob(toId))) {
      await saveAudioStem(toId, "midi", srcMidi);
    }
    const srcStems = await loadStems(fromId);
    if (srcStems.length > 0 && (await loadStems(toId)).length === 0) {
      let i = 0;
      for (const rec of srcStems) {
        await saveStem({
          ...rec,
          id: `${toId}-${rec.stem}-${Date.now()}-${i++}`,
          songId: toId,
        });
      }
    }
  } catch {
    // IndexedDB indisponible : on continue la fusion des métadonnées.
  }

  const youtube = loadYouTubeId(fromId);
  if (youtube && !loadYouTubeId(toId)) saveYouTubeId(toId, youtube);
  const spotify = loadSpotifyId(fromId);
  if (spotify && !loadSpotifyId(toId)) saveSpotifyId(toId, spotify);

  const lineChords = loadLineChords(fromId);
  if (Object.keys(loadLineChords(toId)).length === 0) {
    for (const [idx, chords] of Object.entries(lineChords)) {
      saveLineChords(toId, Number(idx), chords);
    }
  }
  const lineSpacers = loadLineSpacers(fromId);
  if (Object.keys(loadLineSpacers(toId)).length === 0) {
    for (const [idx, label] of Object.entries(lineSpacers)) {
      saveLineSpacers(toId, Number(idx), label);
    }
  }
  const extraLines = loadExtraChordLines(fromId);
  if (extraLines.length > 0 && loadExtraChordLines(toId).length === 0) {
    saveExtraChordLines(toId, extraLines);
  }

  removeYouTubeId(fromId);
  removeSpotifyId(fromId);
  // La copie locale (IndexedDB) du doublon disparaît aussi, sinon elle
  // réapparaîtrait si Supabase est injoignable.
  await deleteLocalSong(fromId);
}
