import { CLIP_MODEL, CLI_VERSION, SCHEMA_VERSION, WHISPER_MODEL, YTDLP_VERSION } from "./constants.js";
import { isModelInstalled, managedYtDlpPath } from "./assets.js";
import { EngineDoctorSchema, resolveEnginePath, runEngine } from "./engine.js";
import { pathExists } from "./files.js";
import { DoctorResponseSchema, type DoctorResponse } from "./schemas.js";

export async function doctor(): Promise<DoctorResponse> {
  let engineVersion: string | undefined;
  let protocolVersion: string | undefined;
  let dependencies: DoctorResponse["dependencies"] = [];
  let engineAvailable = true;
  try {
    await resolveEnginePath();
    const ytDlp = managedYtDlpPath();
    const args = (await pathExists(ytDlp)) ? ["--yt-dlp", ytDlp] : [];
    const result = await runEngine("doctor", args, EngineDoctorSchema);
    engineVersion = result.engine_version;
    protocolVersion = result.protocol_version;
    dependencies = result.dependencies;
  } catch {
    engineAvailable = false;
    dependencies = [
      { name: "open-video-engine", available: false, supported: false },
    ];
  }
  const [clipInstalled, whisperInstalled, ytDlpInstalled] = await Promise.all([
    isModelInstalled(CLIP_MODEL),
    isModelInstalled(WHISPER_MODEL),
    pathExists(managedYtDlpPath()),
  ]);
  const coreDependenciesReady = dependencies
    .filter((dependency) => dependency.name === "ffmpeg" || dependency.name === "ffprobe")
    .every((dependency) => dependency.available && dependency.supported);
  return DoctorResponseSchema.parse({
    schema_version: SCHEMA_VERSION,
    ready: engineAvailable && coreDependenciesReady && clipInstalled,
    cli_version: CLI_VERSION,
    engine_version: engineVersion,
    protocol_version: protocolVersion,
    dependencies,
    assets: [
      {
        name: "yt-dlp",
        installed: ytDlpInstalled,
        path: ytDlpInstalled ? managedYtDlpPath() : undefined,
        version: ytDlpInstalled ? YTDLP_VERSION : undefined,
      },
      { name: "clip", installed: clipInstalled, path: clipInstalled ? CLIP_MODEL.id : undefined },
      { name: "whisper", installed: whisperInstalled, path: whisperInstalled ? WHISPER_MODEL.id : undefined },
    ],
  });
}

