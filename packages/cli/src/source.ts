import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { finished } from "node:stream/promises";

import { OpenVideoError } from "./errors.js";

const LOCAL_EXTENSIONS = new Set([".mp4", ".mov", ".mkv", ".webm"]);

export interface ResolvedSource {
  type: "youtube" | "local";
  input: string;
  canonicalUrl?: string;
  videoId: string;
  contentHash?: string;
}

export function youtubeVideoId(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  const host = url.hostname.toLowerCase().replace(/^www\./u, "");
  if (!["youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"].includes(host)) {
    return undefined;
  }
  if (url.searchParams.has("list")) {
    throw new OpenVideoError("acquisition", "Playlists are not supported; provide one YouTube video URL.");
  }
  let id = "";
  if (host === "youtu.be") id = url.pathname.split("/").filter(Boolean)[0] ?? "";
  else if (url.pathname.startsWith("/shorts/")) id = url.pathname.split("/")[2] ?? "";
  else id = url.searchParams.get("v") ?? "";
  if (!/^[A-Za-z0-9_-]{6,20}$/u.test(id)) {
    throw new OpenVideoError("acquisition", "The YouTube URL does not contain a valid video ID.");
  }
  return id;
}

export async function resolveSource(input: string): Promise<ResolvedSource> {
  const youtubeId = youtubeVideoId(input);
  if (youtubeId) {
    return {
      type: "youtube",
      input,
      canonicalUrl: `https://www.youtube.com/watch?v=${youtubeId}`,
      videoId: `youtube-${youtubeId}`,
    };
  }

  try {
    const url = new URL(input);
    if (url.protocol === "http:" || url.protocol === "https:") {
      throw new OpenVideoError("acquisition", "v0.1 supports only public YouTube URLs or local video files.");
    }
  } catch (error) {
    if (error instanceof OpenVideoError) throw error;
  }

  const absolute = path.resolve(input);
  let info;
  try {
    info = await stat(absolute);
  } catch {
    throw new OpenVideoError("acquisition", `Local video does not exist: ${absolute}`);
  }
  if (!info.isFile() || !LOCAL_EXTENSIONS.has(path.extname(absolute).toLowerCase())) {
    throw new OpenVideoError("acquisition", "Local inputs must be MP4, MOV, MKV, or WebM files.");
  }
  const hash = createHash("sha256");
  const stream = createReadStream(absolute);
  stream.on("data", (chunk) => hash.update(chunk));
  await finished(stream);
  const digest = hash.digest("hex");
  return {
    type: "local",
    input: absolute,
    videoId: `local-${digest.slice(0, 16)}`,
    contentHash: digest,
  };
}
