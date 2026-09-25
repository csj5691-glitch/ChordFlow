"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { use, useState, useCallback, useRef, useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import ChordBuilder from "@/components/ChordBuilder";
import ChordShapeView from "@/components/ChordShapeView";
import { BarGlyph } from "@/components/BarGlyph";
import { NavGlyph } from "@/components/NavGlyph";
import SynthPlayer from "@/components/SynthPlayer";
import Conductor from "@/components/Conductor";
import { loadAudioStems, saveAudioStem, getAudioStemUrl } from "@/lib/audio-store";
import { legatoBetween, measureInfoFromSignature, measureForBeat, beatInMeasure } from "@/lib/chord-synth";
import { getSongTab } from "@/lib/mock-data";
import { useSharedSong } from "@/lib/use-shared-song";
import {
  BAR_KINDS,
  NAV_KINDS,
  type BarKind,
  type NavKind,
  type SavedChordShape,
  type SongTab,
} from "@/lib/types";
import {
  ArrowLeft,
  FileText,
  LayoutGrid,
  Plus,
  Pause,
  Trash2,
  ChevronUp,
  ChevronDown,
  Save,
  Copy,
  Clipboard,
  Mic2,
  Music4,
  Upload,
  Pencil,
} from "lucide-react";

function getStaticSong(id: string): SongTab | null {
  if (id.startsWith("custom-")) return null;
  return getSongTab(id);
}

function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

type EditMode = "grid" | "diagrams";

const DURATION_OPTIONS = [
  { label: "dble croche · ¼ temps", note: "double-croche", beats: 0.25 },
  { label: "croche · ½ temps", note: "croche", beats: 0.5 },
  { label: "noire · 1 temps", note: "noire", beats: 1 },
  { label: "blanche · 2 temps", note: "blanche", beats: 2 },
  { label: "ronde · 4 temps", note: "ronde", beats: 4 },
  { label: "carrée · 8 temps", note: "carrée", beats: 8 },
] as const;

const NAV_GROUPS: { title: string; kinds: NavKind[] }[] = [
  { title: "Marqueurs", kinds: ["segno", "coda", "fine"] },
  { title: "Directions", kinds: ["dc", "ds"] },
  { title: "Combinaisons", kinds: ["dcAlCoda", "dsAlCoda", "dcAlFine", "dsAlFine"] },
];

function formatBeats(beats: number): string {
  const base = DURATION_OPTIONS.find((o) => o.beats === beats);
  if (base) return base.note;
  const dotted = DURATION_OPTIONS.find((o) => o.beats * 1.5 === beats);
  return dotted ? `${dotted.note} pointée` : String(beats);
}

export default function EditSongPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <EditSongView key={id} id={id} />;
}

