import MiniSearch, { type SearchResult } from "minisearch";

import type { TimelineEntry } from "./schemas.js";

export interface TextDocument {
  id: string;
  text: string;
  start_ms: number;
  end_ms: number;
}

const CJK_PATTERN = /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/u;

export function tokenizeSearchText(value: string): string[] {
  const normalized = value.normalize("NFKC").toLocaleLowerCase("und");
  const words = normalized.match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
  const tokens: string[] = [];
  for (const word of words) {
    tokens.push(word);
    if (!CJK_PATTERN.test(word)) continue;
    const points = Array.from(word);
    for (const size of [2, 3]) {
      for (let index = 0; index + size <= points.length; index += 1) {
        tokens.push(points.slice(index, index + size).join(""));
      }
    }
  }
  return [...new Set(tokens)];
}

const miniSearchOptions = {
  fields: ["text"],
  idField: "id",
  storeFields: ["text", "start_ms", "end_ms"],
  tokenize: tokenizeSearchText,
};

export function createTextIndex(entries: TimelineEntry[]): MiniSearch<TextDocument> {
  const index = new MiniSearch<TextDocument>(miniSearchOptions);
  const documents = entries
    .filter((entry) => entry.subtitle !== "")
    .map((entry) => ({
      id: String(entry.start_ms),
      text: entry.subtitle,
      start_ms: entry.start_ms,
      end_ms: entry.end_ms,
    }));
  if (documents.length > 0) index.addAll(documents);
  return index;
}

export function serializeTextIndex(index: MiniSearch<TextDocument>): string {
  return JSON.stringify(index);
}

export function loadTextIndex(serialized: string): MiniSearch<TextDocument> {
  return MiniSearch.loadJSON<TextDocument>(serialized, miniSearchOptions);
}

export function searchTextIndex(index: MiniSearch<TextDocument>, query: string, limit = 50): SearchResult[] {
  if (tokenizeSearchText(query).length === 0) return [];
  return index.search(query, {
    boost: { text: 1 },
    combineWith: "OR",
    fuzzy: false,
    prefix: false,
  }).slice(0, limit);
}

