import { ChordLine, ChordSection } from "./types";

const CHORD_REGEX = /^([A-G][#b]?(?:m|min|maj|dim|aug|sus[24]?|add[0-9]+|[0-9]+)?(?:\/[A-G][#b]?)?)\s*$/;

export function parseChordContent(content: string): ChordSection[] {
  const rawLines = content.split("\n");
  const sections: ChordSection[] = [];
  let currentSection: ChordSection = { lines: [] };
  let pendingChords: string[] | null = null;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const trimmed = line.trim();

    if (/^\[.*\]$/.test(trimmed)) {
      if (pendingChords) {
        currentSection.lines.push({
          chords: pendingChords,
          lyrics: "",
          rawChord: pendingChords.join(" "),
        });
        pendingChords = null;
      }
      if (currentSection.lines.length > 0 || currentSection.label) {
        sections.push(currentSection);
      }
      currentSection = {
        label: trimmed.replace(/^\[|\]$/g, ""),
        lines: [],
      };
      continue;
    }

    if (!trimmed) {
      if (pendingChords) {
        currentSection.lines.push({
          chords: pendingChords,
          lyrics: "",
          rawChord: pendingChords.join(" "),
        });
        pendingChords = null;
      }
      if (currentSection.lines.length > 0) {
        sections.push(currentSection);
        currentSection = { lines: [] };
      }
      continue;
    }

    if (isChordLine(trimmed)) {
      if (pendingChords) {
        currentSection.lines.push({
          chords: pendingChords,
          lyrics: "",
          rawChord: pendingChords.join(" "),
        });
      }
      pendingChords = extractChords(trimmed);
    } else {
      if (pendingChords) {
        currentSection.lines.push({
          chords: pendingChords,
          lyrics: trimmed,
          rawChord: pendingChords.join(" "),
        });
        pendingChords = null;
      } else {
        currentSection.lines.push({
          chords: [],
          lyrics: trimmed,
          rawChord: "",
        });
      }
    }
  }

  if (pendingChords) {
    currentSection.lines.push({
      chords: pendingChords,
      lyrics: "",
      rawChord: pendingChords.join(" "),
    });
  }
  if (currentSection.lines.length > 0 || currentSection.label) {
    sections.push(currentSection);
  }

  return sections;
}

function isChordLine(line: string): boolean {
  const tokens = line.trim().split(/\s+/);
  if (tokens.length === 0) return false;
  const chordCount = tokens.filter((t) => CHORD_REGEX.test(t)).length;
  return chordCount / tokens.length > 0.5;
}

function extractChords(line: string): string[] {
  return line.trim().split(/\s+/).filter((t) => CHORD_REGEX.test(t));
}

export function sectionsToContent(sections: ChordSection[]): string {
  const parts: string[] = [];
  for (const section of sections) {
    if (section.label) {
      parts.push(`[${section.label}]`);
    }
    for (const line of section.lines) {
      if (line.chords.length > 0) {
        parts.push(line.rawChord || line.chords.join("  "));
      }
      if (line.lyrics) {
        parts.push(line.lyrics);
      }
    }
    parts.push("");
  }
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
