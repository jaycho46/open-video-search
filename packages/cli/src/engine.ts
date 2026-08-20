import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { CLI_VERSION, ENGINE_PROTOCOL_VERSION } from "./constants.js";
import { OpenVideoError } from "./errors.js";

const EngineEventSchema = z.object({
  type: z.enum(["progress", "result", "error"]),
  stage: z.string().optional(),
  current: z.number().optional(),
  total: z.number().optional(),
  message: z.string().optional(),
  code: z.string().optional(),
  data: z.unknown().optional(),
});

export const EngineFrameSchema = z.object({
  id: z.string(),
  timestamp_ms: z.int().nonnegative(),
  path: z.string(),
  scene_id: z.int().nonnegative(),
  source: z.string(),
  brightness: z.number(),
  sharpness: z.number(),
});

export const EnginePrepareSchema = z.object({
  protocol_version: z.string(),
  engine_version: z.string(),
  video_id: z.string(),
  title: z.string(),
  source_type: z.enum(["youtube", "local"]),
  source: z.string(),
  canonical_url: z.string().optional(),
  media_path: z.string(),
  subtitle_path: z.string().optional(),
  subtitle_source: z.string().optional(),
  language: z.string().optional(),
  probe: z.object({
    path: z.string(),
    duration_ms: z.int().positive(),
    title: z.string().optional(),
    width: z.int().optional(),
    height: z.int().optional(),
    has_audio: z.boolean(),
    has_subtitles: z.boolean(),
    format_name: z.string().optional(),
    video_codec: z.string().optional(),
    audio_codec: z.string().optional(),
    subtitle_streams: z.int(),
  }),
  frames: z.array(EngineFrameSchema),
  warnings: z.array(z.string()).optional(),
});

export const EngineDoctorSchema = z.object({
  protocol_version: z.string(),
  engine_version: z.string(),
  dependencies: z.array(
    z.object({
      name: z.string(),
      path: z.string().optional(),
      version: z.string().optional(),
      available: z.boolean(),
      supported: z.boolean(),
    }),
  ),
});

export const EngineContextSchema = z.object({
  protocol_version: z.string(),
  engine_version: z.string(),
  frames: z.array(EngineFrameSchema),
});

export const EngineAudioSchema = z.object({
  protocol_version: z.string(),
  engine_version: z.string(),
  path: z.string(),
  sample_rate: z.literal(16000),
  channels: z.literal(1),
});

export type EnginePrepare = z.infer<typeof EnginePrepareSchema>;
export type EngineDoctor = z.infer<typeof EngineDoctorSchema>;
export type EngineContext = z.infer<typeof EngineContextSchema>;

async function executable(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export async function resolveEnginePath(): Promise<string> {
  const explicit = process.env.OPEN_VIDEO_ENGINE_PATH?.trim();
  if (explicit) {
    const resolved = path.resolve(explicit);
    if (await executable(resolved)) return resolved;
    throw new OpenVideoError("dependency", `OPEN_VIDEO_ENGINE_PATH does not exist: ${resolved}`);
  }

  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const vendored = path.join(packageRoot, "vendor", "open-video-engine");
  if (await executable(vendored)) return vendored;

  const platformPackage = `open-video-engine-${process.platform}-${process.arch}`;
  try {
    const require = createRequire(import.meta.url);
    const packageJson = require.resolve(`${platformPackage}/package.json`);
    const packaged = path.join(path.dirname(packageJson), "bin", "open-video-engine");
    if (await executable(packaged)) return packaged;
  } catch {
    // The development build and source install use the vendored engine instead.
  }

  throw new OpenVideoError(
    "dependency",
    `No media engine is installed for ${process.platform}/${process.arch}. Reinstall open-video or set OPEN_VIDEO_ENGINE_PATH.`,
  );
}

export interface RunEngineOptions {
  onProgress?: (stage: string, message: string) => void;
}

export async function runEngine<T>(
  command: string,
  args: string[],
  schema: z.ZodType<T>,
  options: RunEngineOptions = {},
): Promise<T> {
  const enginePath = await resolveEnginePath();
  const child = spawn(enginePath, [command, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 30));
  });

  let result: unknown;
  let engineError: { code?: string; message?: string } | undefined;
  for (const line of stdout.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    let event;
    try {
      event = EngineEventSchema.parse(JSON.parse(line) as unknown);
    } catch {
      throw new OpenVideoError("processing", `Media engine emitted invalid JSONL: ${line}`);
    }
    if (event.type === "progress") {
      options.onProgress?.(event.stage ?? "engine", event.message ?? "Working");
    } else if (event.type === "result") {
      result = event.data;
    } else {
      engineError = { code: event.code, message: event.message };
    }
  }

  if (exitCode !== 0 || engineError) {
    const kind = exitCode === 10 ? "dependency" : exitCode === 20 ? "acquisition" : "processing";
    throw new OpenVideoError(
      kind,
      engineError?.message ?? stderr.trim() ?? `Media engine exited with status ${exitCode}.`,
      { engine_code: engineError?.code, exit_code: exitCode },
    );
  }
  if (result === undefined) {
    throw new OpenVideoError("processing", stderr.trim() || "Media engine returned no result.");
  }
  const parsed = schema.parse(result);
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "protocol_version" in parsed &&
    parsed.protocol_version !== ENGINE_PROTOCOL_VERSION
  ) {
    throw new OpenVideoError(
      "dependency",
      `Engine protocol ${String(parsed.protocol_version)} is incompatible with CLI protocol ${ENGINE_PROTOCOL_VERSION}.`,
    );
  }
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "engine_version" in parsed &&
    parsed.engine_version !== CLI_VERSION
  ) {
    throw new OpenVideoError(
      "dependency",
      `Engine version ${String(parsed.engine_version)} does not match CLI version ${CLI_VERSION}.`,
    );
  }
  return parsed;
}
