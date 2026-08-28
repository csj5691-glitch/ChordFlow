// Copyright (c) 2026 Claude St-Jean. All rights reserved.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

const TUNING_LABELS: Record<string, string> = {
  "E A D G B E": "Standard (EADGBE)",
  "D# G# C# F# A# D#": "Half Step Down (D#G#C#F#A#D#)",
  "Eb Ab Db Gb Bb Eb": "Half Step Down (D#G#C#F#A#D#)",
  "D G C F A D": "Whole Step Down (DGCFAD)",
  "D A D G B E": "Drop D (DADGBE)",
  "D G D G B D": "Open G (DGDGBD)",
  "D A D F# A D": "Open D (DADF#AD)",
  "D A D G A D": "DADGAD",
};

const DEFAULT_TUNING_LABEL = "Standard (EADGBE)";

export interface UgSearchResult {
  tabId: number;
  songName: string;
  artistName: string;
  type: string;
  tabUrl: string;
  tonality?: string;
  rating?: number;
  votes?: number;
}

export interface UgTabData {
  title: string;
  artist: string;
  content: string;
  tonality?: string;
  tuningLabel?: string;
  capo?: number;
  type: string;
  url: string;
}

export function normalizeTuningValue(value?: string): string | undefined {
  if (!value) return undefined;
  const key = value.trim().replace(/\s+/g, " ");
  const known = TUNING_LABELS[key];
  if (known) return known;
  return key;
}

export function isDefaultTuning(label: string): boolean {
  return label === DEFAULT_TUNING_LABEL;
}

const ENTITIES: Record<string, string> = {
  "&quot;": '"',
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&#039;": "'",
  "&apos;": "'",
  "&#39;": "'",
  "&nbsp;": " ",
};

export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&(quot|amp|lt|gt|apos|nbsp|#0?39);/g, (m, name) => {
      if (name.startsWith("#")) return "'";
      return ENTITIES[`&${name};`] ?? m;
    })
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)));
}

function extractJsStore(html: string): unknown {
  const m = html.match(/data-content="([\s\S]*?)"/);
  if (!m) return null;
  try {
    return JSON.parse(decodeHtmlEntities(m[1]));
  } catch {
    return null;
  }
}

function findTabView(data: Record<string, unknown>): Record<string, unknown> | null {
  const store = asRecord(data, ["store"]);
  const page = asRecord(store, ["page"]);
  const pageData = asRecord(page, ["data"]);
  const tv = asRecord(pageData, ["tab_view"]);
  return tv ? record(tv) : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asRecord(obj: Record<string, unknown>, keyPath: string[]): Record<string, unknown> {
  let cur: Record<string, unknown> = obj;
  for (const key of keyPath) {
    const next = cur[key];
    if (next && typeof next === "object" && !Array.isArray(next)) {
      cur = next as Record<string, unknown>;
    } else {
      return {};
    }
  }
  return cur;
}

export async function searchUg(query: string): Promise<UgSearchResult[]> {
  const url = `https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`UG search failed (${res.status})`);
  const html = await res.text();
  const data = record(extractJsStore(html));
  const pageData = asRecord(data, ["store", "page", "data"]);
  const rawResults = pageData["results"];
  const bucket = Array.isArray(rawResults) ? (rawResults as unknown[]) : [];
  return bucket
    .map((item) => {
      const r = record(item);
      return {
        tabId: Number(r["id"]) || 0,
        songName: typeof r["song_name"] === "string" ? (r["song_name"] as string) : "",
        artistName: typeof r["artist_name"] === "string" ? (r["artist_name"] as string) : "",
        type: typeof r["type"] === "string" ? (r["type"] as string) : "",
        tabUrl: typeof r["tab_url"] === "string" ? (r["tab_url"] as string) : "",
        tonality: typeof r["tonality_name"] === "string" ? (r["tonality_name"] as string) : undefined,
        rating: typeof r["rating"] === "number" ? (r["rating"] as number) : undefined,
        votes: typeof r["votes"] === "number" ? (r["votes"] as number) : undefined,
      };
    })
    .filter(
      (r) =>
        r.tabUrl.includes("/tab/") &&
        (r.type === "Chords" || r.type === "Ukulele Chords")
    );
}

export async function fetchUgTab(tabUrl: string): Promise<UgTabData> {
  const res = await fetch(tabUrl, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`UG tab fetch failed (${res.status})`);
  const html = await res.text();
  const data = record(extractJsStore(html));
  const tv = findTabView(data);
  if (!tv) throw new Error("Tab data not found");

  const wikiTab = record(tv["wiki_tab"]);
  const meta = record(tv["meta"]);
  const header = record(tv["headerMeta"]);

  const rawArtists = header["artists"];
  const artists = Array.isArray(rawArtists) ? (rawArtists as unknown[]) : [];
  const artist = artists
    .map((a) => {
      const ar = record(a);
      return typeof ar["name"] === "string" ? (ar["name"] as string) : "";
    })
    .filter(Boolean)
    .join(", ");

  const tuning = record(meta["tuning"]);
  const rawCapo = meta["capo"];

  return {
    title: typeof header["name"] === "string" ? (header["name"] as string) : "",
    artist,
    content: ugContentToChordFlow(
      typeof wikiTab["content"] === "string" ? (wikiTab["content"] as string) : ""
    ),
    tonality: typeof meta["tonality"] === "string" ? (meta["tonality"] as string) : undefined,
    tuningLabel: normalizeTuningValue(
      typeof tuning["value"] === "string" ? (tuning["value"] as string) : undefined
    ),
    capo: typeof rawCapo === "number" && rawCapo > 0 ? rawCapo : undefined,
    type: typeof header["type"] === "string" ? (header["type"] as string) : "Chords",
    url: tabUrl,
  };
}

export function ugContentToChordFlow(ug: string): string {
  const decoded = decodeHtmlEntities(ug).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const cleaned = decoded.replace(/\[\/?tab\]/g, "");
  const lines = cleaned.split("\n");
  const out: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push("");
      continue;
    }
    if (/^\[[^\[\]]+\]$/.test(trimmed)) {
      out.push(line);
      continue;
    }
    if (line.includes("[ch]")) {
      out.push(line.replace(/\[ch\]([\s\S]*?)\[\/ch\]/g, (_m, name: string) => name));
    } else {
      out.push(line.replace(/\[\/?ch\]/g, ""));
    }
  }

  return collapseBlankLines(out);
}

function collapseBlankLines(lines: string[]): string {
  const result: string[] = [];
  for (const line of lines) {
    if (line === "" && result[result.length - 1] === "" && result.length > 0) {
      continue;
    }
    result.push(line);
  }
  return result.join("\n").trim();
}
