<div align="center">

# 🎸 ChordFlow

**Paroles & Accords synchronisés avec la musique** · Lyrics & chords synchronized with the music.

<sub> 🇫🇷 Français · 🇬🇧 [English](README.md) </sub>

</div>

ChordFlow est une application web qui permet de **lire, éditer et jouer des grilles d'accords synchronisées avec la musique**. Elle affiche les accords de guitare au-dessus des paroles et surligne la ligne active en temps réel pendant la lecture d'une source audio (YouTube, Spotify, ou fichier importé depuis votre PC), pour jouer en accompagnement, apprendre un morceau ou chanter en karaoké.

L'interface du site est en français. Tout ce qu'il faut pour installer et documenter le projet se trouve ici.

---

## ✨ Fonctionnalités

### Bibliothèque et organisation
- **Bibliothèque d'exemples intégrée** — quelques classiques disponibles hors ligne (Wonderwall, Stairway to Heaven, Hotel California, Let It Be, Nothing Else Matters) avec accords, paroles simples et paroles synchronisées (LRC).
- **Barre de recherche** — filtre rapidement la bibliothèque par artiste ou par titre.
- **Répertoire personnel synchronisé** — vos chansons sont stockées dans le navigateur (`localStorage`) **et** synchronisées dans le cloud via **Supabase** (compte + temps réel) quand il est configuré.
- **Playlists** — organisez vos morceaux en listes de lecture (`/playlists`).
- **Dico d'accords** — référence interactive des diagrammes de manche (`/dico`).

### Ajouter une chanson (assistant)
Deux parcours pour ajouter une chanson à votre répertoire :
- **Mode auto** — recherche et import :
  - Les **paroles** depuis **LRCLIB** (avec repli sur **Lyrics.ovh**).
  - Les **grilles d'accords** depuis **Ultimate Guitar**.
  - L'**accordage guitare** depuis **Songsterr** ou depuis Ultimate Guitar.
  - La **piste Guitar Pro / MIDI** depuis Songsterr (`.gp`, `.gpx`, `.mid`…).
  - Le **fret du capo** détecté automatiquement lors de l'import Ultimate Guitar.
  - La **détection automatique de la tonalité** à partir des accords.
- **Mode manuel** — saisissez l'artiste/le titre, collez les paroles simples et éventuellement les paroles synchronisées LRC, et collez votre propre grille d'accords.
- **Audio au choix** : lien **YouTube**, lien **Spotify**, ou **upload d'un fichier depuis votre PC** (`audio/*`).

