<div align="center">

# 🎸 ChordFlow

**Paroles & Accords synchronisés avec la musique** · Lyrics & chords synchronized with the music.

<sub> 🇬🇧 English · 🇫🇷 [Français](README.fr.md) </sub>

</div>

ChordFlow is a web application that lets you **read, edit and play chord charts synchronized with the music**. It shows the guitar chords above the lyrics and highlights the active line in real time while an audio source plays (YouTube, Spotify or a file uploaded from your PC), so you can play along, learn a song or karaoke the lyrics.

The interface is in French, but everything you need to run and document the project is here.

---

## ✨ Features

### Library & organization
- **Built-in sample library** — a few classics are included offline (Wonderwall, Stairway to Heaven, Hotel California, Let It Be, Nothing Else Matters) with chords, plain lyrics and synced (LRC) lyrics.
- **Search bar** — quickly filter the library by artist or title.
- **Synchronized personal repertoire** — your songs live in the browser (`localStorage`) **and** sync to the cloud via **Supabase** (account + realtime) when configured.
- **Playlists** — organize your songs into playlists (`/playlists`).
- **Chord dictionary** — interactive fretboard diagram reference (`/dico`).

### Adding a song (wizard)
Two paths to add a song to your repertoire:
- **Auto mode** — search and import:
  - **Lyrics** from **LRCLIB** (with a fallback to **Lyrics.ovh**).
  - **Chord charts** from **Ultimate Guitar**.
  - **Guitar tuning** from **Songsterr** or from Ultimate Guitar.
  - The **Guitar Pro / MIDI track** from Songsterr (`.gp`, `.gpx`, `.mid`…).
  - The **capo fret** (when there is one) detected automatically on Ultimate Guitar import.
  - Automatic **key/tonality detection** from the chords.
- **Manual mode** — type the artist/title, paste plain lyrics and optional synchronized LRC lyrics, and paste your own chord chart.
- **Audio of your choice**: a **YouTube** link, a **Spotify** link, or **uploading a file from your PC** (`audio/*`).

### The song workspace
- **Three view modes** (toggle in the header):
  - **Accords (Chords)** — the chord chart with the active line highlighted and auto-scrolled in sync with the music.
  - **Paroles (Lyrics)** — a karaoke-style panel that highlights and centers the current lyric line; you can also add chords line by line, insert section dividers and extra chord lines.
  - **Sync** — a fused view keeping chords and timed lyrics aligned on a single timeline.
- **Audio sources** (when none is set): **YouTube**, **Spotify**, local **upload**, plus quick links to **Songsterr** and **Ultimate Guitar** for the current song.
- **Automatic fallback** — if a YouTube video cannot play (embedding blocked or unavailable), the app automatically offers a “Listen on Spotify” button as a complement.
- **Stem separation** — the song audio is split into tracks (vocals / instrumental, via the **local Demucs service**); stems mixer, dual-track playback, precise WebAudio decoding for alignment.
- **Seek controls** — click a lyric line, a chord, the **waveform** (for uploaded audio) or the **rhythm timeline** (chord markers) to jump the playback to that moment.
- **Timing offset** — fine-tune the synchronization with `-5 / -1 / +1 / +5 s` buttons, a slider, an auto-detection button, and a per-song persistent save/reset.
- **Per-line sync fine-tuning** — adjust individual lines or auto-align them while the song plays.

### The Studio (rhythmic chord editing)
- **Chord-shape editor** (`Modifier la chanson`): every diagram carries a **duration in beats**, **fingerings**, a **barre chord**, a **capo** and **legato** ties (H/P).
- **Musical structure**: section bars (`double`, `end`, repeats 𝄆 𝄇), alternate endings (1. / 2.), navigation markers (Segno, Coda, D.C., D.S., Fine), named sections (Intro, Verse, Chorus, Bridge…).
- **Riff / Harmony tab**: chord-shape view plus **CAGED / pentatonic boxes** on the fretboard.
- **Tablature tab**: **ASCII tab / staff** generation from notes (conversion via **alphaTex**), **Guitar Pro / MIDI / ASCII tab** import.
- **Synth playback**: the “Conductor” plays your diagrams (string synth + GM SoundFont) in addition to the stem audio.

