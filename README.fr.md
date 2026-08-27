<div align="center">

# 🎸 ChordFlow

**Paroles & Accords synchronisés avec la musique** · Lyrics & chords synchronized with the music.

<sub> 🇫🇷 Français · 🇬🇧 [English](README.md) </sub>

</div>

ChordFlow est une application web qui permet de **lire, éditer et jouer des grilles d'accords synchronisées avec la musique**. Elle affiche les accords de guitare au-dessus des paroles et surligne la ligne active en temps réel pendant la lecture d'une source audio (YouTube, Spotify ou un fichier local importé), pour jouer en accompagnement, apprendre un morceau ou chanter en karaoké.

L'interface du site est en français. Tout ce qu'il faut pour installer et documenter le projet se trouve ici.

---

## ✨ Fonctionnalités

### Répertoire de chansons et recherche
- **Bibliothèque d'exemples intégrée** — quelques classiques disponibles hors ligne (Wonderwall, Stairway to Heaven, Hotel California, Let It Be, Nothing Else Matters) avec accords, paroles simples et paroles synchronisées (LRC).
- **Barre de recherche** — filtre rapidement la bibliothèque par artiste ou par titre.
- **Import depuis Ultimate Guitar** — saisissez un morceau (ex. `Wonderwall, Oasis`) et importez la grille d'accords directement depuis Ultimate Guitar dans votre répertoire.
- **Répertoire personnel** — enregistrez vos propres chansons (stockées localement dans le navigateur via `localStorage`), chacune affichant des badges pour la tonalité détectée, le capo et les paroles synchronisées. Ajoutez, ouvrez ou supprimez vos morceaux comme vous le souhaitez.

### Ajouter une chanson (assistant)
Deux parcours pour ajouter une chanson à votre répertoire :
- **Mode auto** — recherche et import :
  - Les **paroles** depuis **LRCLIB** (avec repli sur **Lyrics.ovh**).
  - Les **grilles d'accords** depuis **Ultimate Guitar**.
  - L'**accordage guitare** depuis **Songsterr**.
  - La **détection automatique de la tonalité** à partir des accords.
- **Mode manuel** — saisissez l'artiste/le titre, collez les paroles simples et éventuellement les paroles synchronisées LRC, et collez votre propre grille d'accords.

