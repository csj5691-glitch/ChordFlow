// Copyright (c) 2026 Claude St-Jean. All rights reserved.

export type SortField = "title" | "artist";
export type SortDirection = "asc" | "desc";

export interface RepertoireSort {
  field: SortField;
  direction: SortDirection;
}

const STORAGE_KEY = "chordflow-repertoire-sort";

const DEFAULT_SORT: RepertoireSort = { field: "title", direction: "asc" };

function isSortField(value: unknown): value is SortField {
  return value === "title" || value === "artist";
}

function isSortDirection(value: unknown): value is SortDirection {
  return value === "asc" || value === "desc";
}

export function loadRepertoireSort(): RepertoireSort {
  if (typeof window === "undefined") return DEFAULT_SORT;
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const field = isSortField(raw.field) ? raw.field : DEFAULT_SORT.field;
    const direction = isSortDirection(raw.direction) ? raw.direction : DEFAULT_SORT.direction;
    return { field, direction };
  } catch {
    return DEFAULT_SORT;
  }
}

export function saveRepertoireSort(sort: RepertoireSort): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sort));
}