### Progressive Web App (PWA)
ChordFlow is an **installable, offline-capable PWA** (powered by [Serwist](https://serwist.pages.dev)):
- **Installable** — add the app to your home screen / desktop from the browser.
- **Offline** — once visited, the app and its service worker let you use it without a connection (cached pages).
- **Manifest** — app icons and navigation handled by the Web App manifest.

> ⚠️ **Your audio files (song + stems) are stored locally in the browser (IndexedDB)** — not on YouTube, not in the cloud. Clearing browsing data (or “Clear site data” in DevTools) deletes them: you must re-import the audio and re-run stem extraction.

---

## 🎵 Content format (chords)

ChordFlow uses the classic *chords-above-lyrics* text format (Ultimate Guitar style):

```
[Verse 1]
Am              F
On a dark desert highway
C               G
Cool wind in my hair
```

- Section headers are in brackets: `[Verse]`, `[Chorus]`, `[Intro]`…
- A line is treated as a chord line when more than half of its words are recognized chord names (major, minor, `7`, `sus2/4`, `addN`, dim/aug, and slash chords like `C/G`).
- This recognized structure lets the app highlight lines, sync to audio, and detect the key automatically.

---

## 🔑 Automatic key detection

When you add chords, ChordFlow **detects the key automatically** (e.g. `C`, `Am`, `F#m`). The algorithm:

1. Extracts every chord name from the chart.
2. Counts the frequency of each of the 12 possible root notes (the first chord is weighted more).
3. Scores each candidate key against the major and natural-minor scales, adding a bonus when the first/last chord’s root and quality match.
4. Returns the best-ranked key (or nothing if there are no chords).

Keys reported by Ultimate Guitar imports are also used directly.

---

## 🔌 External data sources

The app relies on these third-party services (their availability is beyond our control):

| Service | Used for | Type |
|--------|----------|------|
| [LRCLIB](https://lrclib.net) | Synced (LRC) + plain lyrics, lyrics search | Public API |
| [Lyrics.ovh](https://lyrics.ovh) | Plain lyrics (fallback) | Public API |
| [Songsterr](https://www.songsterr.com) | Guitar tuning + Guitar Pro tracks | Public API |
| [Ultimate Guitar](https://www.ultimate-guitar.com) | Chord chart import / link | Web-page scraping (not an official API) |
| [YouTube](https://www.youtube.com) | Audio source + BPM + stems | Embed/URL + local yt-dlp |
| [Spotify](https://www.spotify.com) | Audio playback source | OAuth + Embed/URL |
| [Supabase](https://supabase.com) | Cloud song sync / authentication | API + realtime |
| **Demucs (local service)** | Stem separation (vocals / instrumental) | Python + ONNX, `localhost:8765` |

> Note: the Ultimate Guitar import works by parsing UG’s public web pages. It is not an official API and may stop working if the site structure changes. It runs through a server-side proxy route (`/api/ug`).

---

## 🚀 Installation

**Prerequisites:** Node.js 20+ (**Next.js 16**, **React 19**, **TypeScript 5**, **Tailwind CSS 4**). Optional: Python 3.11+ for the stem-separation service; `ffmpeg` and `yt-dlp` on the `PATH` for YouTube BPM/stems.

```bash
# install dependencies
npm install

# start the development server
npm run dev

# (optional, for stems) Demucs separation service
pip install -r services/stems/requirements.txt
start-stems.bat   # local service on port 8765
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

> The Ultimate Guitar import, Songsterr tuning, YouTube BPM and stems features use server-side proxy routes: the server must be running for them to work.

### Environment variables (`.env.local`)

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — cloud sync & authentication (local fallback without them).
- `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` — Spotify search/playback.
- `STEMS_SERVICE_URL` (default `http://127.0.0.1:8765`) — Demucs separation service.

### Production build

```bash
npm run build    # type check + production build
npm run start    # start the production server
npm run lint     # run ESLint
```

---

## 🧰 Technologies

- [Next.js](https://nextjs.org) 16 (App Router, Turbopack) — framework
- [React](https://react.dev) 19 — UI
- [TypeScript](https://www.typescriptlang.org) 5 — types
- [Tailwind CSS](https://tailwindcss.com) 4 — styles
- [Serwist](https://serwist.pages.dev) — service worker / PWA (offline)
- [alphaTex](https://github.com/CoderLine/alphaTab) (`@coderline/alphatab`) — Guitar Pro/MIDI reading and notation ↔ tab conversion
- [wavesurfer.js](https://wavesurfer-js.org) — waveform rendering for uploaded audio
- [smplr](https://github.com/kevincennis/smplr) + [soundfont2](https://github.com/kevincennis/soundfont2) — SoundFont (GM) synth for chord playback
- [Supabase](https://supabase.com) (`@supabase/supabase-js`) — cloud/authentication
- [jszip](https://github.com/Stuk/jszip) — Guitar Pro track extraction
- [Demucs](https://github.com/facebookresearch/demucs) via ONNX — stem separation (local Python/FastAPI service)
- [lucide-react](https://lucide.dev) — icons

---

## 📁 Project structure (summary)

```
src/
├─ app/
│  ├─ page.tsx              # Home: library, search, playlists, add-song wizard
│  ├─ playlists/            # Playlists
│  ├─ dico/                 # Chord dictionary
│  ├─ auth/callback/        # Spotify auth return
│  ├─ song/[id]/page.tsx    # Song workspace (chords / lyrics / sync + audio + stems)
│  ├─ song/[id]/edit/       # Studio: rhythmic diagram editing, tab, riff/harmony
│  └─ api/                  # Proxy routes: lyrics, ug, songsterr(-gp), spotify-*, yt-bpm,
│                           # yt-stems, stems, stems-health, stems-progress, tab, …
├─ components/
│  ├─ AddSong.tsx, SearchBar.tsx, SongCard.tsx, PlaylistsPanel.tsx, BottomNav.tsx
│  ├─ ChordDisplay.tsx, ChordLyricSync.tsx, SyncedLyrics.tsx   # Views
│  ├─ Waveform.tsx, AudioPlayer.tsx, YouTubePlayer.tsx, SpotifyPlayer.tsx, DualTrackPlayer.tsx
│  ├─ Conductor.tsx           # Playback/timing engine, stems (WebAudio), BPM
│  ├─ ChordShapeView.tsx      # SVG diagrams (bars, navigation glyphs, fingerings)
│  ├─ TabStaffView.tsx        # Staff/tab (alphaTex)
│  ├─ ChordBuilder.tsx, ChordDiagram.tsx, ChordReference.tsx, ArpeggioEditor.tsx
│  └─ StemsMixer.tsx          # Vocals/instrumental mixer
└─ lib/
   ├─ chord-parser.ts, key-detection.ts, chord-data.ts, modes.ts, caged.ts, pentatonic.ts
   ├─ chords-to-diagrams.ts, diagrams-to-tab.ts, text-to-tab.ts, ascii-tab-midi.ts
   ├─ gp-import.ts, midi-import.ts            # Guitar Pro / MIDI imports (alphatab)
   ├─ custom-songs.ts, supabase.ts            # Persistence (local + cloud)
   ├─ audio-store.ts, stems-db.ts             # Local audio (IndexedDB + blob URLs)
   ├─ stem-pipeline-progress.ts               # Stem pipeline steps
   ├─ chord-synth.ts, sf2-bank.ts, soft-player.ts, gm-voice.ts, bpm-detect.ts
   ├─ playlists.ts, playlists-ui-state.ts, home-scroll-store.ts, repertoire-sort.ts
   ├─ spotify-auth.ts, youtube-store.ts, song-sources.ts, lyric-timing.ts, line-offsets.ts
   └─ types.ts                                # Shared types (SavedChordShape…)

services/stems/server.py     # Demucs stem-separation service (FastAPI + ONNX, port 8765)
scripts/                     # Tab ↔ MIDI exploration tools (.mjs)
CONVENTIONS.md               # Musical conventions (model source of truth)
AGENTS.md                    # Repo guide for AI agents
```

---

## 📄 License

Copyright (c) 2026 Claude St-Jean. All rights reserved. Private project.

This project is distributed under a **private / all-rights-reserved** license. No part
of the software may be copied, reproduced, distributed or adapted without prior
written permission. See [LICENSE](LICENSE) for details.

## 🤝 Contributing

This project is not currently open to external contributions.

---

### Read this documentation in another language

- 🇬🇧 [English](README.md)
- 🇫🇷 [Français](README.fr.md)
