import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CLI_VERSION,
  CLIP_MODEL,
  ENGINE_PROTOCOL_VERSION,
  WHISPER_MODEL,
  YTDLP_ASSETS,
  YTDLP_VERSION,
} from "../dist/constants.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(scriptDirectory, "../../..");
const manifest = {
  manifest_version: 1,
  cli_version: CLI_VERSION,
  engine_version: CLI_VERSION,
  engine_protocol_version: ENGINE_PROTOCOL_VERSION,
  yt_dlp: {
    version: YTDLP_VERSION,
    assets: YTDLP_ASSETS,
  },
  models: {
    clip: CLIP_MODEL,
    whisper: WHISPER_MODEL,
  },
};
await mkdir(path.join(repository, "release"), { recursive: true });
await writeFile(
  path.join(repository, "release", "asset-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);