### L'espace de travail d'une chanson
- **Trois vues** (bascule dans l'en-tête) :
  - **Accords** — la grille avec la ligne active surlignée et défilante, synchronisée avec la musique.
  - **Paroles** — un panneau style karaoké qui surligne et centre la ligne de paroles courante ; vous pouvez aussi y ajouter des accords ligne par ligne, insérer des séparateurs de sections et des lignes d'accords supplémentaires.
  - **Sync** — une vue fusionnée qui garde accords et paroles minutés alignés sur une seule timeline.
- **Sources audio** (quand aucune n'est définie) : **YouTube**, **Spotify**, **import local** (upload), ainsi que des liens rapides vers **Songsterr** et **Ultimate Guitar** pour le morceau courant.
- **Contrôles de recherche (seek)** — cliquez sur une ligne de paroles, un accord, la **forme d'onde** (pour l'audio importé) ou la **timeline rythmique** (repères d'accords) pour déplacer la lecture à cet instant.
- **Décalage temporel** — ajustez la synchronisation avec les boutons `-5 / -1 / +1 / +5 s`, un curseur, un bouton de détection automatique, et une sauvegarde/réinitialisation persistante par chanson.
- **Réglage fin par ligne** — ajustez chaque ligne individuellement ou alignez-les automatiquement pendant la lecture.

### Outils d'édition des accords
- **Édition d'accord en ligne** — retapez n'importe quel accord directement dans la grille.
- **Éditeur de texte** — réécrivez toute la grille en texte brut (sections entre `[crochets]`, accords au-dessus des paroles).
- **Référence d'accords** — un chercheur interactif de diagrammes (fondamentale + qualité) pour consulter et insérer des accords pendant l'édition.

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
| [Songsterr](https://www.songsterr.com) | Détection de l'accordage guitare | API publique |
| [Ultimate Guitar](https://www.ultimate-guitar.com) | Import de grilles / lien | Pages web scannées (pas une API officielle) |
| [YouTube](https://www.youtube.com) | Source audio de lecture | Embed/URL |
| [Spotify](https://www.spotify.com) | Source audio de lecture | Embed/URL |

> Note : l'import Ultimate Guitar fonctionne en analysant les pages web publiques d'UG. Il ne s'agit pas d'une API officielle et il peut cesser de fonctionner si la structure du site change. Il est exécuté via une route proxy côté serveur (`/api/ug`).

---

## 🚀 Installation

**Prérequis :** Node.js 20+ (le projet est construit sur **Next.js 16**, **React 19**, **TypeScript 5** et **Tailwind CSS 4**).

```bash
# installer les dépendances
npm install

# lancer le serveur de développement
npm run dev
```

Ouvrez [http://localhost:3000](http://localhost:3000) dans votre navigateur.

> Les fonctions d'import Ultimate Guitar et d'accordage Songsterr utilisent des routes proxy côté serveur : le serveur doit donc tourner pour qu'elles fonctionnent.

### Build de production

```bash
npm run build    # vérification des types + build de production
npm run start    # démarre le serveur de production
npm run lint     # exécute ESLint
```

---

## 🧰 Technologies

- [Next.js](https://nextjs.org) 16 (App Router) — framework
- [React](https://react.dev) 19 — UI
- [TypeScript](https://www.typescriptlang.org) 5 — types
- [Tailwind CSS](https://tailwindcss.com) 4 — styles
- [wavesurfer.js](https://wavesurfer-js.org) — rendu de la forme d'onde pour l'audio importé
- [lucide-react](https://lucide.dev) — icônes

---

## 📁 Structure du projet (résumé)

```
src/
├─ app/
│  ├─ page.tsx            # Accueil : répertoire + recherche + assistant d'ajout
│  ├─ song/[id]/page.tsx  # Espace de travail chanson (accords / paroles / sync + audio)
│  └─ api/
│     ├─ lyrics/          # Proxy vers LRCLIB + Lyrics.ovh
│     ├─ search-lyrics/   # Proxy vers la recherche LRCLIB
│     ├─ songsterr/       # Proxy vers Songsterr (accordage)
│     └─ ug/              # Proxy vers Ultimate Guitar (import d'accords)
├─ components/
│  ├─ AddSong.tsx, SearchBar.tsx, SongCard.tsx   # Répertoire / ajout de chansons
│  ├─ ChordDisplay.tsx, ChordLyricSync.tsx,       # Vues
│  ├─ SyncedLyrics.tsx, RhythmTimeline.tsx,
│  ├─ Waveform.tsx, AudioPlayer.tsx,              # Audio
│  ├─ YouTubePlayer.tsx, SpotifyPlayer.tsx,
│  ├─ YouTubeSearch.tsx, SpotifySearch.tsx,
│  └─ ChordReference.tsx                          # Chercheur de diagrammes
└─ lib/
   ├─ chord-parser.ts     # Analyse du texte accords/paroles
   ├─ key-detection.ts    # Détection auto de la tonalité
   ├─ chord-data.ts       # Base de diagrammes de manche
   ├─ custom-songs.ts     # Persistance localStorage
   ├─ line-offsets.ts     # Persistance des décalages de sync
   ├─ ug-scraper.ts       # Helpers de scraping Ultimate Guitar
   ├─ mock-data.ts        # Bibliothèque d'exemples hors ligne + recherche locale
   └─ types.ts            # Types TypeScript partagés
```

---

## 📄 Licence

Projet privé. Tous droits réservés.

## 🤝 Contribution

Ce projet n'est actuellement pas ouvert aux contributions externes.

---

### Lire cette documentation dans une autre langue

- 🇬🇧 [English](README.md)
- 🇫🇷 [Français](README.fr.md)
