import { chmod, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";

import {
  CLIP_MODEL,
  WHISPER_MODEL,
  YTDLP_ASSETS,
  YTDLP_VERSION,
} from "./constants.js";
import { OpenVideoError } from "./errors.js";
import {
  ensureDirectory,
  pathExists,
  pipeWebResponse,
  sha256File,
  sha256Text,
  writeJson,
} from "./files.js";
import { openVideoPaths } from "./paths.js";

type ModelSpec = typeof CLIP_MODEL | typeof WHISPER_MODEL;

interface ModelReceipt {
  id: string;
  revision: string;
  dtype: string;
  fingerprint: string;
  installed_at: string;
}

export function modelFingerprint(spec: ModelSpec): string {
  return sha256Text(
    JSON.stringify({
      id: spec.id,
      revision: spec.revision,
      dtype: spec.dtype,
      checksums: spec.checksums,
    }),
  );
}

export function modelDirectory(spec: ModelSpec): string {
  return path.join(openVideoPaths().models, spec.key);
}

export function managedYtDlpPath(): string {
  return path.join(openVideoPaths().binaries, `yt-dlp-${YTDLP_VERSION}`);
}

function platformAsset(): (typeof YTDLP_ASSETS)[keyof typeof YTDLP_ASSETS] {
  const key = `${process.platform}-${process.arch}` as keyof typeof YTDLP_ASSETS;
  const asset = YTDLP_ASSETS[key];
  if (!asset) {
    throw new OpenVideoError(
      "dependency",
      `yt-dlp is not packaged for ${process.platform}/${process.arch}; v0.1 supports macOS and Linux on arm64/x64.`,
    );
  }
  return asset;
}

async function download(url: string, target: string, offline: boolean): Promise<void> {
  if (offline) {
    throw new OpenVideoError("dependency", `Offline mode cannot download required asset: ${target}`);
  }
  await ensureDirectory(path.dirname(target));
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new OpenVideoError("dependency", `Download failed (${response.status}) for ${url}`);
  }
  const temporary = `${target}.download-${process.pid}`;
  await rm(temporary, { force: true });
  try {
    await pipeWebResponse(response.body, temporary);
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function ensureYtDlp(offline: boolean): Promise<string> {
  const target = managedYtDlpPath();
  const asset = platformAsset();
  if (await pathExists(target)) {
    const checksum = await sha256File(target);
    if (checksum === asset.sha256) {
      await chmod(target, 0o755);
      return target;
    }
    if (offline) {
      throw new OpenVideoError("dependency", "The installed yt-dlp checksum is invalid and offline mode prevents repair.");
    }
    await rm(target, { force: true });
  }

  const url = `https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/${asset.filename}`;
  await download(url, target, offline);
  const checksum = await sha256File(target);
  if (checksum !== asset.sha256) {
    await rm(target, { force: true });
    throw new OpenVideoError("dependency", "Downloaded yt-dlp failed SHA-256 verification.");
  }
  await chmod(target, 0o755);
  return target;
}

async function validModelReceipt(spec: ModelSpec): Promise<boolean> {
  const directory = modelDirectory(spec);
  const receiptPath = path.join(directory, ".open-video-model.json");
  if (!(await pathExists(receiptPath))) return false;
  let receipt: ModelReceipt;
  try {
    receipt = JSON.parse(await readFile(receiptPath, "utf8")) as ModelReceipt;
  } catch {
    return false;
  }
  if (receipt.fingerprint !== modelFingerprint(spec)) return false;
  for (const file of spec.files) {
    if (!(await pathExists(path.join(directory, file)))) return false;
  }
  for (const [file, checksum] of Object.entries(spec.checksums)) {
    if ((await sha256File(path.join(directory, file))) !== checksum) return false;
  }
  return true;
}

export async function isModelInstalled(spec: ModelSpec): Promise<boolean> {
  return validModelReceipt(spec);
}

export async function ensureModel(spec: ModelSpec, offline: boolean): Promise<string> {
  const directory = modelDirectory(spec);
  if (await validModelReceipt(spec)) return directory;
  if (offline) {
    throw new OpenVideoError("dependency", `${spec.id} is not installed or failed checksum verification.`);
  }

  await ensureDirectory(directory);
  for (const file of spec.files) {
    const target = path.join(directory, file);
    const expected = (spec.checksums as Readonly<Record<string, string>>)[file];
    if (await pathExists(target)) {
      if (!expected || (await sha256File(target)) === expected) continue;
      await rm(target, { force: true });
    }
    const encodedPath = file.split("/").map(encodeURIComponent).join("/");
    const url = `https://huggingface.co/${spec.id}/resolve/${spec.revision}/${encodedPath}?download=true`;
    await download(url, target, false);
    if (expected && (await sha256File(target)) !== expected) {
      await rm(target, { force: true });
      throw new OpenVideoError("dependency", `Model file failed SHA-256 verification: ${file}`);
    }
  }

  const receipt: ModelReceipt = {
    id: spec.id,
    revision: spec.revision,
    dtype: spec.dtype,
    fingerprint: modelFingerprint(spec),
    installed_at: new Date().toISOString(),
  };
  await writeJson(path.join(directory, ".open-video-model.json"), receipt);
  return directory;
}

export async function ensureClipModel(offline: boolean): Promise<string> {
  return ensureModel(CLIP_MODEL, offline);
}

export async function ensureWhisperModel(offline: boolean): Promise<string> {
  return ensureModel(WHISPER_MODEL, offline);
}
