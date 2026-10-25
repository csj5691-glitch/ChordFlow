<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# ChordFlow — guide pour agents

Application web (UI **en français**) : lecture, édition et jeu de grilles d'accords synchronisées avec la musique. Next.js 16 (App Router, Turbopack), React 19, TypeScript 5, Tailwind CSS 4, PWA via Serwist. Licence privée, pas de contributions externes.

## Commandes

- `npm run dev` — dev (http://localhost:3000). `npm run build` — types + build prod. `npm run start` — serveur prod. `npm run lint` — ESLint.
- `npx tsc --noEmit` — vérification types (le build fait déjà la vérif).
- Service stems local (obligatoire pour la séparation Demucs) : `start-stems.bat` → `python services/stems/server.py` sur le port **8765** (htdemucs, 4 pistes, ONNX ; `pip install -r services/stems/requirements.txt`). Le .bat redémarre en boucle après crash.
- `start.bat` / `start-prod.bat` — scripts de lancement Windows.
- **Erreur ESLint connue et préexistante** : `react-hooks/set-state-in-effect` dans `src/components/Conductor.tsx` (~l. 382). Ne pas la considérer comme introduite par tes changements.
- Pas de framework de tests automatisés.

## Architecture

- `src/app/page.tsx` — accueil : répertoire, recherche, assistant d'ajout, playlists.
- `src/app/song/[id]/page.tsx` — espace de travail chanson (vues Accords / Paroles / Sync, sources audio YouTube / Spotify / fichier local).
- `src/app/song/[id]/edit/page.tsx` — **Studio** : éditeur de diagrammes/rythme. Gros fichiers (`page.tsx` ~3300 lignes, `Conductor.tsx` ~1600). Les performances y sont critiques : le rendu de nombreux diagrammes SVG cause des long tasks ; la bande de cartes est **virtualisée**, les composants sont **mémoïsés**, le scroll **instantané**. Ne pas réintroduire de rendu DOM complet.
- `src/components/` — dont `ChordShapeView.tsx` (diagrammes SVG, `BarGlyph`/`NavGlyph`), `Conductor.tsx` (moteur de lecture/chrono + stems), `TabStaffView.tsx`, `StemsMixer.tsx`, `RiffHarmonyView.tsx`.
- `src/lib/` — parsing/théorie (`chord-parser`, `key-detection`, `chord-data`, `caged`, `pentatonic`, `modes`, `articulation`), conversion (`chords-to-diagrams`, `diagrams-to-tab`, `gp-import` via **@coderline/alphatab**, `midi-import`, `ascii-tab-midi`), audio/synth (`chord-synth`, `sf2-bank`/`smplr`, `soft-player`, `bpm-detect`), persistance (voir ci-dessous).
- `src/app/api/*` — routes proxy serveur : paroles (LRCLIB/Lyrics.ovh), Ultimate Guitar (`ug`), Songsterr, Spotify (auth/search/track/play), YouTube BPM/stems, et le pipeline stems (`stems`, `yt-stems`, `stems-health`, `stems-progress`, `stems-launch`).
- `scripts/` — outils Node/ASCII tab (`.mjs`), non branchés au build.
- Déploiement : GitHub (`master`) → **Vercel**. Les pushes se font en `git push --force origin master` (usage établi du repo).

## Persistance des données (Important)

- **Chansons/métadonnées** : Supabase (auth + tables, cf. `supabase.ts`) avec repli `localStorage` (`custom-songs.ts`).
- **Audio (source + stems)** : **IndexedDB** côté navigateur (`audio-store.ts`, `stems-db.ts` — stores `chordflow-audio`, `chordflow-stems`), servis via **blob URLs** (`getAudioStemUrl`). Les blobs meurent si on vide le site data → les stems sont perdus ; un `fetch` sur une URL `blob:` expirée lève `Failed to fetch`. Le repli silencieux est déjà en place dans `Conductor.tsx` (pas de console.error sur stem indisponible).
- Les **clés/URLs d'API externes** sont dans `.env.local` (ne pas commiter).

## Conventions du projet

- **Tout commentaire/log/UI en français** ; messages de commit français concis, **sans accents** (ex. « memoisation », « defilement »).
- Source de vérité musicale : **`CONVENTIONS.md`** (1 beat = 1 noire, durées en beats, mesures optionnelles, `barKind`/`repeats`/`ending`/`navKind`, deux sens du mute X, capo sur fréquences pas frettes). Les évolutions du modèle doivent rester **additives et optionnelles**.
- Toute nouvelle fonctionnalité audio/rythme doit rester compatible avec le modèle `SavedChordShape` existant.

## Pièges connus

- **Serwist sert du cache** (« preloaded navigation response ») : pour tester un changement de code, unregister le SW + Clear site data dans DevTools, sinon l'ancien bundle est testé.
- `/api/yt-bpm` dépend de **yt-dlp + ffmpeg installés localement** → ne fonctionne pas sur Vercel (serverless), cf. `NOTES.md`. Pareil pour le service Demucs (localhost:8765).
- L'import Ultimate Guitar **scrape des pages web** (pas d'API officielle) : fragile aux changements d'UG.
- La table Supabase `ui_state` (mémorisation du scroll d'accueil, `home-scroll-store.ts`) n'était **pas encore créée** au dernier pointage — prévoir le SQL.
