"use client";
// Copyright (c) 2026 Claude St-Jean. All rights reserved.

import { use, useState, useCallback, useRef, useEffect, useSyncExternalStore, useMemo } from "react";
import { useRouter } from "next/navigation";
import ChordBuilder from "@/components/ChordBuilder";
import ChordShapeView from "@/components/ChordShapeView";
import { BarGlyph } from "@/components/BarGlyph";
import { NavGlyph } from "@/components/NavGlyph";
import Conductor from "@/components/Conductor";
import TabStaffView from "@/components/TabStaffView";
import { loadAudioStems, loadMidiBlob, saveAudioStem, getAudioStemUrl } from "@/lib/audio-store";
import {
  analyzeGuitarProFile,
  guitarProToMidi,
  importGuitarProNotationAsTab,
  importGuitarProTrack,
  type GpNotationTabResult,
  type GpTrackInfo,
} from "@/lib/gp-import";
import { chordsToDiagrams } from "@/lib/chords-to-diagrams";
import { importMidi } from "@/lib/midi-import";
import { asciiTabToMidi } from "@/lib/ascii-tab-midi";
import { textToTab } from "@/lib/text-to-tab";
import { legatoBetween, measureInfoFromSignature, measureForBeat, beatInMeasure, renderSequence } from "@/lib/chord-synth";
import { gmProgramName } from "@/lib/gm-voice";
import { getSongTab } from "@/lib/mock-data";
import { useSharedSong } from "@/lib/use-shared-song";
import { loadGlobalOffset, saveGlobalOffset, loadBandOffset, saveBandOffset } from "@/lib/line-offsets";
import { loadYouTubeId } from "@/lib/youtube-store";
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
  AudioLines,
  Mic2,
  Music,
  Music4,
  Upload,
  Pencil,
  Check,
  ListMusic,
  Loader2,
  Download,
  Search,
  Lock,
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
  { label: "1/8 de temps", note: "eighth-time", beats: 0.125 },
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
  const base = DURATION_OPTIONS.find((o) => Math.abs(o.beats - beats) < 1e-6);
  if (base) return base.note;
  const dotted = DURATION_OPTIONS.find((o) => Math.abs(o.beats * 1.5 - beats) < 1e-6);
  if (dotted) return `${dotted.note} pointée`;
  return String(beats);
}

type ActiveSlot = { kind: "main" } | { kind: "gp"; index: number };

// Write `diagrams` back into the storage slot owned by `slot`. The active
// sequence always lives in `song.diagrams`; the others stay in their own slot.
function packSlotDiagrams(
  song: SongTab,
  slot: ActiveSlot,
  diagrams: SavedChordShape[]
): Partial<SongTab> {
  if (slot.kind === "main") {
    return { mainDiagrams: diagrams };
  }
  return {
    gpTracks: (song.gpTracks ?? []).map((t) =>
      t.index === slot.index ? { ...t, diagrams } : t
    ),
  };
}

function readSlotDiagrams(song: SongTab, slot: ActiveSlot): SavedChordShape[] {
  if (slot.kind === "main") return song.mainDiagrams ?? song.diagrams ?? [];
  const t = (song.gpTracks ?? []).find((t) => t.index === slot.index);
  return t?.diagrams ?? [];
}

function slotLabel(song: SongTab, slot: ActiveSlot): string {
  if (slot.kind === "main") return "Principale";
  return (
    (song.gpTracks ?? []).find((t) => t.index === slot.index)?.name ??
    `Piste ${slot.index + 1}`
  );
}

function slotKey(slot: ActiveSlot): string {
  return slot.kind === "main" ? "main" : `gp-${slot.index}`;
}

type UndoEntry =
  | { kind: "one"; diagram: SavedChordShape; index: number }
  | { kind: "all"; diagrams: SavedChordShape[]; copied: SavedChordShape[]; selected: Set<number> };

