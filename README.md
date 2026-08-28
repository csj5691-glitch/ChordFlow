<div align="center">

# 🎸 ChordFlow

**Paroles & Accords synchronisés avec la musique** · Lyrics & chords synchronized with the music.

<sub> 🇬🇧 English · 🇫🇷 [Français](README.fr.md) </sub>

</div>

ChordFlow is a web application that lets you **read, edit and play chord charts synchronized with the music**. It shows the guitar chords above the lyrics and highlights the active line in real time while an audio source plays (YouTube, Spotify or an uploaded local file), so you can play along, learn a song or karaoke the lyrics.

The interface is in French, but everything you need to run and document the project is here.

---

## ✨ Features

### Song library & search
- **Built-in sample library** — a few classics are included offline (Wonderwall, Stairway to Heaven, Hotel California, Let It Be, Nothing Else Matters) with chords, plain lyrics and synced (LRC) lyrics.
- **Search bar** — quickly filter the library by artist or title.
- **Import from Ultimate Guitar** — type a song (e.g. `Wonderwall, Oasis`) and import the chord chart directly from Ultimate Guitar into your repertoire.
- **Personal repertoire** — save your own songs (stored locally in your browser via `localStorage`), each showing badges for detected key, capo and synced lyrics. Add, open, **edit** (pencil button ✏️ reopens the mini-form pre-filled) or delete them as you wish.

### Adding a song (wizard)
Two paths to add a song to your repertoire:
- **Auto mode** — search and import:
  - Lyrics from **LRCLIB** (with a fallback to **Lyrics.ovh**).
  - Chord charts from **Ultimate Guitar**.
  - Guitar tuning from **Songsterr** or from Ultimate Guitar.
  - The **capo fret** (when there is one) detected automatically on Ultimate Guitar import.
  - Automatic **key/tonality detection** from the chords.
  - The “Search lyrics” and “Import chords” buttons stay visible at every step, so you can fetch either one at any time.
- **Manual mode** — type the artist/title, paste plain lyrics and optional synchronized LRC lyrics, and paste your own chord chart.
- The form also opens in **edit mode** pre-filled to modify an existing song; its **capo** and **tuning** fields are editable.

### The song workspace
- **Three view modes** (toggle in the header):
  - **Accords (Chords)** — the chord chart with the active line highlighted and auto-scrolled in sync with the music.
  - **Paroles (Lyrics)** — a karaoke-style panel that highlights and centers the current lyric line; you can also add chords line by line, insert section dividers and extra chord lines.
  - **Sync** — a fused view keeping chords and timed lyrics aligned on a single timeline.
- **Audio sources** (when none is set): **YouTube**, **Spotify**, local **upload**, plus quick links to **Songsterr** and **Ultimate Guitar** for the current song.
- **Automatic fallback** — if a YouTube video cannot play (embedding blocked or unavailable), the app automatically offers a “Listen on Spotify” button as a complement.
- **Seek controls** — click a lyric line, a chord, the **waveform** (for uploaded audio) or the **rhythm timeline** (chord markers) to jump the playback to that moment.
- **Timing offset** — fine-tune the synchronization with `-5 / -1 / +1 / +5 s` buttons, a slider, an auto-detection button, and a per-song persistent save/reset.
- **Per-line sync fine-tuning** — adjust individual lines or auto-align them while the song plays.

### Chord editing tools
- **Inline chord editing** — retype any chord directly in the chart.
- **Text editor** — rewrite the whole sheet in plain text (sections in `[brackets]`, chords above lyrics).
- **Chord reference** — an interactive fretboard diagram finder (root + quality) to look up and insert chord names while editing.

