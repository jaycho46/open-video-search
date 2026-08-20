import { inspect } from "node:util";

import { formatTimestamp } from "./time.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function printResult(value: unknown, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(value)}\n`);
    return;
  }
  if (isRecord(value) && Array.isArray(value.hits)) {
    console.table(
      value.hits.map((hit) => {
        const item = hit as Record<string, unknown>;
        return {
          rank: item.rank,
          time: formatTimestamp(Number(item.timestamp_ms)),
          score: Number(item.score).toFixed(5),
          match: Array.isArray(item.match) ? item.match.join("+") : "",
          constraints: Array.isArray(item.matched_constraints) ? item.matched_constraints.join("+") : "",
          subtitle: item.subtitle,
          frame: Array.isArray(item.frames) ? (item.frames[0] as Record<string, unknown> | undefined)?.path : "",
        };
      }),
    );
    return;
  }
  if (isRecord(value) && Array.isArray(value.items)) {
    console.table(
      value.items.map((entry) => {
        const item = entry as Record<string, unknown>;
        return {
          start: formatTimestamp(Number(item.start_ms)),
          end: formatTimestamp(Number(item.end_ms)),
          subtitle: item.subtitle,
          frames: Array.isArray(item.frames) ? item.frames.length : 0,
        };
      }),
    );
    if (value.next_cursor) process.stdout.write(`next cursor: ${String(value.next_cursor)}\n`);
    return;
  }
  if (Array.isArray(value)) {
    console.table(value);
    return;
  }
  process.stdout.write(`${inspect(value, { colors: process.stdout.isTTY, depth: 6, compact: false })}\n`);
}
