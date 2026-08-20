import { readFile, writeFile } from "node:fs/promises";

export interface CaptionCue {
  start_ms: number;
  end_ms: number;
  text: string;
}

export function parseTimestamp(value: string): number {
  const normalized = value.trim().replace(",", ".");
  const parts = normalized.split(":");
  if (parts.length < 2 || parts.length > 3) throw new Error(`Invalid timestamp: ${value}`);
  const seconds = Number(parts.pop());
  const minutes = Number(parts.pop());
  const hours = parts.length === 1 ? Number(parts[0]) : 0;
  if (![seconds, minutes, hours].every(Number.isFinite)) throw new Error(`Invalid timestamp: ${value}`);
  return Math.round(((hours * 60 + minutes) * 60 + seconds) * 1_000);
}

export function formatVttTimestamp(milliseconds: number): string {
  const bounded = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(bounded / 3_600_000);
  const minutes = Math.floor((bounded % 3_600_000) / 60_000);
  const seconds = Math.floor((bounded % 60_000) / 1_000);
  const millis = bounded % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function decodeEntities(value: string): string {
  return value
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

export function normalizeCaptionText(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/gu, " "))
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
}

export function parseVtt(value: string): CaptionCue[] {
  const lines = value.replace(/^\uFEFF/u, "").split(/\r?\n/u);
  const cues: CaptionCue[] = [];
  let index = 0;
  while (index < lines.length) {
    let line = lines[index]?.trim() ?? "";
    if (line === "" || line === "WEBVTT" || line.startsWith("NOTE")) {
      index += 1;
      continue;
    }
    if (!line.includes("-->")) {
      index += 1;
      line = lines[index]?.trim() ?? "";
    }
    if (!line.includes("-->")) {
      index += 1;
      continue;
    }
    const [startValue, endWithSettings] = line.split("-->").map((part) => part.trim());
    const endValue = endWithSettings?.split(/\s+/u)[0];
    if (!startValue || !endValue) {
      index += 1;
      continue;
    }
    index += 1;
    const textLines: string[] = [];
    while (index < lines.length && (lines[index]?.trim() ?? "") !== "") {
      textLines.push(lines[index] ?? "");
      index += 1;
    }
    try {
      const start_ms = parseTimestamp(startValue);
      const end_ms = parseTimestamp(endValue);
      const text = normalizeCaptionText(textLines.join(" "));
      if (text && end_ms > start_ms) cues.push({ start_ms, end_ms, text });
    } catch {
      // Skip malformed cues while preserving valid neighboring captions.
    }
  }

  const deduplicated: CaptionCue[] = [];
  for (const cue of cues.sort((left, right) => left.start_ms - right.start_ms)) {
    const previous = deduplicated.at(-1);
    if (previous && previous.text === cue.text && cue.start_ms <= previous.end_ms + 250) {
      previous.end_ms = Math.max(previous.end_ms, cue.end_ms);
    } else {
      deduplicated.push({ ...cue });
    }
  }
  return deduplicated;
}

export async function readVtt(target: string): Promise<CaptionCue[]> {
  return parseVtt(await readFile(target, "utf8"));
}

export function cuesToVtt(cues: CaptionCue[]): string {
  const blocks = cues.map(
    (cue, index) =>
      `${index + 1}\n${formatVttTimestamp(cue.start_ms)} --> ${formatVttTimestamp(cue.end_ms)}\n${cue.text}`,
  );
  return `WEBVTT\n\n${blocks.join("\n\n")}\n`;
}

export async function writeVtt(target: string, cues: CaptionCue[]): Promise<void> {
  await writeFile(target, cuesToVtt(cues), "utf8");
}

export function captionsInWindow(cues: CaptionCue[], startMS: number, endMS: number): string {
  const values: string[] = [];
  for (const cue of cues) {
    if (cue.end_ms <= startMS || cue.start_ms >= endMS) continue;
    if (values.at(-1) !== cue.text) values.push(cue.text);
  }
  return values.join(" ").trim();
}

