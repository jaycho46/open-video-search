import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { finished } from "node:stream/promises";
import type { Readable } from "node:stream";

import type { z } from "zod";

export async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDirectory(target: string): Promise<void> {
  await mkdir(target, { recursive: true });
}

export async function sha256File(target: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(target);
  stream.on("data", (chunk) => hash.update(chunk));
  await finished(stream);
  return hash.digest("hex");
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function readJson<T>(target: string, schema: z.ZodType<T>): Promise<T> {
  const parsed: unknown = JSON.parse(await readFile(target, "utf8"));
  return schema.parse(parsed);
}

export async function writeJson(target: string, value: unknown): Promise<void> {
  await ensureDirectory(path.dirname(target));
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function readJsonLines<T>(target: string, schema: z.ZodType<T>): Promise<T[]> {
  const value = await readFile(target, "utf8");
  return value
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== "")
    .map((line) => schema.parse(JSON.parse(line) as unknown));
}

export async function writeJsonLines(target: string, values: unknown[]): Promise<void> {
  await ensureDirectory(path.dirname(target));
  const content = values.map((value) => JSON.stringify(value)).join("\n");
  await writeFile(target, content === "" ? "" : `${content}\n`, "utf8");
}

export async function makeSiblingTemporary(target: string): Promise<string> {
  const parent = path.dirname(target);
  await ensureDirectory(parent);
  const temporary = path.join(parent, `.${path.basename(target)}.tmp-${process.pid}-${randomUUID()}`);
  await mkdir(temporary, { recursive: false });
  return temporary;
}

export async function atomicReplaceDirectory(temporary: string, target: string): Promise<void> {
  const backup = `${target}.old-${process.pid}-${randomUUID()}`;
  const targetExists = await pathExists(target);
  if (targetExists) await rename(target, backup);
  try {
    await rename(temporary, target);
  } catch (error) {
    if (targetExists && (await pathExists(backup))) await rename(backup, target);
    throw error;
  }
  if (targetExists) await rm(backup, { recursive: true, force: true });
}

export async function directorySize(target: string): Promise<number> {
  const info = await stat(target);
  if (!info.isDirectory()) return info.size;
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(target, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    total += await directorySize(path.join(target, entry.name));
  }
  return total;
}

export async function pipeWebResponse(body: ReadableStream<Uint8Array>, target: string): Promise<void> {
  await ensureDirectory(path.dirname(target));
  const { createWriteStream } = await import("node:fs");
  const { Readable: NodeReadable } = await import("node:stream");
  const output = createWriteStream(target, { mode: 0o644 });
  // Node and DOM currently expose structurally equivalent Web Stream types with
  // incompatible generic declarations. The runtime object comes directly from fetch.
  await finished((NodeReadable.fromWeb(body as never) as Readable).pipe(output));
}