// Aperçu d'une tablature ASCII : bascule « Texte ↔ Tablature HTML », portée
// interactive (flèches, M, T, Suppr…) et import MIDI de l'édition éventuelle.
function TabPreview({
  ascii,
  title,
  bpm,
  onImportMidi,
}: {
  ascii: string;
  title?: string;
  bpm?: number;
  onImportMidi: (ascii: string) => void;
}) {
  const [mode, setMode] = useState<"text" | "tab">("tab");
  const [adapted, setAdapted] = useState<string | null>(null);
  // Remonter l'état quand la source change : le parent remonte ce composant avec
  // un `key` issu du texte ASCII (les éditions ne survivent pas à une nouvelle source).
  const currentAscii = adapted ?? ascii;
  const isAdapted = adapted !== null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        {(["text", "tab"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`text-[10px] font-semibold px-2 py-0.5 rounded-md transition-colors cursor-pointer ${
              mode === m
                ? "bg-amber-400 text-black"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
            }`}
          >
            {m === "text" ? "Texte" : "Tablature"}
          </button>
        ))}
        {isAdapted && (
          <span className="text-[10px] text-emerald-300">
            Édition adaptée
          </span>
        )}
      </div>
      {mode === "text" ? (
        <pre className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-2 text-[11px] text-zinc-300 font-mono overflow-x-auto whitespace-pre max-h-64">
          {currentAscii}
        </pre>
      ) : (
        <TabStaffView title={title} bpm={bpm} tab={currentAscii} editable onChange={setAdapted} />
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => onImportMidi(currentAscii)}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 transition-colors cursor-pointer"
          title="Convertir cette tablature en MIDI puis l'importer (Studio)"
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          Importer en MIDI (Studio)
        </button>
        {isAdapted && (
          <button
            type="button"
            onClick={() => setAdapted(null)}
            className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
          >
            Réinitialiser l&apos;édition
          </button>
        )}
      </div>
    </div>
  );
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
  const [mode, setMode] = useState<EditMode>("diagrams");
  const [legatoEdit, setLegatoEdit] = useState<number | null>(null);
  const [editableContent, setEditableContent] = useState<string | null>(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [copied, setCopied] = useState<SavedChordShape[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const undoRef = useRef<UndoEntry[]>([]);
  const [undoToast, setUndoToast] = useState<{ id: number; message: string } | null>(null);
  const [conductorOpen, setConductorOpen] = useState(false);
  const [toolbarMenu, setToolbarMenu] = useState<"bar" | "nav" | null>(null);
  const [expandedBar, setExpandedBar] = useState<string | null>(null);
  const [instUrl, setInstUrl] = useState<string | null>(null);
  const [instName, setInstName] = useState("");
  const [vocalsUrl, setVocalsUrl] = useState<string | null>(null);
  const [vocalsName, setVocalsName] = useState("");
  const [midiUrl, setMidiUrl] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractElapsed, setExtractElapsed] = useState(0);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [ytVideoId] = useState<string | null>(() => loadYouTubeId(id));
  const [stemStatus, setStemStatus] = useState<{
    status: "checking" | "up" | "down";
    model?: string;
    device?: string;
    cudaAvailable?: boolean;
  }>({ status: "checking" });
  const extractStartRef = useRef(0);
  const [gpImporting, setGpImporting] = useState(false);
  const [gpError, setGpError] = useState<string | null>(null);
  const [gpWarnings, setGpWarnings] = useState<string[]>([]);
  const [gpTracks, setGpTracks] = useState<GpTrackInfo[]>([]);
  const [gpPendingFile, setGpPendingFile] = useState<File | null>(null);
  const [gpImportingTrack, setGpImportingTrack] = useState<number | null>(null);
  const [gpSelected, setGpSelected] = useState<Set<number>>(new Set());
  const [ntLoading, setNtLoading] = useState(false);
  const [ntError, setNtError] = useState<string | null>(null);
  const [ntResult, setNtResult] = useState<{ trackName: string; result: GpNotationTabResult } | null>(null);
  const [stOpen, setStOpen] = useState(false);
  const [stArtist, setStArtist] = useState("");
  const [stTitle, setStTitle] = useState("");
  const [stLink, setStLink] = useState("");
  const [stResults, setStResults] = useState<
    { songId: number; artist: string; title: string; tracksCount: number }[]
  >([]);
  const [stRevisions, setStRevisions] = useState<
    {
      revisionId: number;
      artist: string;
      title: string;
      tracksCount: number;
      createdAt: string;
      exportable: boolean;
    }[]
  >([]);
  const [stRevisionsSong, setStRevisionsSong] = useState<number | null>(null);
  const [stRevisionsLoading, setStRevisionsLoading] = useState(false);
  const [stLoading, setStLoading] = useState(false);
  const [stDownloading, setStDownloading] = useState<number | null>(null);
  const [stError, setStError] = useState<string | null>(null);
  const [stMode, setStMode] = useState<"gp" | "midi">("gp");
  const [tabOpen, setTabOpen] = useState(false);
  const [tabPreviewOpen, setTabPreviewOpen] = useState(false);
  const [tabText, setTabText] = useState("");
  const [tabConverting, setTabConverting] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [genText, setGenText] = useState("");
  const [genPreview, setGenPreview] = useState<string | null>(null);
  const [genInfo, setGenInfo] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [genLoading, setGenLoading] = useState(false);
  const [activeSlot, setActiveSlot] = useState<ActiveSlot>({ kind: "main" });
  const [gpMenuOpen, setGpMenuOpen] = useState(false);
  const [lyricsOffset, setLyricsOffset] = useState(() => (id ? loadGlobalOffset(id) : 0));
  const [bandOffset, setBandOffset] = useState(() => (id ? loadBandOffset(id) : 0));
  const [lyricAnchorDiagram, setLyricAnchorDiagram] = useState<number | null>(null);
  const [chartsConverting, setChartsConverting] = useState(false);
  const instUrlRef = useRef<string | null>(null);
  const vocalsUrlRef = useRef<string | null>(null);
  const midiUrlRef = useRef<string | null>(null);
  const hydratedContent = useRef(false);

  const baseSong = getStaticSong(id);
  const { current: sharedSong, loading: sharedLoading, upsert } = useSharedSong(id);
  const song: SongTab | null = hydrated
    ? (sharedSong ?? baseSong)
    : baseSong;

  const diagrams = useMemo(() => song?.diagrams ?? [], [song]);

  const activeProgram = useMemo(() => {
    if (!song || activeSlot.kind !== "gp") return null;
    return (
      (song.gpTracks ?? []).find((t) => t.index === activeSlot.index)?.program ??
      null
    );
  }, [song, activeSlot]);

  const activePercussion = useMemo(() => {
    if (!song || activeSlot.kind !== "gp") return false;
    return (
      (song.gpTracks ?? []).find((t) => t.index === activeSlot.index)
        ?.isPercussion ?? false
    );
  }, [song, activeSlot]);

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

  useEffect(() => {
    if (!gpMenuOpen) return;
    const close = () => setGpMenuOpen(false);
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [gpMenuOpen]);

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
      const list = song.diagrams ?? [];
      const idx = list.findIndex((d) => d.id === diagramId);
      if (idx < 0) return;
      undoRef.current.push({ kind: "one", diagram: list[idx], index: idx });
      const next: SongTab = {
        ...song,
        diagrams: list.filter((d) => d.id !== diagramId),
      };
      upsert(next);
      setUndoToast({ id: Date.now(), message: "Diagramme supprimé" });
    },
    [song, upsert]
  );

  const clearDiagrams = useCallback(() => {
    if (!song) return;
    if (!window.confirm("Supprimer tous les diagrammes ?")) return;
    const list = song.diagrams ?? [];
    undoRef.current.push({ kind: "all", diagrams: list, copied, selected });
    upsert({ ...song, diagrams: [] });
    setCopied([]);
    setSelected(new Set());
    setUndoToast({
      id: Date.now(),
      message: `${list.length} diagramme${list.length > 1 ? "s" : ""} supprimé${list.length > 1 ? "s" : ""}`,
    });
  }, [song, upsert, copied, selected]);

  const undoLast = useCallback(() => {
    if (!song) return;
    const entry = undoRef.current.pop();
    if (!entry) return;
    if (entry.kind === "one") {
      const list = [...(song.diagrams ?? [])];
      list.splice(Math.min(entry.index, list.length), 0, entry.diagram);
      upsert({ ...song, diagrams: list });
    } else {
      upsert({ ...song, diagrams: entry.diagrams });
      setCopied(entry.copied);
      setSelected(entry.selected);
    }
    setUndoToast(null);
  }, [song, upsert]);

  // Ferme le toast « Annuler » après 5 s (la pile reste pour Ctrl+Z).
  useEffect(() => {
    if (!undoToast) return;
    const t = window.setTimeout(() => setUndoToast(null), 5000);
    return () => window.clearTimeout(t);
  }, [undoToast]);

  // Ctrl+Z / Cmd+Z : annule la dernière suppression (jamais dans les champs
  // de texte, pour ne pas voler l'undo natif de la grille).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== "z") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;
      e.preventDefault();
      undoLast();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undoLast]);

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
      const midiBlob = await loadMidiBlob(id);
      if (!cancelled && midiBlob) {
        const url = getAudioStemUrl(midiBlob);
        if (url) {
          midiUrlRef.current = url;
          setMidiUrl(url);
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
      if (midiUrlRef.current) {
        URL.revokeObjectURL(midiUrlRef.current);
        midiUrlRef.current = null;
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

  useEffect(() => {
    if (!extracting) return;
    const t = window.setInterval(() => {
      setExtractElapsed(Math.floor((Date.now() - extractStartRef.current) / 1000));
    }, 1000);
    return () => window.clearInterval(t);
  }, [extracting]);

  // État du service stems (port 8765) : rafraîchi toutes les 8 s, pour savoir
  // immédiatement si le port est joignable et si le GPU (CUDA) est utilisé.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch("/api/stems-health", { cache: "no-store" });
        const data = (await res.json().catch(() => null)) ?? null;
        if (cancelled) return;
        if (res.ok && data?.ok) {
          setStemStatus({
            status: "up",
            model: data.model,
            device: data.device,
            cudaAvailable: data.cudaAvailable,
          });
        } else {
          setStemStatus({ status: "down" });
        }
      } catch {
        if (!cancelled) setStemStatus({ status: "down" });
      }
    };
    void check();
    const t = window.setInterval(check, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [id]);

  const extractErrorText = (msg: string) =>
    msg.includes("injoignable")
      ? "Service Demucs absent — lance start-stems.bat puis utilise l'app en local (localhost:3000)"
      : msg.slice(0, 160);

  const runExtraction = async (
    doFetch: () => Promise<Response>,
    onDone: (wav: File) => Promise<void>,
    filename: string,
  ) => {
    setExtracting(true);
    setExtractError(null);
    setExtractElapsed(0);
    extractStartRef.current = Date.now();
    try {
      const res = await doFetch();
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `erreur ${res.status}`);
      }
      const blob = await res.blob();
      const wav = new File([blob], filename, { type: "audio/wav" });
      await onDone(wav);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setExtractError(extractErrorText(msg));
    } finally {
      setExtracting(false);
    }
  };

  const handleExtractFromFile = (file: File, stem: "vocals" | "noVocals") =>
    runExtraction(
      () => {
        const form = new FormData();
        form.set("file", file, file.name || "audio.mp3");
        return fetch(`/api/stems?stem=${stem}`, {
          method: "POST",
          body: form,
          signal: AbortSignal.timeout(600_000),
        });
      },
      (wav) => handleStemUpload(stem, wav),
      `${stem}.wav`,
    );

  const handleExtractBothFromYouTube = async () => {
    const videoId = ytVideoId ?? loadYouTubeId(id);
    if (!videoId) {
      setExtractError("Aucune vidéo YouTube liée à cette chanson");
      return;
    }
    setExtracting(true);
    setExtractError(null);
    setExtractElapsed(0);
    extractStartRef.current = Date.now();
    try {
      for (const stem of ["vocals", "noVocals"] as const) {
        const res = await fetch("/api/yt-stems", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
body: JSON.stringify({ videoId, stem }),
        // ~9 min de calcul CPU pour une chanson de 4 min : au-delà de 10 min
        // l'extraction était abandonnée avant la fin.
        signal: AbortSignal.timeout(1_800_000),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error ?? `erreur ${res.status}`);
        }
        const blob = await res.blob();
        const wav = new File([blob], `${stem}.wav`, { type: "audio/wav" });
        await handleStemUpload(stem, wav);
      }
    } catch (err) {
      setExtractError(extractErrorText(err instanceof Error ? err.message : String(err)));
    } finally {
      setExtracting(false);
    }
  };

  const handleGpPickFile = async (file: File) => {
    setGpImporting(true);
    setGpError(null);
    setGpWarnings([]);
    setGpTracks([]);
    setGpPendingFile(null);
    try {
      const tracks = await analyzeGuitarProFile(file);
      setGpTracks(tracks);
      setGpPendingFile(file);
      const existing = new Set((song?.gpTracks ?? []).map((t) => t.index));
      setGpSelected(existing);
    } catch (err) {
      console.error("[ChordFlow] Éditeur : échec d'analyse Guitar Pro", err);
      setGpError(err instanceof Error ? err.message : String(err));
    } finally {
      setGpImporting(false);
    }
  };

  // Opens the Songsterr import panel for the requested mode (gp | midi);
  // clicking the button of the mode already open closes the panel.
  const toggleSt = (mode: "gp" | "midi") => {
    if (stOpen && stMode === mode) {
      setStOpen(false);
      return;
    }
    setStMode(mode);
    setStOpen(true);
    setStArtist((v) => v || (song?.artist ?? ""));
    setStTitle((v) => v || (song?.title ?? ""));
  };

  const handleStSearch = async () => {
    const pattern = `${stArtist.trim()} ${stTitle.trim()}`.trim();
    if (!pattern) return;
    setStLoading(true);
    setStError(null);
    setStResults([]);
    try {
      const res = await fetch(`/api/songsterr-gp?pattern=${encodeURIComponent(pattern)}`, {
        signal: AbortSignal.timeout(30_000),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `erreur ${res.status}`);
      const list: { songId: number; artist: string; title: string; tracksCount: number }[] =
        Array.isArray(data?.results) ? data.results : [];
      setStResults(list);
      if (list.length === 0) setStError("Aucun résultat.");
    } catch (err) {
      setStError(err instanceof Error ? err.message.slice(0, 160) : String(err));
    } finally {
      setStLoading(false);
    }
  };

  const handleStImportBlob = async (blob: Blob) => {
    const file = new File([blob], "songsterr.gp", { type: "application/octet-stream" });
    if (stMode === "midi") {
      const bytes = await guitarProToMidi(file);
      const midiFile = new File([bytes], "songsterr.mid", { type: "audio/midi" });
      await handleMidiPickFile(midiFile);
    } else {
      await handleGpPickFile(file);
    }
  };

  const handleStImport = async (songId: number) => {
    setStDownloading(songId);
    setStError(null);
    try {
      const res = await fetch(`/api/songsterr-gp?songId=${songId}`, {
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `erreur ${res.status}`);
      }
      await handleStImportBlob(await res.blob());
    } catch (err) {
      setStError(err instanceof Error ? err.message.slice(0, 160) : String(err));
    } finally {
      setStDownloading(null);
    }
  };

  const handleStImportRevision = async (revisionId: number) => {
    setStDownloading(revisionId);
    setStError(null);
    try {
      const res = await fetch(`/api/songsterr-gp?revisionId=${revisionId}`, {
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `erreur ${res.status}`);
      }
      await handleStImportBlob(await res.blob());
    } catch (err) {
      setStError(err instanceof Error ? err.message.slice(0, 160) : String(err));
    } finally {
      setStDownloading(null);
    }
  };

  const handleStShowRevisions = async (songId: number) => {
    if (stRevisionsSong === songId) {
      setStRevisionsSong(null);
      return;
    }
    setStRevisionsSong(songId);
    setStRevisionsLoading(true);
    setStRevisions([]);
    setStError(null);
    try {
      const res = await fetch(`/api/songsterr-gp?songId=${songId}&revisions=1`, {
        signal: AbortSignal.timeout(30_000),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `erreur ${res.status}`);
      setStRevisions(Array.isArray(data?.revisions) ? data.revisions : []);
      if (!Array.isArray(data?.revisions) || data.revisions.length === 0) {
        setStError("Aucune révision listée.");
      }
    } catch (err) {
      setStError(err instanceof Error ? err.message.slice(0, 160) : String(err));
    } finally {
      setStRevisionsLoading(false);
    }
  };

  const extractSongsterrId = (input: string): number | null => {
    // Formats Songsterr : /a/wa/song/<id>, songid=<id>, ou …/a/wsa/…-s<id>.
    const m = input.match(
      /\/song\/(\d+)|song(?:id)=(\d+)|[-/]s(\d+)(?=[?#]|$)/i
    );
    if (!m) return null;
    const raw = m[1] ?? m[2] ?? m[3];
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
  };

  const handleStImportLink = async () => {
    const link = stLink.trim();
    if (!link) return;
    const songId = extractSongsterrId(link);
    if (!songId) {
      setStError("Lien Songsterr non reconnu. Utilisez le lien d'une page « …/a/wa/song/… ».");
      return;
    }
    setStError(null);
    await handleStImport(songId);
  };

  const handleMidiPickFile = async (file: File) => {
    setGpError(null);
    try {
      const buffer = await file.arrayBuffer();
      const data = new Uint8Array(buffer);
      // Conserve le fichier MIDI pour la lecture multi-pistes du Chef
      // d'orchestre (IndexedDB, record séparé des stems).
      const url = getAudioStemUrl(file);
      if (url) {
        if (midiUrlRef.current) URL.revokeObjectURL(midiUrlRef.current);
        midiUrlRef.current = url;
        setMidiUrl(url);
      }
      try {
        await saveAudioStem(id, "midi", file);
      } catch (err) {
        console.error("[ChordFlow] Éditeur : échec de sauvegarde du MIDI", err);
      }
      const result = importMidi(file.name, data, song);
      if (!song) return;
      if (result.diagrams.length === 0) {
        setGpWarnings((w) => [
          ...w,
          "Aucun accord détecté dans ce MIDI : la lecture MIDI est conservée pour le Studio, aucun diagramme ajouté.",
        ]);
        return;
      }
      const drops = await upsert({
        ...song,
        bpm: song.bpm ?? result.bpm,
        diagrams: [...(song.diagrams ?? []), ...result.diagrams],
      });
      if (drops.length > 0) {
        console.warn("[ChordFlow] Espace local saturé :", drops);
      }
    } catch (err) {
      console.error("[ChordFlow] Éditeur : échec d'analyse MIDI", err);
      setGpError(
        err instanceof Error
          ? `Impossible d'importer le MIDI : ${err.message}`
          : "Impossible d'importer le MIDI."
      );
    }
  };

  const handleTabToMidi = async () => {
    if (!tabText.trim() || tabConverting) return;
    setTabConverting(true);
    try {
      const bytes = asciiTabToMidi(tabText);
      const file = new File([bytes], "tablature.mid", { type: "audio/midi" });
      await handleMidiPickFile(file);
    } catch (err) {
      console.error("[ChordFlow] Éditeur : échec de conversion de la tablature texte", err);
      setGpError(
        err instanceof Error
          ? `Impossible de convertir la tablature : ${err.message}`
          : "Impossible de convertir la tablature."
      );
    } finally {
      setTabConverting(false);
    }
  };

  const TAB_TO_TAB_SAMPLE =
    "C G Am F\nAm F C G\nDm G7 C C";

  const handleTextToTab = async () => {
    if (!genText.trim() || genLoading) return;
    setGenLoading(true);
    setGenError(null);
    setGenInfo(null);
    try {
      const result = textToTab(genText);
      if (result.measures === 0) {
        setGenError(
          "Aucun accord reconnu dans ce texte. Utilisez des noms d'accords (C, Am, D7, Fmaj7…) séparés par des espaces, une ligne = une mesure."
        );
        return;
      }
      setGenPreview(result.tab);
      const infoParts = [`${result.measures} mesure${result.measures > 1 ? "s" : ""}`];
      if (result.chordsDetected.length > 0) {
        infoParts.push(`${result.chordsDetected.join(" ")}`);
      }
      if (result.unknown.length > 0) {
        infoParts.push(`ignoré : ${[...new Set(result.unknown)].join(" ")}`);
      }
      setGenInfo(infoParts.join(" · "));
      const bytes = asciiTabToMidi(result.tab);
      const file = new File([bytes], "tablature.mid", { type: "audio/midi" });
      await handleMidiPickFile(file);
    } catch (err) {
      console.error("[ChordFlow] Éditeur : échec de génération de tablature", err);
      setGenError(
        err instanceof Error
          ? `Impossible de générer la tablature : ${err.message}`
          : "Impossible de générer la tablature."
      );
    } finally {
      setGenLoading(false);
    }
  };

  const setGpSelection = (track: GpTrackInfo, checked: boolean) => {
    if (!song || gpImportingTrack !== null) return;
    const alreadyImported = (song.gpTracks ?? []).some((t) => t.index === track.index);

    if (!checked) {
      if (alreadyImported) {
        void (async () => {
          const next: SongTab = {
            ...song,
            gpTracks: (song.gpTracks ?? []).filter((t) => t.index !== track.index),
          };
          const drops = await upsert(next);
          if (drops.length > 0) {
            setGpWarnings((w) => [
              ...w,
              ...drops.map(
                (t) =>
                  `Espace local saturé : « ${t} » a été retirée de cet appareil pour enregistrer la chanson (elle reste sur le serveur partagé).`
              ),
            ]);
          }
          if (activeSlot.kind === "gp" && activeSlot.index === track.index) {
            setActiveSlot({ kind: "main" });
          }
        })();
      }
      setGpSelected((prev) => {
        const nextSet = new Set(prev);
        nextSet.delete(track.index);
        return nextSet;
      });
      return;
    }

    setGpSelected((prev) => new Set(prev).add(track.index));
  };

  const isTrackImported = (index: number) =>
    (song?.gpTracks ?? []).some((t) => t.index === index);

  const handleGpImportSelected = async () => {
    if (!song || !gpPendingFile || gpImportingTrack !== null) return;
    // Re-importing an already imported track is allowed: it replaces that
    // track's diagrams (import is idempotent) so a song can pick up import fixes.
    const targets = gpTracks.filter((t) => gpSelected.has(t.index));
    if (targets.length === 0) return;
    setGpError(null);
    setGpWarnings([]);
    let next: SongTab = song;
    let failed = 0;
    for (const t of targets) {
      setGpImportingTrack(t.index);
      try {
        const result = await importGuitarProTrack(gpPendingFile, t.index);
        if (result.warnings.length > 0) setGpWarnings((w) => [...w, ...result.warnings]);
        if (result.diagrams.length === 0) continue;
        next = {
          ...next,
          title: next.title || result.song.title,
          artist: next.artist || result.song.artist,
          bpm: next.bpm ?? result.song.bpm ?? 90,
          timeSignature: next.timeSignature ?? result.song.timeSignature,
          gpTracks: [
            ...(next.gpTracks ?? []).filter((x) => x.index !== t.index),
            { index: t.index, name: t.name, program: result.program, isPercussion: t.isPercussion, diagrams: result.diagrams },
          ],
          officialPlain: next.officialPlain || result.song.officialPlain,
          officialSynced: next.officialSynced || result.song.officialSynced,
        };
        // If the re-imported track is the one currently displayed, its fresh
        // diagrams must also replace the active sequence.
        if (activeSlot.kind === "gp" && activeSlot.index === t.index) {
          next = { ...next, diagrams: result.diagrams };
        }
        const drops = await upsert(next);
        if (drops.length > 0) {
          setGpWarnings((w) => [
            ...w,
            ...drops.map(
              (x) =>
                `Espace local saturé : « ${x} » a été retirée de cet appareil pour enregistrer la chanson (elle reste sur le serveur partagé).`
            ),
          ]);
        }
      } catch (err) {
        failed++;
        setGpError(err instanceof Error ? err.message : String(err));
      }
    }
    setGpImportingTrack(null);
    // Ancrage automatique des paroles sur la première note de la piste vocale GP
    const importedVocal = gpTracks.find(
      (t) => gpSelected.has(t.index) && t.isVocal && t.firstNoteTime !== null
    );
    if (
      importedVocal &&
      importedVocal.firstNoteTime !== null &&
      next.diagrams &&
      next.diagrams.length > 0
    ) {
      const events = renderSequence(next.diagrams, next.bpm ?? 120);
      const anchorIdx = events.findIndex(
        (e) =>
          importedVocal.firstNoteTime !== null &&
          importedVocal.firstNoteTime >= e.start &&
          importedVocal.firstNoteTime < e.start + e.duration + 1e-6
      );
      if (anchorIdx >= 0) {
        next = { ...next, lyricAnchorDiagram: anchorIdx };
        setLyricAnchorDiagram(anchorIdx);
        setGpWarnings((w) => [
          ...w,
          `Paroles ancrées automatiquement sur le diagramme ${anchorIdx + 1} (première note vocale à ${importedVocal.firstNoteTime?.toFixed(1)}s)`,
        ]);
      } else {
        setGpWarnings((w) => [
          ...w,
          `Piste vocale « ${importedVocal.name} » : première note à ${importedVocal.firstNoteTime?.toFixed(1)}s, mais aucun diagramme ne correspond. Ajuste manuellement l'ancrage.`,
        ]);
      }
    }
    if (failed === targets.length) {
      setGpError(
        "Aucune des pistes cochées n'a pu être importée (voir le message ci-dessus)."
      );
    }
  };

  const handleGpSelectAll = () => {
    if (gpImportingTrack !== null) return;
    setGpSelected(new Set(gpTracks.map((t) => t.index)));
  };

  // Conversion « partition → tablature » : la piste cochée n'est pas une tab
  // (notation seule, claviers, vents, voix...) ; on génère une tablature de
  // guitare à partir de ses hauteurs, puis on l'importe en MIDI (Chef d'orchestre).
  const handleGpNotationToTab = async (t: GpTrackInfo) => {
    if (!gpPendingFile || ntLoading || gpImportingTrack !== null) return;
    setNtLoading(true);
    setNtError(null);
    setNtResult(null);
    try {
      const result = await importGuitarProNotationAsTab(gpPendingFile, t.index);
      setNtResult({ trackName: t.name, result });
    } catch (err) {
      console.error("[ChordFlow] Éditeur : échec conversion partition -> tab", err);
      setNtError(err instanceof Error ? err.message : String(err));
    } finally {
      setNtLoading(false);
    }
  };

  const handleNtImportMidi = async (tab: string) => {
    const midiFile = new File([asciiTabToMidi(tab)], "partition.mid", { type: "audio/midi" });
    await handleMidiPickFile(midiFile);
  };

  const handleGpRemoveAll = async () => {
    if (!song || gpImportingTrack !== null) return;
    const next: SongTab = {
      ...song,
      gpTracks: [],
    };
    await upsert(next);
    setGpSelected(new Set());
    setActiveSlot({ kind: "main" });
  };

  const handleSelectSlot = (slot: ActiveSlot) => {
    if (!song) return;
    const current = song.diagrams ?? [];
    const next: SongTab = {
      ...song,
      ...packSlotDiagrams(song, activeSlot, current),
    };
    next.diagrams = readSlotDiagrams(song, slot);
    setActiveSlot(slot);
    setGpMenuOpen(false);
    upsert(next);
  };

  const handleGpCancel = () => {
    setGpTracks([]);
    setGpPendingFile(null);
    setGpSelected(new Set());
  };

  const handleChordsToDiagrams = async () => {
    if (!song) {
      setGpError("Chanson introuvable.");
      return;
    }
    const text = editableContent ?? song.content;
    if (!text || !text.trim()) {
      setGpError("Ajoutez d'abord une grille d'accords dans le contenu de la chanson.");
      return;
    }
    setChartsConverting(true);
    setGpError(null);
    setGpWarnings([]);
    try {
      const { diagrams, skipped } = chordsToDiagrams(text);
      if (diagrams.length === 0) {
        setGpError(
          "Aucun accord reconnu dans la grille. Vérifiez le contenu (ex. [Verse] puis « Em  C  G  D/F# »)."
        );
        return;
      }
      const warnings: string[] = [];
      if (skipped.length > 0) {
        warnings.push(`Accords non reconnus (ignorés) : ${skipped.join(", ")}`);
      }
      const drops = await upsert({
        ...song,
        diagrams: [...(song.diagrams ?? []), ...diagrams],
      });
      if (drops.length > 0) {
        warnings.push(
          ...drops.map(
            (t) =>
              `Espace local saturé : « ${t} » a été retirée de cet appareil pour enregistrer la chanson (elle reste sur le serveur partagé).`
          )
        );
      }
      if (warnings.length > 0) setGpWarnings(warnings);
    } catch (err) {
      console.error("[ChordFlow] Éditeur : échec de conversion de la grille en diagrammes", err);
      setGpError(err instanceof Error ? err.message : String(err));
    } finally {
      setChartsConverting(false);
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
    if (hydrated && sharedLoading && !baseSong) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-4">
          <p className="text-zinc-500 text-lg">Chargement…</p>
        </div>
      );
    }
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
        <div className="max-w-5xl mx-auto px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2">
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
          <div className="w-full md:w-auto flex items-center gap-2 md:flex-shrink-0">
            {/* FUTURE DEV: Grille mode supprimé
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
*/}
            <div className="relative">
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setGpMenuOpen((o) => !o)}
                className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                  gpMenuOpen
                    ? "text-black bg-amber-400"
                    : "text-zinc-400 bg-zinc-800 hover:bg-zinc-700"
                }`}
                title="Choisir la piste annotée (diagrammes)"
              >
                <ListMusic className="w-3.5 h-3.5" />
                Pistes
                {(song.gpTracks?.length ?? 0) > 0 && (
                  <span className="text-[10px] font-bold bg-zinc-700 rounded-full px-1.5 py-0.5 leading-none">
                    {(song.gpTracks?.length ?? 0) + (activeSlot.kind === "main" ? 0 : 1)}
                  </span>
                )}
              </button>
              {gpMenuOpen && (
                <div
                  onPointerDown={(e) => e.stopPropagation()}
                  className="absolute right-0 top-full mt-2 w-72 max-h-80 overflow-y-auto rounded-xl bg-zinc-900 border border-zinc-700 shadow-2xl p-1.5 flex flex-col gap-0.5 z-20"
                >
                  <p className="text-[10px] uppercase tracking-wider text-zinc-500 px-2 pt-1.5 pb-1">
                    Piste affichée
                  </p>
                  {[{ kind: "main" } as ActiveSlot, ...(song.gpTracks ?? []).map((t) => ({ kind: "gp", index: t.index } as ActiveSlot))].map(
                    (slot) => {
                      const active = slotKey(slot) === slotKey(activeSlot);
                      const label = slotLabel(song, slot);
                      const count = readSlotDiagrams(song, slot).length;
                      const progName =
                        slot.kind === "gp"
                          ? gmProgramName(
                              (song.gpTracks ?? []).find((t) => t.index === slot.index)?.program ?? null
                            )
                          : null;
                      return (
                        <button
                          key={slotKey(slot)}
                          onClick={() => handleSelectSlot(slot)}
                          className={`flex items-center justify-between gap-2 text-left text-xs px-3 py-2 rounded-lg transition-colors ${
                            active
                              ? "bg-amber-500/15 text-amber-300"
                              : "text-zinc-300 hover:bg-zinc-800"
                          }`}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            {active && <Check className="w-3.5 h-3.5 shrink-0" />}
                            <span className="flex flex-col min-w-0">
                              <span className="truncate">{label}</span>
                              {progName && (
                                <span className="text-[10px] text-zinc-500 truncate">
                                  {progName}
                                </span>
                              )}
                            </span>
                          </span>
                          <span className="text-[10px] text-zinc-500 shrink-0">
                            {count} diagramme{count > 1 ? "s" : ""}
                          </span>
                        </button>
                      );
                    }
                  )}
                  {(song.gpTracks?.length ?? 0) === 0 && (
                    <p className="text-[10px] text-zinc-600 px-2 py-1.5">
                      Aucune piste GP importée. Utilisez « Import GP » ci-dessous.
                    </p>
                  )}
                </div>
              )}
            </div>
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
            <button
              onClick={() => setConductorOpen(true)}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-amber-500 text-black hover:bg-amber-400 transition-colors"
              title="Lancer la lecture plein écran avec les diagrammes qui défilent"
            >
              <Mic2 className="w-3.5 h-3.5" />
              Studio
            </button>
            <button
              onClick={() => {
                window.open(
                  `https://www.songsterr.com/a/wa/search?pattern=${encodeURIComponent(`${song.artist} ${song.title}`)}`,
                  "_blank"
                );
              }}
              title="Rechercher ce morceau sur Songsterr (nouvel onglet)"
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-blue-600/10 border border-blue-600/30 text-blue-400 hover:bg-blue-600/20 transition-colors"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
              Songsterr
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6 pb-24 flex flex-col gap-6">
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
                  </div>
                  <span className="text-[11px] text-zinc-500">
                    Temps total ≈ {secondsFor(totalBeats).toFixed(1)} s
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap rounded-xl border border-zinc-700/50 bg-zinc-800/20 p-3">
                <span className="basis-full flex items-center gap-2">
                  <AudioLines className="w-3.5 h-3.5 text-amber-300" />
                  <span className="text-xs font-bold text-zinc-300">Stem</span>
                  <span className="hidden sm:inline text-[10px] text-zinc-600">
                    Instrumental et voix — le Studio les joue avec les accords
                  </span>
                </span>
                {stemStatus.status === "checking" ? (
                  <span className="flex items-center gap-1.5 text-[11px] text-zinc-500 bg-zinc-800/60 border border-zinc-700/60 rounded-full px-2.5 py-1 w-fit">
                    <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-pulse" />
                    Service stems : vérification…
                  </span>
                ) : stemStatus.status === "up" ? (
                  <span className="flex items-center gap-1.5 text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-full px-2.5 py-1 w-fit">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    Service stems : actif (port 8765)
                    <span
                      className={`font-semibold ${
                        stemStatus.device === "cuda"
                          ? "text-emerald-300"
                          : "text-amber-400"
                      }`}
                      title={
                        stemStatus.device === "cuda"
                          ? "Découplage accéléré par le GPU — rapide"
                          : "Découplage sur CPU : ~3,7× la durée du morceau (installer onnxruntime-gpu pour accélérer)"
                      }
                    >
                      {stemStatus.device === "cuda"
                        ? "GPU (CUDA)"
                        : "CPU (lent : ~3,7× la durée)"}
                    </span>
                    {stemStatus.model && (
                      <span className="text-zinc-400">{stemStatus.model}</span>
                    )}
                  </span>
                ) : (
                  <span
                    className="flex items-center gap-1.5 text-[11px] text-red-400 bg-red-500/10 border border-red-500/30 rounded-full px-2.5 py-1 w-fit"
                    title="Le service local (Demucs, port 8765) n'est pas joignable. Vercel n'a pas ce service : utilise localhost:3000."
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                    Service stems : absent — lance <b>start-stems.bat</b> puis reste sur localhost:3000
                  </span>
                )}
                <div className="basis-full flex flex-col gap-2 rounded-lg border border-zinc-700/50 bg-zinc-900/40 p-2.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                    stem
                  </span>
                  <div className="flex items-center gap-2 flex-wrap">
                    <label
                      className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors w-fit cursor-pointer select-none"
                      title={
                        vocalsUrl
                          ? "Changer le stem vocal (voix seule)"
                          : "Importer un stem vocal (voix seule) : le Studio le jouera avec les accords"
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
                    <label
                      className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors w-fit cursor-pointer select-none"
                      title={
                        instUrl
                          ? "Changer le stem instrumental (sans voix)"
                          : "Importer un stem instrumental (sans voix) : le Studio le jouera avec les accords pour vérifier le rythme"
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
                  </div>
                </div>
                <label
                  className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors w-fit cursor-pointer select-none disabled:cursor-wait ${
                    extracting
                      ? "bg-amber-500/20 text-amber-300"
                      : "bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
                  }`}
                  title="Extraire l'instrumental (sans voix) du fichier audio choisi, via Demucs en local (start-stems.bat requis)"
                >
                  {extracting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Music4 className="w-3.5 h-3.5" />
                  )}
                  {extracting ? `Extraction… ${extractElapsed}s` : "Extraire l'instrumental"}
                  <input
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    disabled={extracting}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleExtractFromFile(file, "noVocals");
                      e.target.value = "";
                    }}
                  />
                </label>
                <label
                  className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors w-fit cursor-pointer select-none ${
                    extracting
                      ? "bg-amber-500/20 text-amber-300"
                      : "bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
                  }`}
                  title="Extraire la piste vocale (voix seule) du fichier audio choisi, via Demucs en local (start-stems.bat requis)"
                >
                  {extracting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Mic2 className="w-3.5 h-3.5" />
                  )}
                  {extracting ? `Extraction… ${extractElapsed}s` : "Extraire la voix"}
                  <input
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    disabled={extracting}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleExtractFromFile(file, "vocals");
                      e.target.value = "";
                    }}
                  />
                </label>
                {ytVideoId && (
                  <button
                    type="button"
                    onClick={() => void handleExtractBothFromYouTube()}
                    disabled={extracting}
                    className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors w-fit cursor-pointer select-none disabled:cursor-wait ${
                      extracting
                        ? "bg-amber-500/20 text-amber-300"
                        : "bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
                    }`}
                    title="Télécharge l'audio de la vidéo YouTube liée (yt-dlp) et extrait la voix + l'instrumental via Demucs en local"
                  >
                    {extracting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Mic2 className="w-3.5 h-3.5" />
                    )}
                    {extracting ? `Extraction voix + instrumental… ${extractElapsed}s` : "Extraire voix + instrumental (YouTube)"}
                  </button>
                )}
                {extractError && (
                  <span className="text-[11px] text-red-400" title={extractError}>
                    {extractError}
                  </span>
                )}
                {(instUrl || vocalsUrl) && (
                  <span className="text-[11px] text-zinc-600">
                    Volume de chaque piste réglable dans le Studio
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => toggleSt("gp")}
                  disabled={gpImporting || stDownloading !== null}
                  className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors w-fit cursor-pointer select-none disabled:cursor-wait ${
                    stOpen && stMode === "gp"
                      ? "bg-amber-500/25 text-amber-200"
                      : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  }`}
                  title="Télécharger un fichier Guitar Pro depuis Songsterr puis choisir la piste à importer"
                >
                  <Download className="w-3.5 h-3.5" />
                  {gpImporting
                    ? "Lecture…"
                    : stDownloading !== null
                      ? "Téléchargement…"
                      : "Import GP (Songsterr)"}
                </button>
                <button
                  type="button"
                  onClick={() => toggleSt("midi")}
                  disabled={gpImporting || stDownloading !== null}
                  className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors w-fit cursor-pointer select-none disabled:cursor-wait ${
                    stOpen && stMode === "midi"
                      ? "bg-amber-500/25 text-amber-200"
                      : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  }`}
                  title="Télécharger un fichier MIDI depuis Songsterr (généré depuis le Guitar Pro de la tab)"
                >
                  <Music className="w-3.5 h-3.5" />
                  {gpImporting
                    ? "Lecture…"
                    : stDownloading !== null
                      ? "Téléchargement…"
                      : "Import MIDI (Songsterr)"}
                </button>
                <button
                  type="button"
                  onClick={() => setTabOpen((o) => !o)}
                  className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors w-fit cursor-pointer select-none ${
                    tabOpen
                      ? "bg-sky-500/25 text-sky-200"
                      : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  }`}
                  title="Coller une tablature en texte (export Guitar Pro / Songsterr) et la convertir en MIDI"
                >
                  <Clipboard className="w-3.5 h-3.5" />
                  Tab texte → MIDI
                </button>
                <button
                  type="button"
                  onClick={() => setGenOpen((o) => !o)}
                  className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors w-fit cursor-pointer select-none ${
                    genOpen
                      ? "bg-violet-500/25 text-violet-200"
                      : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  }`}
                  title="Générer une tablature de guitare (6 cordes) à partir d'un texte d'accords (grille ou paroles avec accords)"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  Texte → Tablature
                </button>
                <button
                  onClick={() => void handleChordsToDiagrams()}
                  disabled={chartsConverting}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-zinc-800 text-lime-300 hover:bg-lime-500/10 transition-colors w-fit cursor-pointer disabled:opacity-50"
                  title="Convertir la grille d'accords du contenu en séquence de diagrammes"
                >
                  <FileText className="w-3.5 h-3.5" />
                  {chartsConverting ? "Conversion…" : "Grille → Diagrammes"}
                </button>
              </div>
              {stOpen && (
                <div className="flex flex-col gap-2.5 rounded-lg bg-zinc-800/70 border border-zinc-700 p-3">
                  <p className="text-[11px] font-semibold text-zinc-300">
                    {stMode === "midi"
                      ? "Importer un fichier MIDI depuis Songsterr (généré depuis le Guitar Pro de la tab)"
                      : "Importer un fichier Guitar Pro depuis Songsterr"}
                  </p>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="flex flex-col gap-1 text-[10px] text-zinc-500">
                      Artiste
                      <input
                        value={stArtist}
                        onChange={(e) => setStArtist(e.target.value)}
                        className="w-44 bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-amber-500/60"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-[10px] text-zinc-500">
                      Titre
                      <input
                        value={stTitle}
                        onChange={(e) => setStTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void handleStSearch();
                          }
                        }}
                        className="w-56 bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-amber-500/60"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => void handleStSearch()}
                      disabled={stLoading}
                      className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 transition-colors cursor-pointer disabled:cursor-wait"
                    >
                      {stLoading ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Search className="w-3.5 h-3.5" />
                      )}
                      {stLoading ? "Recherche…" : "Rechercher"}
                    </button>
                    <span className="text-[10px] text-zinc-600 sm:ml-auto">
                      ou{" "}
                      <label className="underline text-zinc-400 hover:text-zinc-300 cursor-pointer">
                        fichier local
                        <input
                          type="file"
                          accept={stMode === "midi" ? ".mid,.midi" : ".gp,.gp5,.gpx,.gp4,.gp3,.gtp"}
                          className="hidden"
                          disabled={gpImporting}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              if (stMode === "midi") {
                                void handleMidiPickFile(file);
                              } else if (!gpImporting) {
                                void handleGpPickFile(file);
                              }
                            }
                            e.target.value = "";
                          }}
                        />
                      </label>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={stLink}
                      onChange={(e) => setStLink(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void handleStImportLink();
                        }
                      }}
                      placeholder="ou collez le lien de la version web (…/a/wa/song/… ou …-s12345)"
                      className="flex-1 min-w-0 bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500/60"
                    />
                    <button
                      type="button"
                      onClick={() => void handleStImportLink()}
                      disabled={!stLink.trim() || stDownloading !== null}
                      className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-600/15 text-blue-300 hover:bg-blue-600/25 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 flex-shrink-0"
                    >
                      {stDownloading !== null ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                      Importer le lien
                    </button>
                  </div>
                  {stError && <p className="text-[11px] text-red-400">{stError}</p>}
                  {stResults.length > 0 && (
                    <div className="flex flex-col gap-1 max-h-72 overflow-y-auto">
                      {stResults.map((r) => (
                        <div key={r.songId} className="flex flex-col gap-1">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => void handleStShowRevisions(r.songId)}
                              disabled={stDownloading !== null || stRevisionsLoading}
                              className="flex flex-1 min-w-0 items-center justify-between gap-2 text-left text-xs px-3 py-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-wait"
                              title="Afficher les révisions (le nombre de pistes peut varier d'une version à l'autre)"
                            >
                              <span className="truncate">
                                {r.artist || "?"} — {r.title || "?"}
                              </span>
                              <span className="flex items-center gap-2 shrink-0 text-[10px] text-zinc-500">
                                {r.tracksCount > 0 && (
                                  <span>
                                    {r.tracksCount} piste{r.tracksCount > 1 ? "s" : ""}
                                  </span>
                                )}
                                {stRevisionsLoading && stRevisionsSong === r.songId ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                                ) : (
                                  <ChevronDown
                                    className={`w-3.5 h-3.5 transition-transform ${
                                      stRevisionsSong === r.songId ? "rotate-180" : ""
                                    }`}
                                  />
                                )}
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleStImport(r.songId)}
                              disabled={stDownloading !== null}
                              className="flex items-center gap-1.5 shrink-0 px-2.5 h-8 rounded-lg bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 text-[10px] font-semibold transition-colors disabled:cursor-wait disabled:opacity-50"
                              title="Importer la révision la plus récente exportable en Guitar Pro"
                            >
                              {stDownloading === r.songId ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <Download className="w-3 h-3" />
                              )}
                              Importer
                            </button>
                          </div>
                          {stRevisionsSong === r.songId && (
                            <div className="flex flex-col gap-1 pl-2">
                              {stRevisions.map((rev) => (
                                <div
                                  key={rev.revisionId}
                                  className="flex items-center gap-1.5 text-[11px]"
                                >
                                  <button
                                    type="button"
                                    onClick={() => void handleStImportRevision(rev.revisionId)}
                                    disabled={!rev.exportable || stDownloading !== null}
                                    className={`flex flex-1 min-w-0 items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border text-left transition-colors disabled:cursor-not-allowed ${
                                      rev.exportable
                                        ? "bg-zinc-900 border-zinc-700 text-zinc-200 hover:bg-zinc-800"
                                        : "bg-zinc-900/40 border-zinc-800 text-zinc-500 hover:bg-zinc-900/40"
                                    }`}
                                    title={
                                      rev.exportable
                                        ? "Importer cette révision (Guitar Pro)"
                                        : "Version web : plus exportable en Guitar Pro"
                                    }
                                  >
                                    <span className="truncate">
                                      {rev.createdAt
                                        ? `${rev.createdAt.slice(0, 7)} · `
                                        : ""}
                                      {rev.tracksCount} piste{rev.tracksCount > 1 ? "s" : ""}
                                      {rev.exportable ? "" : " · web uniquement"}
                                    </span>
                                    <span className="flex items-center gap-1.5 shrink-0 text-[10px]">
                                      {stDownloading === rev.revisionId ? (
                                        <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
                                      ) : rev.exportable ? (
                                        <Download className="w-3 h-3" />
                                      ) : (
                                        <Lock className="w-3 h-3 text-zinc-600" />
                                      )}
                                    </span>
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {tabOpen && (
                <div className="flex flex-col gap-2.5 rounded-lg bg-zinc-800/70 border border-zinc-700 p-3">
                  <p className="text-[11px] font-semibold text-zinc-300">
                    Coller une tablature en texte (export « ASCII » Guitar Pro / Songsterr)
                  </p>
                  <textarea
                    value={tabText}
                    onChange={(e) => setTabText(e.target.value)}
                    rows={8}
                    spellCheck={false}
                    placeholder={"Title:…\nTempo = 120\n\nE |------------------|--0--1L---|…\nB |------------------|---------|…\n…"}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 font-mono focus:outline-none focus:border-sky-500/60 resize-y"
                  />
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => void handleTabToMidi()}
                      disabled={!tabText.trim() || tabConverting}
                      className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-sky-500/15 text-sky-300 hover:bg-sky-500/25 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                      title="Convertir la tablature en fichier MIDI puis l'importer (Studio, diagrammes si accords détectés)"
                    >
                      {tabConverting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Clipboard className="w-3.5 h-3.5" />
                      )}
                      {tabConverting ? "Conversion…" : "Convertir en MIDI et importer"}
                    </button>
                    <span className="text-[10px] text-zinc-600">
                      Format : 6 rangées par portée (E B G D A E), barres `|`, tempo &quot;Tempo =&nbsp;XX&quot;, liaisons `L`, étouffées `x`.
                    </span>
                  </div>
                  {tabText.trim().length > 0 && (
                    <div className="flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => setTabPreviewOpen((o) => !o)}
                        className="self-start text-[11px] font-semibold px-2.5 py-1 rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors cursor-pointer"
                      >
                        {tabPreviewOpen ? "Masquer" : "Afficher"} l&apos;aperçu en tablature HTML
                      </button>
                      {tabPreviewOpen && (
                        <TabPreview
                          key={tabText}
                          ascii={tabText}
                          onImportMidi={(t) => void handleNtImportMidi(t)}
                        />
                      )}
                    </div>
                  )}
                </div>
              )}
              {genOpen && (
                <div className="flex flex-col gap-2.5 rounded-lg bg-zinc-800/70 border border-zinc-700 p-3">
                  <p className="text-[11px] font-semibold text-zinc-300">
                    Générer une tablature de guitare depuis un texte
                  </p>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] text-zinc-500">
                      Grille d&apos;accords ou paroles avec accords (une ligne = une mesure)
                    </label>
                    <textarea
                      value={genText}
                      onChange={(e) => setGenText(e.target.value)}
                      rows={4}
                      spellCheck={false}
                      placeholder={"C G Am F\nAm F C G\nDm G7 C C\n\n(1re ligne sans accord = titre)"}
                      className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 font-mono focus:outline-none focus:border-violet-500/60 resize-y"
                    />
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => void handleTextToTab()}
                      disabled={!genText.trim() || genLoading}
                      className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                      title="Générer la tablature à partir du texte et la convertir en MIDI (Studio)"
                    >
                      {genLoading ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <LayoutGrid className="w-3.5 h-3.5" />
                      )}
                      {genLoading ? "Génération…" : "Générer et importer (MIDI)"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setGenText(TAB_TO_TAB_SAMPLE)}
                      className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors cursor-pointer"
                      title="Remplacer par un petit exemple"
                    >
                      <Clipboard className="w-3.5 h-3.5" />
                      Exemple
                    </button>
                    <span className="text-[10px] text-zinc-600">
                      Accords reconnus (sus, 7, maj7, 6…), `/` = reprise de l&apos;accord précédent.
                    </span>
                  </div>
                  {genError && <p className="text-[11px] text-red-400">{genError}</p>}
                  {genInfo && <p className="text-[11px] text-violet-300">{genInfo}</p>}
                  {genPreview && (
                    <TabPreview
                      key={genPreview}
                      ascii={genPreview}
                      onImportMidi={(t) => void handleNtImportMidi(t)}
                    />
                  )}
                </div>
              )}
              {gpError && (
                <p className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-1.5">
                  {gpError}
                </p>
              )}
              {gpWarnings.length > 0 && (
                <ul className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-1.5 flex flex-col gap-0.5">
                  {gpWarnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
              {gpPendingFile && gpTracks.length > 0 && (
                <div className="flex flex-col gap-2 rounded-lg bg-zinc-800/70 border border-zinc-700 p-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className="text-[11px] text-zinc-300 font-semibold">
                      Pistes du fichier — cochez-en plusieurs à importer
                    </p>
                    <div className="flex items-center gap-1.5">
                      <button
                        disabled={
                          gpImportingTrack !== null ||
                          gpTracks.filter((t) => gpSelected.has(t.index)).length === 0
                        }
                        onClick={() => void handleGpImportSelected()}
                        className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-md bg-emerald-500 text-black hover:bg-emerald-400 transition-colors disabled:opacity-40"
                        title="Importer (ou réimporter) toutes les pistes cochées — une piste déjà importée est remplacée"
                      >
                        Importer la sélection (
                        {gpTracks.filter((t) => gpSelected.has(t.index)).length}
                        )
                      </button>
                      <button
                        disabled={gpImportingTrack !== null}
                        onClick={handleGpSelectAll}
                        className="text-[10px] text-emerald-300 hover:text-emerald-200 transition-colors disabled:opacity-40"
                        title="Cocher toutes les pistes (l'import se fait via « Importer la sélection »)"
                      >
                        Tout cocher
                      </button>
                      <span className="text-zinc-700">·</span>
                      <button
                        disabled={gpImportingTrack !== null}
                        onClick={() => void handleGpRemoveAll()}
                        className="text-[10px] text-red-400 hover:text-red-300 transition-colors disabled:opacity-40"
                        title="Retirer toutes les séquences GP de la chanson"
                      >
                        Tout retirer
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto">
                    {gpTracks.map((t) => {
                      const checked = gpSelected.has(t.index);
                      const imported = isTrackImported(t.index);
                      const active = activeSlot.kind === "gp" && activeSlot.index === t.index;
                      const instName = t.isPercussion
                        ? "Batterie / Percussion"
                        : gmProgramName(t.program) ?? undefined;
                      return (
                        <label
                          key={t.index}
                          className={`flex items-center justify-between gap-2 text-left text-xs px-3 py-2 rounded-lg bg-zinc-900 border transition-colors cursor-pointer select-none ${
                            checked
                              ? "border-amber-500/50"
                              : "border-zinc-700"
                          } ${active ? "ring-1 ring-amber-400/40" : ""}`}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <input
                              type="checkbox"
                              className="accent-amber-500 cursor-pointer"
                              checked={checked}
                              disabled={gpImportingTrack !== null}
                              onChange={(e) => setGpSelection(t, e.target.checked)}
                            />
                            <Music4 className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                            <span className="flex flex-col min-w-0">
                              <span className="truncate">{t.name}</span>
                              {instName && (
                                <span className="text-[10px] text-zinc-500 truncate">
                                  {instName}
                                </span>
                              )}
                            </span>
                            {active && (
                              <span className="text-[10px] text-amber-300 shrink-0">Affichée</span>
                            )}
                            {imported && !active && (
                              <span className="text-[10px] text-emerald-300 shrink-0">
                                Importée
                              </span>
                            )}
                            {!imported && checked && (
                              <span className="text-[10px] text-sky-300/80 shrink-0">
                                À importer
                              </span>
                            )}
                            {gpImportingTrack === t.index && (
                              <span className="text-[10px] text-zinc-400 shrink-0">Import…</span>
                            )}
                          </span>
                          <span className="flex items-center gap-3 text-[10px] text-zinc-500 shrink-0">
                            {t.isGuitar && <span className="text-emerald-300">Guitare</span>}
                            {t.isVocal && <span className="text-violet-300">Voix</span>}
                            {t.stringCount} cordes
                            {t.chordCount > 0 && <span className="text-amber-300">{t.chordCount} accords</span>}
                            <span>{t.noteCount} notes</span>
                            {!t.isPercussion && t.noteCount > 0 && (
                              <button
                                type="button"
                                disabled={ntLoading || gpImportingTrack !== null}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  void handleGpNotationToTab(t);
                                }}
                                className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md border transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
                                  t.hasTab
                                    ? "border-zinc-700 text-zinc-400 hover:border-emerald-500/50 hover:text-emerald-300"
                                    : "border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/15"
                                }`}
                                title={
                                  t.hasTab
                                    ? "Déjà une tablature : régénérer le manche depuis les notes absolues"
                                    : "Piste en notation seule (partition) : générer la tablature 6 cordes puis l'importer en MIDI"
                                }
                              >
                                {ntLoading ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <FileText className="w-3 h-3" />
                                )}
                                Part→Tab
                              </button>
                            )}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  {ntError && (
                    <p className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-1.5">
                      {ntError}
                    </p>
                  )}
                  {ntResult && (
                    <div className="flex flex-col gap-2 rounded-lg bg-zinc-950/60 border border-emerald-500/25 p-3">
                      <p className="text-[11px] text-emerald-300 font-semibold">
                        Tablature générée pour « {ntResult.trackName} »
                      </p>
                      <p className="text-[10px] text-zinc-500">
                        {ntResult.result.measures} mesure(s) · {ntResult.result.noteCount} notes ·{" "}
                        {ntResult.result.chordCount} accord(s)
                        {ntResult.result.outOfRange.length > 0 &&
                          ` · ${ntResult.result.outOfRange.length} note(s) hors accordage standard (${ntResult.result.outOfRange.join(", ")})`}
                      </p>
                      {ntResult.result.warnings.length > 0 && (
                        <ul className="mt-1">
                          {ntResult.result.warnings.map((w) => (
                            <li key={w} className="text-[10px] text-amber-300">
                              {w}
                            </li>
                          ))}
                        </ul>
                      )}
                      <TabPreview
                        key={ntResult.result.tab}
                        ascii={ntResult.result.tab}
                        title={ntResult.result.title || ntResult.trackName}
                        bpm={ntResult.result.bpm}
                        onImportMidi={(t) => void handleNtImportMidi(t)}
                      />
                      <div className="flex items-center justify-end gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={() => setNtResult(null)}
                          className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
                        >
                          Fermer
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-zinc-500">
                      {gpImportingTrack !== null
                        ? "Import en cours…"
                        : "Cochez plusieurs pistes puis « Importer la sélection ». Chaque piste devient une séquence nommée dans « Pistes ». Réimporter une piste déjà importée la remplace."}
                    </span>
                    <button
                      disabled={gpImportingTrack !== null}
                      onClick={handleGpCancel}
                      className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-50"
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              )}
              {gpTracks.some((t) => t.isVocal) && (
                <div className="flex flex-col gap-2 rounded-lg bg-zinc-800/70 border border-zinc-700 p-3">
                  <p className="text-[11px] text-zinc-300 font-semibold">
                    Ancrer les paroles sur la note vocale (diagramme dans la séquence)
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {gpTracks.filter((t) => t.isVocal).map((t) => {
                      const eventIdx =
                        t.firstNoteTime !== null && diagrams.length > 0
                          ? renderSequence(diagrams, song?.bpm ?? 120).findIndex(
                              (e) =>
                                t.firstNoteTime !== null &&
                                t.firstNoteTime >= e.start &&
                                t.firstNoteTime < e.start + e.duration + 1e-6
                            )
                          : -1;
                      return (
                        <button
                          key={t.index}
                          onClick={() => {
                            if (!song) return;
                            if (eventIdx >= 0) {
                              setLyricAnchorDiagram(eventIdx);
                              void upsert({ ...song, lyricAnchorDiagram: eventIdx });
                            } else {
                              const offset = -(t.firstNoteTime ?? 0);
                              setLyricsOffset(offset);
                              saveGlobalOffset(id, offset);
                            }
                          }}
                          className="flex items-center justify-between gap-2 text-left text-xs px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-200 hover:bg-zinc-700 transition-colors"
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <Mic2 className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                            <span className="truncate">{t.name}</span>
                          </span>
                          <span className="text-[10px] text-zinc-500">
                            {eventIdx >= 0
                              ? `Première note → diagramme ${eventIdx + 1}`
                              : t.firstNoteTime !== null
                                ? `Première note à ${t.firstNoteTime.toFixed(1)}s`
                                : "Pas de note détectée"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
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
                                    className="w-9 h-9 sm:w-7 sm:h-7 rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm font-bold"
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
                                    className="w-9 h-9 sm:w-7 sm:h-7 rounded-md bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm font-bold"
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
          className="fixed bottom-20 right-4 z-40 flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-full bg-sky-500 text-black hover:bg-sky-400 shadow-lg shadow-sky-500/30 transition-colors"
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
          midiUrl={midiUrl}
          program={activeProgram}
          percussion={activePercussion}
          lyricOffset={lyricsOffset}
          lyricAnchorDiagram={lyricAnchorDiagram ?? song?.lyricAnchorDiagram ?? undefined}
          onLyricOffsetChange={(offset) => {
            setLyricsOffset(offset);
            if (id) saveGlobalOffset(id, offset);
          }}
          bandOffset={bandOffset}
          onBandOffsetChange={(offset) => {
            setBandOffset(offset);
            if (id) saveBandOffset(id, offset);
          }}
          songId={id ?? undefined}
          onClose={() => setConductorOpen(false)}
        />
      )}
      {undoToast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 bg-zinc-900 border border-zinc-700 text-zinc-200 px-4 py-3 rounded-xl shadow-xl text-sm max-w-[calc(100vw-2rem)]">
          <span>{undoToast.message}</span>
          <button
            onClick={undoLast}
            className="text-amber-400 font-semibold hover:text-amber-300 transition-colors flex-shrink-0"
          >
            Annuler
          </button>
        </div>
      )}
    </div>
  );
}