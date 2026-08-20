import { OpenVideoError } from "./errors.js";

export function parseMilliseconds(value: string): number {
  const trimmed = value.trim();
  if (/^\d+$/u.test(trimmed)) {
    const parsed = Number(trimmed);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  const duration = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/u.exec(trimmed);
  if (duration) {
    const amount = Number(duration[1]);
    const unit = duration[2];
    const multiplier = unit === "ms" ? 1 : unit === "s" ? 1_000 : unit === "m" ? 60_000 : 3_600_000;
    const parsed = Math.round(amount * multiplier);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  const timestamp = /^(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d{1,3})?)$/u.exec(trimmed);
  if (timestamp) {
    const hours = Number(timestamp[1] ?? 0);
    const minutes = Number(timestamp[2]);
    const seconds = Number(timestamp[3]);
    const parsed = Math.round(((hours * 60 + minutes) * 60 + seconds) * 1_000);
    if (minutes < 60 && seconds < 60 && Number.isSafeInteger(parsed)) return parsed;
  }
  throw new OpenVideoError("usage", `Invalid time value '${value}'. Use milliseconds, 6s, or HH:MM:SS.mmm.`);
}

export function formatTimestamp(milliseconds: number): string {
  const total = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1_000);
  const millis = total % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}
