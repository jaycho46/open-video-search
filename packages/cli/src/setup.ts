import { ensureClipModel, ensureWhisperModel, ensureYtDlp } from "./assets.js";
import { OpenVideoError } from "./errors.js";
import { doctor } from "./doctor.js";

export interface SetupOptions {
  asr: boolean;
  offline: boolean;
  onProgress?: (message: string) => void;
}

export async function setup(options: SetupOptions): Promise<{ ready: true; asr: boolean }> {
  options.onProgress?.("Checking FFmpeg and the native media engine");
  const status = await doctor();
  const missingCore = status.dependencies.filter(
    (dependency) =>
      (dependency.name === "ffmpeg" || dependency.name === "ffprobe" || dependency.name === "open-video-engine") &&
      (!dependency.available || !dependency.supported),
  );
  if (missingCore.length > 0) {
    throw new OpenVideoError(
      "dependency",
      `Required dependency is unavailable or unsupported: ${missingCore.map((item) => item.name).join(", ")}. FFmpeg/FFprobe 6.1+ are required.`,
    );
  }
  options.onProgress?.("Installing verified yt-dlp");
  await ensureYtDlp(options.offline);
  options.onProgress?.("Installing the pinned quantized CLIP model");
  await ensureClipModel(options.offline);
  if (options.asr) {
    options.onProgress?.("Installing the pinned quantized Whisper model");
    await ensureWhisperModel(options.offline);
  }
  return { ready: true, asr: options.asr };
}