function EditSongView({ id }: { id: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [mode, setMode] = useState<EditMode>("grid");
  const [legatoEdit, setLegatoEdit] = useState<number | null>(null);
  const [editableContent, setEditableContent] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [copied, setCopied] = useState<SavedChordShape[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [conductorOpen, setConductorOpen] = useState(false);
  const [toolbarMenu, setToolbarMenu] = useState<"bar" | "nav" | null>(null);
  const [expandedBar, setExpandedBar] = useState<string | null>(null);
  const [instUrl, setInstUrl] = useState<string | null>(null);
  const [instName, setInstName] = useState("");
  const [vocalsUrl, setVocalsUrl] = useState<string | null>(null);
  const [vocalsName, setVocalsName] = useState("");
  const instUrlRef = useRef<string | null>(null);
  const vocalsUrlRef = useRef<string | null>(null);
  const hydratedContent = useRef(false);

  const baseSong = getStaticSong(id);
  const { current: sharedSong, upsert } = useSharedSong(id);
  const song: SongTab | null = hydrated
    ? (sharedSong ?? baseSong)
    : baseSong;

  const diagrams = song?.diagrams ?? [];

  useEffect(() => {
    if (song?.content !== undefined && !hydratedContent.current) {
      hydratedContent.current = true;
      setEditableContent(song.content);
    }
  }, [song]);

  useEffect(() => {
    if (!toolbarMenu) return;
    const close = () => setToolbarMenu(null);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [toolbarMenu]);

  const content = editableContent ?? song?.content ?? "";

  const handleSaveBuilderShape = useCallback(
    (shape: SavedChordShape) => {
      setShowBuilder(false);
      if (!song) return;
      const list = song.diagrams ?? [];
      if (editingId) {
        const idx = list.findIndex((d) => d.id === editingId);
        if (idx >= 0) {
          const next: SongTab = {
            ...song,
            diagrams: list.map((d) => (d.id === editingId ? { ...shape, id: d.id } : d)),
          };
          setEditingId(null);
          upsert(next);
          return;
        }
      }
      const next: SongTab = {
        ...song,
        diagrams: [...list, shape],
      };
      upsert(next);
    },
    [song, editingId, upsert]
  );

  const removeDiagram = useCallback(
    (diagramId: string) => {
      if (!song) return;
      const next: SongTab = {
        ...song,
        diagrams: (song.diagrams ?? []).filter((d) => d.id !== diagramId),
      };
      upsert(next);
    },
    [song, upsert]
  );

  const clearDiagrams = useCallback(() => {
    if (!song) return;
    upsert({ ...song, diagrams: [] });
    setCopied([]);
    setSelected(new Set());
  }, [song, upsert]);

  const moveDiagram = useCallback(
    (index: number, dir: -1 | 1) => {
      if (!song) return;
      const list = [...(song.diagrams ?? [])];
      const target = index + dir;
      if (target < 0 || target >= list.length) return;
      [list[index], list[target]] = [list[target], list[index]];
      upsert({ ...song, diagrams: list });
    },
    [song, upsert]
  );

  const copyDiagrams = useCallback(
    (index?: number) => {
      if (!song) return;
      const list = song.diagrams ?? [];
      const indices =
        selected.size > 0
          ? [...selected].sort((a, b) => a - b)
          : index !== undefined
            ? [index]
            : [];
      const picked = indices
        .filter((i) => i >= 0 && i < list.length)
        .map((i) => list[i]);
      if (picked.length === 0) return;
      setCopied(picked.map((d) => ({ ...d, id: `${d.id}-copy` })));
    },
    [song, selected]
  );

  const pasteDiagrams = useCallback(
    (index: number) => {
      if (!song || copied.length === 0) return;
      const list = [...(song.diagrams ?? [])];
      const pasted = copied.map((d) => ({
        ...d,
        id: `paste-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      }));
      list.splice(index + 1, 0, ...pasted);
      upsert({ ...song, diagrams: list });
    },
    [song, copied, upsert]
  );

  const toggleSelected = useCallback((index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const saveContent = useCallback(() => {
    if (!song) return;
    upsert({ ...song, content: editableContent ?? song.content });
  }, [song, editableContent, upsert]);

  const setBpm = useCallback(
    (bpm: number) => {
      if (!song) return;
      upsert({ ...song, bpm: Math.min(500, Math.max(20, Math.round(bpm))) });
    },
    [song, upsert]
  );

  const setTimeSignature = useCallback(
    (top: number, bottom: 2 | 4 | 8) => {
      if (!song) return;
      upsert({ ...song, timeSignature: { top, bottom } });
    },
    [song, upsert]
  );

  const clearTimeSignature = useCallback(() => {
    if (!song) return;
    upsert({ ...song, timeSignature: undefined });
  }, [song, upsert]);

  const setDuration = useCallback(
    (index: number, beats: number) => {
      if (!song) return;
      const list = [...(song.diagrams ?? [])];
      if (!list[index]) return;
      list[index] = { ...list[index], duration: beats };
      upsert({ ...song, diagrams: list });
    },
    [song, upsert]
  );

  const setDotted = useCallback(
    (index: number, dotted: boolean) => {
      if (!song) return;
      const list = [...(song.diagrams ?? [])];
      if (!list[index]) return;
      list[index] = { ...list[index], dotted };
      upsert({ ...song, diagrams: list });
    },
    [song, upsert]
  );

  const setEnding = useCallback(
    (index: number, ending: 1 | 2 | undefined) => {
      if (!song) return;
      const list = [...(song.diagrams ?? [])];
      if (!list[index]) return;
      list[index] = { ...list[index], ending };
      upsert({ ...song, diagrams: list });
    },
    [song, upsert]
  );

  const setLegato = useCallback(
    (index: number, stringIndex: number | null) => {
      if (!song) return;
      const list = [...(song.diagrams ?? [])];
      if (!list[index]) return;
      const d = list[index];
      if (stringIndex === null) {
        list[index] = { ...d, legatoTo: undefined };
      } else {
        const current = d.legatoTo ?? [];
        const has = current.includes(stringIndex);
        const next = has
          ? current.filter((s) => s !== stringIndex)
          : [...current, stringIndex].sort((a, b) => a - b);
        list[index] = { ...d, legatoTo: next.length > 0 ? next : undefined };
      }
      upsert({ ...song, diagrams: list });
    },
    [song, upsert]
  );

  const addSilence = useCallback(() => {
    if (!song) return;
    const silence: SavedChordShape = {
      id: `sil-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: "Silence",
      fingers: [],
      barreOn: false,
      barreCount: 6,
      muted: Array(6).fill(true),
      baseFret: 1,
      capo: 0,
      duration: 1,
      silence: true,
    };
    upsert({ ...song, diagrams: [...(song.diagrams ?? []), silence] });
  }, [song, upsert]);

  const addBar = useCallback((kind: BarKind = "double") => {
    if (!song) return;
    const meta = BAR_KINDS.find((b) => b.kind === kind) ?? BAR_KINDS[1];
    const bar: SavedChordShape = {
      id: `bar-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: meta.symbol,
      fingers: [],
      barreOn: false,
      barreCount: 6,
      muted: [],
      baseFret: 1,
      capo: 0,
      duration: 0,
      bar: true,
      barKind: kind,
      repeats: 1,
      sectionLabel: "Section",
    };
    upsert({ ...song, diagrams: [...(song.diagrams ?? []), bar] });
  }, [song, upsert]);

  const setBarKind = useCallback(
    (index: number, kind: BarKind) => {
      if (!song) return;
      const list = [...(song.diagrams ?? [])];
      if (!list[index]) return;
      const meta = BAR_KINDS.find((b) => b.kind === kind) ?? BAR_KINDS[1];
      list[index] = { ...list[index], barKind: kind, label: meta.symbol };
      upsert({ ...song, diagrams: list });
    },
    [song, upsert]
  );

  const addNav = useCallback((kind: NavKind) => {
    if (!song) return;
    const meta = NAV_KINDS.find((n) => n.kind === kind) ?? NAV_KINDS[0];
    const nav: SavedChordShape = {
      id: `nav-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: meta.label,
      fingers: [],
      barreOn: false,
      barreCount: 6,
      muted: [],
      baseFret: 1,
      capo: 0,
      duration: 0,
      navKind: kind,
    };
    upsert({ ...song, diagrams: [...(song.diagrams ?? []), nav] });
  }, [song, upsert]);

  const setRepeats = useCallback(
    (index: number, repeats: number) => {
      if (!song) return;
      const list = [...(song.diagrams ?? [])];
      if (!list[index]) return;
      list[index] = { ...list[index], repeats: Math.min(32, Math.max(0, repeats)) };
      upsert({ ...song, diagrams: list });
    },
    [song, upsert]
  );

  const setSectionLabel = useCallback(
    (index: number, sectionLabel: string) => {
      if (!song) return;
      const list = [...(song.diagrams ?? [])];
      if (!list[index]) return;
      list[index] = { ...list[index], sectionLabel };
      upsert({ ...song, diagrams: list });
    },
    [song, upsert]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stems = await loadAudioStems(id);
      if (cancelled || !stems) return;
      if (stems.noVocals) {
        const url = getAudioStemUrl(stems.noVocals);
        if (url) {
          instUrlRef.current = url;
          setInstUrl(url);
          setInstName("Instrumental");
        }
      }
      if (stems.vocals) {
        const url = getAudioStemUrl(stems.vocals);
        if (url) {
          vocalsUrlRef.current = url;
          setVocalsUrl(url);
          setVocalsName("Voix");
        }
      }
    })();
    return () => {
      cancelled = true;
      if (instUrlRef.current) {
        URL.revokeObjectURL(instUrlRef.current);
        instUrlRef.current = null;
      }
      if (vocalsUrlRef.current) {
        URL.revokeObjectURL(vocalsUrlRef.current);
        vocalsUrlRef.current = null;
      }
    };
  }, [id]);

  const handleStemUpload = async (kind: "noVocals" | "vocals", file: File) => {
    const setUrl =
      kind === "noVocals"
        ? setInstUrl
        : setVocalsUrl;
    const setName = kind === "noVocals" ? setInstName : setVocalsName;
    const urlRef = kind === "noVocals" ? instUrlRef : vocalsUrlRef;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    const url = getAudioStemUrl(file);
    if (!url) return;
    urlRef.current = url;
    setUrl(url);
    setName(file.name);
    try {
      await saveAudioStem(id, kind, file);
    } catch (err) {
      console.error("[ChordFlow] Éditeur : échec de sauvegarde du stem", err);
    }
  };

  const handleStemClear = async (kind: "noVocals" | "vocals") => {
    const setUrl = kind === "noVocals" ? setInstUrl : setVocalsUrl;
    const setName = kind === "noVocals" ? setInstName : setVocalsName;
    const urlRef = kind === "noVocals" ? instUrlRef : vocalsUrlRef;
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setUrl(null);
    setName("");
    try {
      await saveAudioStem(id, kind, null);
    } catch (err) {
      console.error("[ChordFlow] Éditeur : échec de retrait du stem", err);
    }
  };

  const bpm = song?.bpm ?? 90;
  const secondsFor = (beats: number) => (beats * 60) / bpm;
  const beatsFor = (d: SavedChordShape) => (d.duration ?? 1) * (d.dotted ? 1.5 : 1);

  const totalBeats = (() => {
    const list = song?.diagrams ?? [];
    let sectionBeats = 0;
    let ending1 = 0;
    let ending2 = 0;
    let total = 0;
    for (const d of list) {
      if (d.bar) {
        const loops = Math.max(1, d.repeats ?? 1);
        if (loops > 1 && (ending1 > 0 || ending2 > 0)) {
          total += sectionBeats * loops + ending1 * (loops - 1);
        } else {
          total += sectionBeats * loops;
        }
        sectionBeats = 0;
        ending1 = 0;
        ending2 = 0;
      } else if (d.navKind) {
        // marqueur sans durée
      } else if (d.ending === 1) {
        ending1 += beatsFor(d);
      } else if (d.ending === 2) {
        ending2 += beatsFor(d);
      } else {
        sectionBeats += beatsFor(d);
      }
    }
    return total + sectionBeats;
  })();

  const measureState = (() => {
    const list = song?.diagrams ?? [];
    const mi = measureInfoFromSignature(song?.timeSignature);
    const hasSignature = Boolean(song?.timeSignature);
    const out: { measure: number; beat: number; downbeat: boolean }[] = [];
    let cursor = 0;
    for (const d of list) {
      if (d.bar || d.navKind) {
        out.push({ measure: -1, beat: -1, downbeat: false });
        continue;
      }
      const beats = beatsFor(d);
      const m = hasSignature ? measureForBeat(cursor, mi) : -1;
      const b = hasSignature ? beatInMeasure(cursor, mi) : -1;
      const downbeat = hasSignature && b === 0;
      out.push({ measure: m, beat: b, downbeat });
      cursor += beats;
    }
    return { hasSignature, mi, rows: out };
  })();

  if (!song) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <p className="text-zinc-500 text-lg">Chanson introuvable</p>
        <button
          onClick={() => router.push("/")}
          className="text-amber-400 hover:text-amber-300 flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Retour
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      <header className="sticky top-0 z-10 bg-black/80 backdrop-blur-lg border-b border-zinc-800/50">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => router.push(`/song/${id}`)}
            className="p-2 hover:bg-zinc-800 rounded-lg transition-colors"
            title="Retour à la chanson"
          >
            <ArrowLeft className="w-5 h-5 text-zinc-400" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-white truncate">Éditer</h1>
            <p className="text-sm text-zinc-400 truncate">
              {song.title} — {song.artist}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setMode("grid")}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                mode === "grid"
                  ? "text-black bg-amber-400"
                  : "text-zinc-400 bg-zinc-800 hover:bg-zinc-700"
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              Grille
            </button>
            <button
              onClick={() => setMode("diagrams")}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                mode === "diagrams"
                  ? "text-black bg-amber-400"
                  : "text-zinc-400 bg-zinc-800 hover:bg-zinc-700"
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              Diagrammes
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6 flex flex-col gap-6">
        {mode === "grid" ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-zinc-300">
                Grille d&apos;accords / paroles
              </h2>
              <button
                onClick={saveContent}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-500 text-black hover:bg-amber-400 transition-colors"
              >
                <Save className="w-3.5 h-3.5" />
                Enregistrer
              </button>
            </div>
            <textarea
              value={content}
              onChange={(e) => setEditableContent(e.target.value)}
              spellCheck={false}
              className="w-full h-[60vh] bg-zinc-950 border border-zinc-700 rounded-xl p-4 font-mono text-sm text-zinc-200 focus:outline-none focus:border-amber-500/60 resize-y"
            />
            <p className="text-[11px] text-zinc-600">
              Format : lignes d&apos;accords au-dessus des paroles, sections
              entre crochets. Les diagrammes sont regénérés depuis les noms.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-sm font-bold text-zinc-300">
                  Séquence de diagrammes ({diagrams.length})
                </h2>
                <span className="text-[10px] text-zinc-600 bg-zinc-800/60 rounded px-1.5 py-0.5">
                  Convention : 1 beat = 1 temps = 1 noire · 2 temps = 1 blanche · 4 temps = 1 ronde
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-zinc-500">Signature</span>
                  <select
                    value={
                      song.timeSignature
                        ? `${song.timeSignature.top}/${song.timeSignature.bottom}`
                        : ""
                    }
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) {
                        clearTimeSignature();
                        return;
                      }
                      const [top, bottom] = v.split("/").map(Number);
                      setTimeSignature(top, bottom as 2 | 4 | 8);
                    }}
                    className="bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 px-2 py-1.5 focus:outline-none focus:border-amber-500/60 cursor-pointer"
                    title="Signature de mesure (optionnelle) — regroupe les diagrammes en mesures"
                  >
                    <option value="">— aucune —</option>
                    <option value="2/4">2/4</option>
                    <option value="3/4">3/4</option>
                    <option value="4/4">4/4</option>
                    <option value="6/8">6/8</option>
                  </select>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setBpm(bpm - 1)}
                      className="w-7 h-7 rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors text-sm font-bold"
                      title="Moins"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min={20}
                      max={500}
                      value={bpm}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        if (!Number.isNaN(v)) setBpm(v);
                      }}
                      className="w-16 h-7 rounded-md bg-zinc-950 border border-zinc-700 text-center text-sm text-amber-400 font-semibold focus:outline-none focus:border-amber-500/60"
                    />
                    <button
                      onClick={() => setBpm(bpm + 1)}
                      className="w-7 h-7 rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors text-sm font-bold"
                      title="Plus"
                    >
                      +
                    </button>
                  </div>
                  <span className="text-[11px] text-zinc-500">
                    Temps total ≈ {secondsFor(totalBeats).toFixed(1)} s
                  </span>
                </div>
              </div>
              <SynthPlayer diagrams={diagrams} bpm={bpm} />
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setConductorOpen(true)}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-500 text-black hover:bg-amber-400 transition-colors w-fit"
                  title="Lancer la lecture plein écran avec les diagrammes qui défilent"
                >
                  <Mic2 className="w-3.5 h-3.5" />
                  Chef d&apos;orchestre
                </button>
                <label
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors w-fit cursor-pointer select-none"
                  title={
                    instUrl
                      ? "Changer le stem instrumental (sans voix)"
                      : "Importer un stem instrumental (sans voix) : le Chef d'orchestre le jouera avec les accords pour vérifier le rythme"
                  }
                >
                  <Upload className="w-3.5 h-3.5" />
                  {instUrl ? "Changer : instrumental" : "Stem instrumental"}
                  <input
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleStemUpload("noVocals", file);
                      e.target.value = "";
                    }}
                  />
                </label>
                {instUrl && (
                  <>
                    <button
                      onClick={() => void handleStemClear("noVocals")}
                      className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-zinc-800 text-red-400 hover:bg-red-500/10 transition-colors w-fit cursor-pointer"
                      title="Retirer le stem instrumental"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Retirer
                    </button>
                    <span className="flex items-center gap-1.5 text-[11px] text-purple-400 bg-purple-500/10 border border-purple-500/30 rounded-full px-2.5 py-1">
                      <Music4 className="w-3 h-3" />
                      {instName || "Instrumental"} chargé
                    </span>
                  </>
                )}
                <label
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors w-fit cursor-pointer select-none"
                  title={
                    vocalsUrl
                      ? "Changer le stem vocal (voix seule)"
                      : "Importer un stem vocal (voix seule) : le Chef d'orchestre le jouera avec les accords"
                  }
                >
                  <Upload className="w-3.5 h-3.5" />
                  {vocalsUrl ? "Changer : voix" : "Stem voix"}
                  <input
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleStemUpload("vocals", file);
                      e.target.value = "";
                    }}
                  />
                </label>
                {vocalsUrl && (
                  <>
                    <button
                      onClick={() => void handleStemClear("vocals")}
                      className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-zinc-800 text-red-400 hover:bg-red-500/10 transition-colors w-fit cursor-pointer"
                      title="Retirer le stem vocal"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Retirer
                    </button>
                    <span className="flex items-center gap-1.5 text-[11px] text-purple-400 bg-purple-500/10 border border-purple-500/30 rounded-full px-2.5 py-1">
                      <Music4 className="w-3 h-3" />
                      {vocalsName || "Voix"} chargé
                    </span>
                  </>
                )}
                {(instUrl || vocalsUrl) && (
                  <span className="text-[11px] text-zinc-600">
                    Volume de chaque piste réglable dans le Chef d&apos;orchestre
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={addSilence}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-zinc-700 text-zinc-200 hover:bg-zinc-600 transition-colors w-fit"
                  title="Ajouter un silence à la séquence"
                >
                  <Pause className="w-3.5 h-3.5" />
                  Silence
                </button>
                <div className="relative">
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => setToolbarMenu(toolbarMenu === "bar" ? null : "bar")}
                    className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors w-fit ${
                      toolbarMenu === "bar"
                        ? "bg-amber-500 text-black"
                        : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                    }`}
                    title="Ajouter une barre de mesure"
                  >
                    <BarGlyph kind="double" className="w-5 h-4 text-current" />
                    Barre
                    {toolbarMenu === "bar" ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>
                  {toolbarMenu === "bar" && (
                    <div
                      onPointerDown={(e) => e.stopPropagation()}
                      className="absolute z-20 left-0 mt-1 w-52 bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl p-2 flex flex-col gap-1"
                    >
                      <span className="text-[10px] text-zinc-500 px-2 pt-1 select-none">
                        Barres de mesure
                      </span>
                      {BAR_KINDS.map((bk) => (
                        <button
                          key={bk.kind}
                          onClick={() => {
                            addBar(bk.kind);
                            setToolbarMenu(null);
                          }}
                          className="flex items-center gap-2 text-xs font-semibold px-2 py-1.5 rounded-md bg-zinc-800 text-zinc-200 hover:bg-zinc-700 hover:text-amber-300 transition-colors text-left w-full"
                        >
                          <span className="w-8 flex justify-center">
                            <BarGlyph kind={bk.kind} className="w-7 h-6 text-zinc-300" />
                          </span>
                          {bk.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="relative">
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => setToolbarMenu(toolbarMenu === "nav" ? null : "nav")}
                    className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors w-fit ${
                      toolbarMenu === "nav"
                        ? "bg-amber-500 text-black"
                        : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                    }`}
                    title="Ajouter un renvoi (segno, coda, fine, D.C., D.S.)"
                  >
                    <NavGlyph kind="segno" className="w-5 h-5 text-current" />
                    Renvoi
                    {toolbarMenu === "nav" ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>
                  {toolbarMenu === "nav" && (
                    <div
                      onPointerDown={(e) => e.stopPropagation()}
                      className="absolute z-20 left-0 mt-1 w-56 bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl p-2 flex flex-col gap-1"
                    >
                      {NAV_GROUPS.map((g) => (
                        <div key={g.title} className="flex flex-col gap-1">
                          <span className="text-[10px] text-zinc-500 px-2 pt-1 select-none">
                            {g.title}
                          </span>
                          {g.kinds.map((kind) => {
                            const nk = NAV_KINDS.find((k) => k.kind === kind);
                            if (!nk) return null;
                            return (
                              <button
                                key={nk.kind}
                                onClick={() => {
                                  addNav(nk.kind);
                                  setToolbarMenu(null);
                                }}
                                className="flex items-center gap-2 text-xs font-semibold px-2 py-1.5 rounded-md bg-zinc-800 text-zinc-200 hover:bg-zinc-700 hover:text-amber-300 transition-colors text-left w-full"
                              >
                                <span className="w-8 flex justify-center">
                                  <NavGlyph kind={nk.kind} className="w-6 h-5 text-zinc-300" />
                                </span>
                                {nk.label}
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {copied.length > 0 && (
                  <span className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-2.5 py-1">
                    <Copy className="w-3 h-3" />
                    {copied.length} {copied.length > 1 ? "diagrammes" : "diagramme"} copié{copied.length > 1 ? "s" : ""}
                  </span>
                )}
                {selected.size > 0 && (
                  <button
                    onClick={() => setSelected(new Set())}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors w-fit"
                    title="Effacer la sélection"
                  >
                    {selected.size} sélectionné{selected.size > 1 ? "s" : ""} — effacer
                  </button>
                )}
                {selected.size > 0 && (
                  <button
                    onClick={() => copyDiagrams()}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-sky-500 text-black hover:bg-sky-400 transition-colors w-fit"
                    title="Copier les diagrammes sélectionnés"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Copier la sélection
                  </button>
                )}
                {diagrams.length > 0 && (
                  <button
                    onClick={clearDiagrams}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 border border-red-500/40 hover:bg-red-500/20 transition-colors w-fit"
                    title="Supprimer tous les diagrammes"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Tout supprimer
                  </button>
                )}
              </div>

              {showBuilder && (
                <div id="chord-builder" className="mt-2">
                  <ChordBuilder
                    key={editingId ?? "new"}
                    initialShape={editingId ? (song?.diagrams ?? []).find((d) => d.id === editingId) ?? null : null}
                    onSaveShape={handleSaveBuilderShape}
                  />
                </div>
              )}
            </div>

            {diagrams.length === 0 ? (
              <p className="text-sm text-zinc-600">
                Aucun diagramme. Créez-en un avec le créateur ci-dessus.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {diagrams.map((d, i) => (
                  <div
                    key={d.id}
                    className="bg-zinc-900 border border-zinc-700 rounded-xl p-3 flex flex-col sm:flex-row items-center gap-4"
                  >
                    {!(d.bar) && measureState.hasSignature && (
                      <div className="w-40 flex-shrink-0 h-6 flex items-center justify-center">
                        {measureState.rows[i].downbeat ? (
                          <span className="text-[10px] font-mono font-bold text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded-full px-2 py-0.5">
                            Mesure {measureState.rows[i].measure + 1}
                          </span>
                        ) : (
                          <span className="text-[10px] font-mono text-zinc-600 px-2 py-0.5">
                            {measureState.rows[i].beat + 1}/{measureState.mi.top}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="w-40 flex-shrink-0">
                      <ChordShapeView
                        shape={d}
                        onNoteClick={
                          legatoEdit === i
                            ? (s) => {
                                setLegato(i, s);
                                setLegatoEdit(null);
                              }
                            : undefined
                        }
                        legatoStrings={d.legatoTo}
                      />
                      {legatoEdit === i && (
                        <p className="text-[10px] text-sky-400 mt-1 italic text-center">
                          Cliquez la note à lier vers {diagrams[i + 1]?.label}
                        </p>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-amber-400">
                        {d.navKind
                          ? NAV_KINDS.find((n) => n.kind === d.navKind)?.label ??
                            d.label
                          : d.bar
                            ? d.sectionLabel && d.sectionLabel !== "Section"
                              ? d.sectionLabel
                              : BAR_KINDS.find(
                                  (b) => b.kind === (d.barKind ?? "double")
                                )?.label ?? "Barre"
                            : d.label}
                      </p>
                      <p className="text-[11px] text-zinc-500">
                        {d.navKind
                          ? "Marqueur de renvoi (sans durée)"
                          : d.bar
                            ? (d.repeats ?? 1) === 0
                              ? "Délimite la fin de la section"
                              : `Rejoue la section précédente ${(d.repeats ?? 1)} fois`
                            : `Position ${i + 1}`}
                      </p>
                    </div>
                    <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
                      {d.bar ? (
                        <div className="flex flex-col items-center gap-1.5">
                          <span className="text-[10px] text-zinc-500 font-mono">
                            {BAR_KINDS.find((b) => b.kind === (d.barKind ?? "double"))?.symbol ?? "||"}{" "}
                            × {(d.repeats ?? 1) === 0 ? 1 : d.repeats}
                          </span>
                          <button
                            onClick={() => setExpandedBar(expandedBar === d.id ? null : d.id)}
                            className={`flex items-center gap-1.5 text-[10px] font-semibold px-2.5 py-1.5 rounded-lg transition-colors w-full justify-center ${
                              expandedBar === d.id
                                ? "bg-amber-500/15 text-amber-300 border border-amber-500/40 hover:bg-amber-500/25"
                                : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                            }`}
                            title={
                              expandedBar === d.id
                                ? "Replier les réglages de la barre"
                                : "Déplier les réglages (type, section, répétitions)"
                            }
                          >
                            {expandedBar === d.id ? (
                              <ChevronUp className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5" />
                            )}
                            {expandedBar === d.id ? "Replier" : "Régler"}
                          </button>
                          {expandedBar === d.id && (
                            <>
                              <select
                                value={d.barKind ?? "double"}
                                onChange={(e) => setBarKind(i, e.target.value as BarKind)}
                                className="bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 px-2 py-1.5 focus:outline-none focus:border-amber-500/60 cursor-pointer w-full"
                                title="Type de barre de mesure"
                              >
                                {BAR_KINDS.map((bk) => (
                                  <option key={bk.kind} value={bk.kind}>
                                    {bk.label}
                                  </option>
                                ))}
                              </select>
                              <select
                                value={d.sectionLabel ?? "Section"}
                                onChange={(e) => setSectionLabel(i, e.target.value)}
                                className="bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 px-2 py-1.5 focus:outline-none focus:border-amber-500/60 cursor-pointer w-full"
                                title="Type de section délimitée par cette barre"
                              >
                                <option value="Section">Section</option>
                                <option value="Intro">Intro</option>
                                <option value="Couplet">Couplet</option>
                                <option value="Pré-refrain">Pré-refrain</option>
                                <option value="Refrain">Refrain</option>
                                <option value="Pré-couplet">Pré-couplet</option>
                                <option value="Pont">Pont</option>
                                <option value="Solo">Solo</option>
                                <option value="Outro">Outro</option>
                              </select>
                              <div className="flex flex-col items-center gap-1">
                                <span className="text-[10px] text-zinc-500">
                                  Répéter la section ×
                                </span>
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => setRepeats(i, (d.repeats ?? 1) - 1)}
                                    disabled={(d.repeats ?? 1) <= 0}
                                    className="w-7 h-7 rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm font-bold"
                                    title="Moins de répétitions"
                                  >
                                    −
                                  </button>
                                  <input
                                    type="number"
                                    min={0}
                                    max={32}
                                    value={d.repeats ?? 1}
                                    onChange={(e) => {
                                      const v = parseInt(e.target.value, 10);
                                      if (!Number.isNaN(v)) setRepeats(i, v);
                                    }}
                                    className="w-12 h-7 rounded-md bg-zinc-950 border border-zinc-700 text-center text-sm text-amber-400 font-semibold focus:outline-none focus:border-amber-500/60"
                                    title="0 = délimiter la section ; 1+ = répéter la section"
                                  />
                                  <button
                                    onClick={() => setRepeats(i, (d.repeats ?? 1) + 1)}
                                    disabled={(d.repeats ?? 1) >= 32}
                                    className="w-7 h-7 rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm font-bold"
                                    title="Plus de répétitions"
                                  >
                                    +
                                  </button>
                                </div>
                              </div>
                              {(d.repeats ?? 1) === 0 && (
                                <span className="text-[10px] text-emerald-400">
                                  Définit la section, jouée 1×
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center gap-1">
                          <select
                            value={d.ending ? String(d.ending) : ""}
                            onChange={(e) =>
                              setEnding(i, e.target.value ? (parseInt(e.target.value, 10) as 1 | 2) : undefined)
                            }
                            className="bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 px-2 py-1.5 focus:outline-none focus:border-amber-500/60 cursor-pointer"
                            title="Fin alternative : ce diagramme n'est joué qu'au tour indiqué quand la barre de reprise répète cette section (1 = 1ʳᵉ fin, 2 = dernière fin)"
                          >
                            <option value="">Fin —</option>
                            <option value="1">1.</option>
                            <option value="2">2.</option>
                          </select>
                          <select
                            value={d.duration ?? 1}
                            onChange={(e) => setDuration(i, parseFloat(e.target.value))}
                              className="bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 px-2 py-1.5 focus:outline-none focus:border-amber-500/60 cursor-pointer"
                              title="Durée de cet accord"
                            >
                              {DURATION_OPTIONS.map((o) => (
                                <option key={o.label} value={o.beats}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                            <label className="flex flex-col items-center gap-0.5 cursor-pointer select-none" title="Pointé (×1,5)">
                              <input
                                type="checkbox"
                                checked={d.dotted === true}
                                onChange={(e) => setDotted(i, e.target.checked)}
                                className="w-4 h-4 accent-amber-500 cursor-pointer"
                              />
                              <span className="text-[10px] text-zinc-500">Pointé</span>
                            </label>
                          </div>
                          <span className="text-[10px] text-zinc-500">
                            <span className="text-zinc-400">{formatBeats(beatsFor(d))}</span>{" "}
                            · {secondsFor(beatsFor(d)).toFixed(2)} s
                          </span>
                          {i < diagrams.length - 1 &&
                            !diagrams[i + 1].bar &&
                            !diagrams[i + 1].silence && (
                              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                <button
                                  onClick={() => {
                                    setLegatoEdit(legatoEdit === i ? null : i);
                                  }}
                                  className={`text-[10px] px-2 py-1 rounded font-semibold transition-colors ${
                                    legatoEdit === i
                                      ? "bg-sky-500 text-black"
                                      : (d.legatoTo?.length ?? 0) > 0
                                        ? "bg-sky-500/15 text-sky-300 border border-sky-500/40 hover:bg-sky-500/25"
                                        : "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
                                  }`}
                                  title="Créer un legato (hammer-on / pull-off) vers l'accord suivant — cliquez une ou plusieurs notes du diagramme"
                                >
                                  {legatoEdit === i
                                    ? "Cliquez les notes →"
                                    : (d.legatoTo?.length ?? 0) > 0
                                      ? `Legato ✓ (${d.legatoTo?.length ?? 0})`
                                      : "Legato"}
                                </button>
                                {legatoEdit === i && (
                                  <button
                                    onClick={() => {
                                      setLegatoEdit(null);
                                    }}
                                    className="text-[10px] px-2 py-1 rounded bg-zinc-700 text-zinc-300 hover:bg-zinc-600 transition-colors"
                                  >
                                    Terminé
                                  </button>
                                )}
                                {legatoBetween(d, diagrams[i + 1])?.map((lg) => (
                                  <span
                                    key={lg.string}
                                    onClick={() => {
                                      if (legatoEdit === i) setLegato(i, lg.string);
                                    }}
                                    className={`text-[10px] font-mono text-sky-300 bg-sky-500/10 border border-sky-500/30 rounded px-1.5 py-0.5 whitespace-nowrap ${
                                      legatoEdit === i ? "cursor-pointer hover:bg-sky-500/25" : ""
                                    }`}
                                    title={
                                      legatoEdit === i
                                        ? "Cliquez pour retirer cette liaison"
                                        : lg.kind === "H"
                                          ? `Hammer-on corde ${["E", "A", "D", "G", "B", "e"][lg.string]} (${lg.fromFret}→${lg.toFret})`
                                          : `Pull-off corde ${["E", "A", "D", "G", "B", "e"][lg.string]} (${lg.fromFret}→${lg.toFret})`
                                    }
                                  >
                                    {lg.kind === "H"
                                      ? `H ${lg.fromFret}→${lg.toFret} · ${["E", "A", "D", "G", "B", "e"][lg.string]}`
                                      : `P ${lg.fromFret}→${lg.toFret} · ${["E", "A", "D", "G", "B", "e"][lg.string]}`}
                                  </span>
                                ))}
                              </div>
                            )}
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => toggleSelected(i)}
                        className={`flex items-center justify-center w-9 h-9 rounded-lg border transition-colors ${
                          selected.has(i)
                            ? "bg-sky-500 border-sky-400 text-black"
                            : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                        }`}
                        title={
                          selected.has(i)
                            ? "Désélectionner ce diagramme"
                            : "Sélectionner ce diagramme (copie multiple)"
                        }
                      >
                        <span className="text-xs font-bold">
                          {selected.has(i) ? "✓" : String(i + 1)}
                        </span>
                      </button>
                      <button
                        onClick={() => {
                          setEditingId(d.id);
                          setShowBuilder(true);
                          setTimeout(() => {
                            document.getElementById("chord-builder")?.scrollIntoView({ behavior: "smooth", block: "start" });
                          }, 50);
                        }}
                        disabled={Boolean(d.silence || d.bar || d.navKind)}
                        className={`flex items-center gap-1 p-2 rounded-lg transition-colors ${
                          d.silence || d.bar || d.navKind
                            ? "bg-zinc-800/40 text-zinc-600 cursor-not-allowed"
                            : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                        }`}
                        title={
                          d.silence || d.bar || d.navKind
                            ? "Ce diagramme n'est pas un accord à éditer"
                            : "Éditer ce diagramme"
                        }
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => copyDiagrams(i)}
                        className="flex items-center gap-1 p-2 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
                        title="Copier ce diagramme (ou la sélection si des coches sont actives)"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => pasteDiagrams(i)}
                        disabled={copied.length === 0}
                        className="flex items-center gap-1 p-2 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        title="Coller après ce diagramme"
                      >
                        <Clipboard className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => moveDiagram(i, -1)}
                        disabled={i === 0}
                        className="p-2 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        title="Monter"
                      >
                        <ChevronUp className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => moveDiagram(i, 1)}
                        disabled={i === diagrams.length - 1}
                        className="p-2 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        title="Descendre"
                      >
                        <ChevronDown className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => removeDiagram(d.id)}
                        className="p-2 rounded-lg bg-zinc-800 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Supprimer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
      {!conductorOpen && (
        <button
          onClick={() => {
            setShowBuilder((v) => {
              const next = !v;
              if (next) {
                setTimeout(() => {
                  document.getElementById("chord-builder")?.scrollIntoView({ behavior: "smooth", block: "start" });
                }, 50);
              }
              return next;
            });
          }}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-full bg-sky-500 text-black hover:bg-sky-400 shadow-lg shadow-sky-500/30 transition-colors"
          title={showBuilder ? "Masquer le créateur de diagramme" : "Créer un nouveau diagramme"}
        >
          <Plus className="w-4 h-4" />
          {showBuilder ? "Masquer le créateur" : "Créer un diagramme"}
        </button>
      )}
      {conductorOpen && (
        <Conductor
          diagrams={diagrams}
          bpm={bpm}
          timeSignature={song?.timeSignature}
          content={content}
          officialPlain={song?.officialPlain}
          officialSynced={song?.officialSynced}
          instrumentalUrl={instUrl}
          vocalsUrl={vocalsUrl}
          onClose={() => setConductorOpen(false)}
        />
      )}
    </div>
  );
}