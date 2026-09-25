# Conventions musicales — ChordFlow

Ce document consigne les conventions musicales utilisées par ChordFlow et sert de
source de vérité pour les décisions à venir. Toute évolution doit rester
**optionnelle, additive et sans contrainte** sur le modèle de données existant.

Référence théorique canonique : [Open Music Theory V2](https://viva.pressbooks.pub/openmusictheory/)
(rythme, métrique, signatures, accords, formes). Notation précise : [Behind Bars (Elaine Gould)](https://www.behindbarsnotation.co.uk/)
(ch. 6 « Metre », ch. 13 « Classical Guitar »).

---

## 1. Temps et rythme

| Notion | Convention |
| --- | --- |
| **1 beat** | = 1 temps = 1 noire (quarter note). |
| **Tempo** | défini par BPM = nombres de noires par minute. |
| **Conversion** | `secondes = beats × 60 / BPM`. |

Valeurs de durée (`SavedChordShape.duration`, en beats) :

| Note | Beats |
| --- | --- |
| Double-croche | ¼ (0.25) |
| Croche | ½ (0.5) |
| Noire | 1 |
| Blanche | 2 |
| Ronde | 4 |
| Carrée | 8 |

Pointage : `dotted: true` multiplie par 1.5 (`beatsForShape`).

## 2. Mesures (mètre)

- Signature **optionnelle** par chanson : `song.timeSignature = { top, bottom }`.
  Absente → pas de regroupement en mesures (les diagrammes restent un flux de beats).
- Nombre de noires par mesure = `top × (4 / bottom)` :
  - 4/4 → 4, 3/4 → 3, 2/4 → 2, 6/8 → 3 (6 croches), 2/2 → 2.
- La **1ʳᵉ mesure peut être incomplète** (anacrouse) : le comptage part de 0, rien n'est forcé.
- Les durées peuvent **déborder** d'une mesure : la musique prime sur la grille, pas d'erreur.
- Temp fort : le 1ᵉʳ temps de chaque mesure est mis en évidence (badge « Mesure N »).

## 3. Structure de chanson et sections

- `SavedChordShape.bar: true` = barre de mesure séparant des sections.
- `barKind` : type de barre de notation musicale (glyphes SVG dessinés dans `BarGlyph.tsx`) :
  - `standard` : barre simple `│`
  - `double` : barre double `‖` (défaut)
  - `end` : barre finale (fin de morceau)
  - `beginRepeat` / `endRepeat` / `bothRepeat` : signes de répétition `𝄆 ‖ ‖ 𝄇`
- `repeats` sur une barre = nombre de fois que la **section précédente** est rejouée.
- `repeats: 0` = délimite la section, jouée 1× (utilisé pour marquer le début d'une section).
- **Renvois (`navKind`)** : marqueurs de direction sans durée (`SavedChordShape.navKind`), ignorés par la lecture — Segno 𝄋, Coda 𝄌, Fine, D.C., D.S., D.C./D.S. al Coda, D.C./D.S. al Fine. Glyphes SVG dans `NavGlyph.tsx`.
- Lecture : `renderSequence` aplatit les sections/répétitions (`Math.max(1, repeats)`).
- Labels de sections : Section, Intro, Verset, Pré-refrain, Refrain, Pré-verset, Pont, Solo, Outro.

## 4. Diagrammes (accords)

- Fret 0 = corde à vide ; `muted` = corde muette (X).
- `baseFret` = frette de départ du diagramme, `barreOn`/`barreCount` = barré.
- Doigtés : 1 index, 2 majeur, 3 annulaire, 4 auriculaire, **5 = Pouce (T)**.
- Capo : appliqué au calcul des fréquences, pas aux frettes du diagramme.

## 5. Articulation

- **Legato** : `legatoTo?: number[]` sur l'accord source → liste de numéros de corde
  liées à l'accord suivant. Type inféré par la différence de frettes :
  - montée = **H** (hammer-on), descente = **P** (pull-off), égalité = `=` (glissé/slur).
- Matérialisé sur l'événement d'arrivée (`SynthEvent.legato`).

## 6. Lecture et audio

- Stems audio (instrumental / voix) stockés localement (IndexedDB), **pas** sur le cloud.
- Hauteurs générées depuis les frettes (fréquences de base des cordes E A D G B e).

## 7. Règles générales

- Aucune signature/mesure/section ne doit limiter les durées saisies.
- Chaque nouvelle idée doit s'ajouter **au-dessus** du flux de beats, sans le restreindre.
- Le rythme reste binaire (simple meter) ; le ternaire (composé, ex. 6/8) est traité
  visuellement via `bottom: 8` mais sans subdivision ternaire dans le moteur.

---

## Points ouverts (évolutions possibles)

- Accents faibles/moyens détaillés (au-delà du seul temps fort).
- Anacrouse réglable explicitement.
- Changement de signature en cours de chanson (ex. pont en 3/4).
- Métriques mixtes.
- Compteur « Mesure N » pendant la lecture (partial : présent dans le Conductor).
- Synchronisation cloud des stems audio.