### Progressive Web App (PWA)
ChordFlow is an **installable, offline-capable PWA** (powered by [Serwist](https://serwist.pages.dev)):
- **Installable** — add the app to your home screen / desktop from the browser.
- **Offline** — once visited, the app and its service worker let you use it without a connection (cached pages).
- **Manifest** — app icons and navigation handled by the Web App manifest.

---

## 🎵 Chords content format

ChordFlow uses the classic *chord-over-lyrics* (Ultimate Guitar style) text format:

```
[Verse 1]
Am              F
On a dark desert highway
C               G
Cool wind in my hair
```

- Section headers are wrapped in square brackets: `[Verse]`, `[Chorus]`, `[Intro]`…
- A line is treated as a chord line when more than half of its words are recognized chord names (majors, minors, `7`, `sus2/4`, `addN`, dim/aug, and slash chords like `C/G`).
- The recognized structure lets the app highlight lines, sync to audio, and auto-detect the key.

---

## 🔑 Automatic key detection

When you add chords, ChordFlow **automatically detects the tonality** (e.g. `C`, `Am`, `F#m`). The algorithm:

1. Extracts every chord name from the chart.
2. Counts how often each of the 12 pitch-class roots appears (the first chord is weighted more heavily).
3. Scores each candidate key against both the Major and natural Minor scales, adding a bonus when the first/last chord’s root and major/minor quality match.
4. Returns the best-matching key (or none if there are no chords).

Registered keys from Ultimate Guitar imports are also used directly.

---

## 🔌 External data sources

The app relies on these third-party services (their availability is outside our control):

| Service | Used for | Type |
|--------|----------|------|
| [LRCLIB](https://lrclib.net) | Synced (LRC) + plain lyrics, lyric search | Public API |
| [Lyrics.ovh](https://lyrics.ovh) | Plain lyrics (fallback) | Public API |
| [Songsterr](https://www.songsterr.com) | Guitar tuning detection | Public API |
| [Ultimate Guitar](https://www.ultimate-guitar.com) | Chord chart import / link | Scraped web pages (not an official API) |
| [YouTube](https://www.youtube.com) | Audio playback source | Embed/URL |
| [Spotify](https://www.spotify.com) | Audio playback source | Embed/URL |

> Note: Ultimate Guitar import works by parsing UG’s public web pages. It is not an official API and may break if their site structure changes. It is performed through a server-side proxy route (`/api/ug`).

---

## 🚀 Getting started

**Requirements:** Node.js 20+ (the project is built on **Next.js 16**, **React 19**, **TypeScript 5** and **Tailwind CSS 4**).

```bash
# install dependencies
npm install

# run the development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

> The Ultimate Guitar import and Songsterr tuning features use server-side proxy routes, so the server must be running for them to work.

### Production build

```bash
npm run build    # type-check + production build
npm run start    # start the production server
npm run lint     # run ESLint
```

---

## 🧰 Tech stack

- [Next.js](https://nextjs.org) 16 (App Router) — framework
- [React](https://react.dev) 19 — UI
- [TypeScript](https://www.typescriptlang.org) 5 — types
- [Tailwind CSS](https://tailwindcss.com) 4 — styling
- [wavesurfer.js](https://wavesurfer-js.org) — waveform rendering for uploaded audio
- [lucide-react](https://lucide.dev) — icons
- [Serwist](https://serwist.pages.dev) — service worker / PWA (offline)

---

## 📁 Project structure (summary)

```
src/
├─ app/
│  ├─ page.tsx            # Home: repertoire + search + AddSong wizard
│  ├─ song/[id]/page.tsx  # Song workspace (chords / lyrics / sync + audio)
│  └─ api/
│     ├─ lyrics/          # Proxy to LRCLIB + Lyrics.ovh
│     ├─ search-lyrics/   # Proxy to LRCLIB search
│     ├─ songsterr/       # Proxy to Songsterr (tuning)
│     └─ ug/              # Proxy to Ultimate Guitar (chord import)
├─ components/
│  ├─ AddSong.tsx, SearchBar.tsx, SongCard.tsx   # Library / adding songs
│  ├─ ChordDisplay.tsx, ChordLyricSync.tsx,       # Views
│  ├─ SyncedLyrics.tsx, RhythmTimeline.tsx,
│  ├─ Waveform.tsx, AudioPlayer.tsx,              # Audio
│  ├─ YouTubePlayer.tsx, SpotifyPlayer.tsx,
│  ├─ YouTubeSearch.tsx, SpotifySearch.tsx,
│  └─ ChordReference.tsx                          # Chord diagram finder
└─ lib/
   ├─ chord-parser.ts     # Parses chord-over-lyrics text
   ├─ key-detection.ts    # Auto key/tonality detection
   ├─ chord-data.ts       # Fretboard diagram database
   ├─ custom-songs.ts     # localStorage persistence
   ├─ line-offsets.ts     # Sync offset persistence
   ├─ ug-scraper.ts       # Ultimate Guitar scraping helpers
   ├─ mock-data.ts        # Offline sample library + local search
   └─ types.ts            # Shared TypeScript types
```

---

## 📄 License

Private project. All rights reserved.

## 🤝 Contributing

This project is not currently open to external contributions.

---

### Read this documentation in another language

- 🇬🇧 [English](README.md)
- 🇫🇷 [Français](README.fr.md)