### L'espace de travail d'une chanson
- **Trois vues** (bascule dans l'en-tête) :
  - **Accords** — la grille avec la ligne active surlignée et défilante, synchronisée avec la musique.
  - **Paroles** — un panneau style karaoké qui surligne et centre la ligne de paroles courante ; vous pouvez aussi y ajouter des accords ligne par ligne, insérer des séparateurs de sections et des lignes d'accords supplémentaires.
  - **Sync** — une vue fusionnée qui garde accords et paroles minutés alignés sur une seule timeline.
- **Sources audio** (quand aucune n'est définie) : **YouTube**, **Spotify**, **import local** (upload), ainsi que des liens rapides vers **Songsterr** et **Ultimate Guitar** pour le morceau courant.
- **Bascule automatique** — si une vidéo YouTube ne peut pas être lue (embarquement bloqué ou indisponible), l'application propose automatiquement un bouton « Écouter sur Spotify » en complément.
- **Séparation des stems** — l'audio du morceau est séparé en pistes (voix / instrumental, via le **service Demucs local**) ; mixeur de stems, lecture double piste, décodage WebAudio pour le calage précis.
- **Contrôles de recherche (seek)** — cliquez sur une ligne de paroles, un accord, la **forme d'onde** (pour l'audio importé) ou la **timeline rythmique** (repères d'accords) pour déplacer la lecture à cet instant.
- **Décalage temporel** — ajustez la synchronisation avec les boutons `-5 / -1 / +1 / +5 s`, un curseur, un bouton de détection automatique, et une sauvegarde/réinitialisation persistante par chanson.
- **Réglage fin par ligne** — ajustez chaque ligne individuellement ou alignez-les automatiquement pendant la lecture.

### Le Studio (édition rythmique des accords)
- **Éditeur de formes d'accords** (`Modifier la chanson`) : chaque diagramme porte une **durée en beats**, des **doigtés**, un **barré**, un **capo** et des liaisons **legato** (H/P).
- **Structure musicale** : barres de section (`double`, `end`, repeats 𝄆 𝄇), fins alternatives (1. / 2.), renvois de notation (Segno, Coda, D.C., D.S., Fine), sections nommées (Intro, Couplet, Refrain, Pont…).
- **Onglet Riff / Harmonique** : vue forme d'accord + **boîtes CAGED / pentatoniques** sur le manche.
- **Onglet Tablature** : génération de **tabulature ASCII / portée** depuis les notes (conversion via **alphaTex**), import **Guitar Pro / MIDI / ASCII tab**.
- **Lecture par synthé** : le « Chef d'orchestre » joue vos diagrammes (synthé à cordes + SoundFont GM) en plus des stems audio.

### Progressive Web App (PWA)
ChordFlow est une **PWA installable et utilisable hors ligne** (via [Serwist](https://serwist.pages.dev)) :
- **Installable** — ajoutez l'application à votre écran d'accueil / bureau depuis le navigateur.
- **Hors ligne** — une fois visitée, l'application et son service worker permettent de l'utiliser sans connexion (pages mises en cache).
- **Manifest** — icônes et navigation applicative gérées par le manifest Web App.

> ⚠️ **Vos fichiers audio (morceau + stems) sont stockés localement dans le navigateur (IndexedDB)** — ni sur YouTube, ni dans le cloud. Vider les données de navigation (ou « Clear site data » dans DevTools) les supprime : il faut alors ré-importer l'audio et relancer l'extraction des stems.

---

## 🎵 Format du contenu (accords)

ChordFlow utilise le format texte classique *accords-au-dessus-des-paroles* (style Ultimate Guitar) :

```
[Verse 1]
Am              F
On a dark desert highway
C               G
Cool wind in my hair
```

- Les en-têtes de section sont entre crochets : `[Verse]`, `[Chorus]`, `[Intro]`…
- Une ligne est considérée comme une ligne d'accords quand plus de la moitié de ses mots sont des noms d'accords reconnus (majeurs, mineurs, `7`, `sus2/4`, `addN`, dim/aug, et accords avec basse comme `C/G`).
- Cette structure reconnue permet à l'application de surligner les lignes, de se synchroniser à l'audio et de détecter automatiquement la tonalité.

---

## 🔑 Détection automatique de la tonalité

Quand vous ajoutez des accords, ChordFlow **détecte automatiquement la tonalité** (ex. `C`, `Am`, `F#m`). L'algorithme :

1. Extrait chaque nom d'accord de la grille.
2. Compte la fréquence de chacune des 12 fondamentales possibles (le premier accord est pondéré davantage).
3. Évalue chaque tonalité candidate par rapport aux gammes majeure et mineure naturelle, en ajoutant un bonus quand la fondamentale et la qualité (majeur/mineur) du premier/dernier accord correspondent.
4. Renvoie la tonalité la mieux classée (ou rien s'il n'y a pas d'accords).

Les tonalités renseignées lors des imports Ultimate Guitar sont également utilisées directement.

---

## 🔌 Sources de données externes

L'application s'appuie sur ces services tiers (leur disponibilité échappe à notre contrôle) :

| Service | Utilisé pour | Type |
|--------|--------------|------|
| [LRCLIB](https://lrclib.net) | Paroles synchronisées (LRC) + simples, recherche de paroles | API publique |
| [Lyrics.ovh](https://lyrics.ovh) | Paroles simples (repli) | API publique |
| [Songsterr](https://www.songsterr.com) | Accordage guitare + pistes Guitar Pro | API publique |
| [Ultimate Guitar](https://www.ultimate-guitar.com) | Import de grilles / lien | Pages web scannées (pas une API officielle) |
| [YouTube](https://www.youtube.com) | Source audio + BPM + stems | Embed/URL + yt-dlp local |
| [Spotify](https://www.spotify.com) | Source audio de lecture | OAuth + Embed/URL |
| [Supabase](https://supabase.com) | Synchronisation cloud des chansons/authentification | API + temps réel |
| **Demucs (service local)** | Séparation des stems (voix / instrumental) | Python + ONNX, `localhost:8765` |

> Note : l'import Ultimate Guitar fonctionne en analysant les pages web publiques d'UG. Il ne s'agit pas d'une API officielle et il peut cesser de fonctionner si la structure du site change. Il est exécuté via une route proxy côté serveur (`/api/ug`).

---

## 🚀 Installation

**Prérequis :** Node.js 20+ (**Next.js 16**, **React 19**, **TypeScript 5**, **Tailwind CSS 4**). Optionnel : Python 3.11+ pour le service de séparation des stems ; `ffmpeg` et `yt-dlp` sur le `PATH` pour le BPM et les stems depuis YouTube.

```bash
# installer les dépendances
npm install

# lancer le serveur de développement
npm run dev

# (optionnel, pour les stems) séparation Demucs
pip install -r services/stems/requirements.txt
start-stems.bat   # service local sur le port 8765
```

Ouvrez [http://localhost:3000](http://localhost:3000) dans votre navigateur.

> Les fonctions d'import Ultimate Guitar, d'accordage Songsterr, de BPM YouTube et de stems utilisent des routes proxy côté serveur : le serveur doit donc tourner pour qu'elles fonctionnent.

### Variables d'environnement (`.env.local`)

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — synchronisation cloud et authentification (repli local sans ces clés).
- `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` — recherche/lecture Spotify.
- `STEMS_SERVICE_URL` (défaut `http://127.0.0.1:8765`) — service de séparation Demucs.

### Build de production

```bash
npm run build    # vérification des types + build de production
npm run start    # démarre le serveur de production
npm run lint     # exécute ESLint
```

---

## 🧰 Technologies

- [Next.js](https://nextjs.org) 16 (App Router, Turbopack) — framework
- [React](https://react.dev) 19 — UI
- [TypeScript](https://www.typescriptlang.org) 5 — types
- [Tailwind CSS](https://tailwindcss.com) 4 — styles
- [Serwist](https://serwist.pages.dev) — service worker / PWA (hors ligne)
- [alphaTex](https://github.com/CoderLine/alphaTab) (`@coderline/alphatab`) — lecture Guitar Pro/MIDI et conversion notation ↔ tab
- [wavesurfer.js](https://wavesurfer-js.org) — rendu de la forme d'onde pour l'audio importé
- [smplr](https://github.com/kevincennis/smplr) + [soundfont2](https://github.com/kevincennis/soundfont2) — synthé SoundFont (GM) pour la lecture des accords
- [Supabase](https://supabase.com) (`@supabase/supabase-js`) — cloud/authentification
- [jszip](https://github.com/Stuk/jszip) — extraction des pistes Guitar Pro
- [Demucs](https://github.com/facebookresearch/demucs) via ONNX — séparation des stems (service Python/FastAPI local)
- [lucide-react](https://lucide.dev) — icônes

---

## 📁 Structure du projet (résumé)

```
src/
├─ app/
│  ├─ page.tsx              # Accueil : répertoire, recherche, playlists, assistant d'ajout
│  ├─ playlists/            # Listes de lecture
│  ├─ dico/                 # Dictionnaire d'accords
│  ├─ auth/callback/        # Retour d'authentification Spotify
│  ├─ song/[id]/page.tsx    # Espace de travail chanson (accords / paroles / sync + audio + stems)
│  ├─ song/[id]/edit/       # Studio : édition rythmique des diagrammes, tab, riff/harmonique
│  └─ api/                  # Routes proxy : lyrics, ug, songsterr(-gp), spotify-*, yt-bpm,
│                           # yt-stems, stems, stems-health, stems-progress, tab, …
├─ components/
│  ├─ AddSong.tsx, SearchBar.tsx, SongCard.tsx, PlaylistsPanel.tsx, BottomNav.tsx
│  ├─ ChordDisplay.tsx, ChordLyricSync.tsx, SyncedLyrics.tsx   # Vues
│  ├─ Waveform.tsx, AudioPlayer.tsx, YouTubePlayer.tsx, SpotifyPlayer.tsx, DualTrackPlayer.tsx
│  ├─ Conductor.tsx           # Moteur de lecture/chrono, stems (WebAudio), BPM
│  ├─ ChordShapeView.tsx      # Diagrammes SVG (barres, renvois, doigtés)
│  ├─ TabStaffView.tsx        # Portée/tabulature (alphaTex)
│  ├─ ChordBuilder.tsx, ChordDiagram.tsx, ChordReference.tsx, ArpeggioEditor.tsx
│  └─ StemsMixer.tsx          # Mixeur voix/instrumental
└─ lib/
   ├─ chord-parser.ts, key-detection.ts, chord-data.ts, modes.ts, caged.ts, pentatonic.ts
   ├─ chords-to-diagrams.ts, diagrams-to-tab.ts, text-to-tab.ts, ascii-tab-midi.ts
   ├─ gp-import.ts, midi-import.ts            # Imports Guitar Pro / MIDI (alphatab)
   ├─ custom-songs.ts, supabase.ts            # Persistance (local + cloud)
   ├─ audio-store.ts, stems-db.ts             # Audio local (IndexedDB + blob URLs)
   ├─ stem-pipeline-progress.ts               # Étapes du pipeline stems
   ├─ chord-synth.ts, sf2-bank.ts, soft-player.ts, gm-voice.ts, bpm-detect.ts
   ├─ playlists.ts, playlists-ui-state.ts, home-scroll-store.ts, repertoire-sort.ts
   ├─ spotify-auth.ts, youtube-store.ts, song-sources.ts, lyric-timing.ts, line-offsets.ts
   └─ types.ts                                # Types partagés (SavedChordShape…)

services/stems/server.py     # Service de séparation Demucs (FastAPI + ONNX, port 8765)
scripts/                     # Outils d'exploration tab ↔ MIDI (.mjs)
CONVENTIONS.md               # Conventions musicales (source de vérité du modèle)
AGENTS.md                    # Guide du repo pour les agents IA
```

---

## 📄 Licence

Copyright (c) 2026 Claude St-Jean. Tous droits réservés. Projet privé.

Ce projet est distribué sous une licence **privée / tous droits réservés**. Aucune
partie du logiciel ne peut être copiée, reproduite, distribuée ou adaptée sans
autorisation écrite préalable. Voir le fichier [LICENSE](LICENSE) pour plus de détails.

## 🤝 Contribution

Ce projet n'est actuellement pas ouvert aux contributions externes.

---

### Lire cette documentation dans une autre langue

- 🇬🇧 [English](README.md)
- 🇫🇷 [Français](README.fr.md)
