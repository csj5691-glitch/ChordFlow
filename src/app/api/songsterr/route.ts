// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { NextRequest } from "next/server";

const MIDI_TO_NOTE = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

const KNOWN_TUNINGS: Record<string, string> = {
  "E A D G B E": "Standard (EADGBE)",
  "D# G# C# F# A# D#": "Half Step Down (D#G#C#F#A#D#)",
  "D G C F A D": "Whole Step Down (DGCFAD)",
  "D A D G B E": "Drop D (DADGBE)",
  "D G D G B D": "Open G (DGDGBD)",
  "D A D F# A D": "Open D (DADF#AD)",
  "D A D G A D": "DADGAD",
};

interface Track {
  instrument?: string;
  instrumentId?: number;
  tuning?: number[];
}

interface SongEntry {
  songId: number;
  artist?: string;
  title?: string;
  tracks?: Track[];
  popularTrackGuitar?: number;
  popularTrack?: number;
}

function midiToNote(midi: number): string {
  return MIDI_TO_NOTE[((midi % 12) + 12) % 12];
}

function tuningLabel(notes: string[]): string {
  const joined = notes.join(" ");
  const known = KNOWN_TUNINGS[joined];
  if (known) return known;
  return joined;
}

export async function GET(req: NextRequest) {
  const artist = req.nextUrl.searchParams.get("artist");
  const title = req.nextUrl.searchParams.get("title");

  if (!artist || !title) {
    return Response.json({ error: "artist and title are required" }, { status: 400 });
  }

  const pattern = `${artist} ${title}`;

  try {
    const res = await fetch(
      `https://www.songsterr.com/api/songs?pattern=${encodeURIComponent(pattern)}`,
      { headers: { "User-Agent": "ChordFlow/1.0" }, next: { revalidate: 86400 } }
    );
    if (!res.ok) {
      return Response.json({ error: "Songsterr request failed" }, { status: 502 });
    }
    const data: SongEntry[] = await res.json();
    if (!Array.isArray(data) || data.length === 0) {
      return Response.json({ error: "No match found" }, { status: 404 });
    }

    const song = data[0];

    let tuning: number[] | undefined;
    let trackName: string | undefined;

    const guitarTracks = (song.tracks || []).filter(
      (t) => t.instrumentId !== undefined && t.instrumentId < 1024 && t.tuning
    );

    const preferred = song.tracks?.[song.popularTrackGuitar ?? song.popularTrack ?? 0];
    if (preferred?.tuning) {
      tuning = preferred.tuning;
      trackName = preferred.instrument;
    } else if (guitarTracks.length > 0) {
      tuning = guitarTracks[0].tuning;
      trackName = guitarTracks[0].instrument;
    }

    return Response.json({
      songId: song.songId,
      artist: song.artist,
      title: song.title,
      tuning: tuning ? tuningLabel(tuning.map(midiToNote)) : undefined,
      track: trackName,
    });
  } catch {
    return Response.json({ error: "Songsterr unavailable" }, { status: 502 });
  }
}
