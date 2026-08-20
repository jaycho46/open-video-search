import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("./models.js", () => ({
  embedImages: async (paths: string[]) =>
    paths.map((framePath) => {
      const timestamp = Number(path.basename(framePath, ".jpg"));
      if (timestamp >= 4_000) return new Float32Array([0, 0, 1]);
      if (timestamp >= 2_000) return new Float32Array([0, 1, 0]);
      return new Float32Array([1, 0, 0]);
    }),
  embedText: async () => new Float32Array([0, 0, 1]),
  transcribeAudio: async () => [],
}));

vi.mock("./assets.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./assets.js")>();
  return { ...actual, ensureClipModel: async () => "/mock/clip" };
});

import { getContext } from "./context.js";
import { indexVideo } from "./indexer.js";
import { searchIndex } from "./search.js";
import { getTimeline } from "./timeline.js";

describe("local video integration", () => {
  let root = "";
  let video = "";
  let indexDirectory = "";
  let previousEngine: string | undefined;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "open-video-integration-"));
    video = path.join(root, "fixture.mp4");
    indexDirectory = path.join(root, "index");
    const engine = path.join(root, "open-video-engine");
    execFileSync("go", ["build", "-o", engine, "./cmd/open-video-engine"], {
      cwd: path.resolve(process.cwd(), "../../engine"),
      stdio: "pipe",
    });
    execFileSync(
      "ffmpeg",
      [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "color=c=red:s=320x180:d=2",
        "-f", "lavfi", "-i", "color=c=green:s=320x180:d=2",
        "-f", "lavfi", "-i", "color=c=blue:s=320x180:d=2",
        "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p[v]",
        "-map", "[v]", video,
      ],
      { stdio: "pipe" },
    );
    await writeFile(
      path.join(root, "fixture.vtt"),
      "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nred room\n\n00:00:04.000 --> 00:00:06.000\nblue car\n",
      "utf8",
    );
    previousEngine = process.env.OPEN_VIDEO_ENGINE_PATH;
    process.env.OPEN_VIDEO_ENGINE_PATH = engine;
  }, 30_000);

  afterAll(async () => {
    if (previousEngine === undefined) delete process.env.OPEN_VIDEO_ENGINE_PATH;
    else process.env.OPEN_VIDEO_ENGINE_PATH = previousEngine;
    await rm(root, { recursive: true, force: true });
  });

  it("indexes, reuses, searches, paginates, and extracts context", async () => {
    const indexed = await indexVideo(video, {
      subtitles: path.join(root, "fixture.vtt"),
      asr: false,
      output: indexDirectory,
      offline: true,
    });
    expect(indexed.reused).toBe(false);
    expect(indexed.manifest.frame_count).toBeGreaterThanOrEqual(3);

    const reused = await indexVideo(video, {
      subtitles: path.join(root, "fixture.vtt"),
      asr: false,
      output: indexDirectory,
      offline: true,
    });
    expect(reused.reused).toBe(true);

    const visual = await searchIndex(indexDirectory, "차", {
      visualQuery: "blue car",
      mode: "visual",
      top: 3,
    });
    expect(visual.hits[0]?.start_ms).toBe(4_000);
    expect(visual.hits[0]?.timestamp_ms).toBe(4_000);
    expect(visual.hits[0]?.frames[0]?.path).toMatch(/^\//u);
    expect(visual.hits[0]?.matched_constraints).toEqual(["query"]);

    const text = await searchIndex(indexDirectory, "blue car", { mode: "text", top: 3 });
    expect(text.hits[0]?.start_ms).toBe(4_000);

    const compositional = await searchIndex(indexDirectory, "blue car", {
      mode: "text",
      top: 3,
      constraints: [{ id: "setting", modality: "text", query: "red room" }],
      windowMS: 8_000,
      requireAll: true,
    });
    expect(compositional.window_ms).toBe(8_000);
    expect(compositional.hits[0]).toMatchObject({
      start_ms: 0,
      end_ms: 6_000,
      matched_constraints: ["query", "setting"],
    });

    const timeline = await getTimeline(indexDirectory, 2_000, undefined, 2);
    expect(timeline.items).toHaveLength(2);
    expect(timeline.next_cursor).toBeTypeOf("string");

    const context = await getContext(indexDirectory, { at: 4_500, before: 1_000, after: 1_000, frames: 3 });
    expect(context.frames).toHaveLength(3);
    expect(context.subtitle).toContain("blue car");

    await writeFile(path.join(indexDirectory, "index", "text-index.json"), "{", "utf8");
    await expect(searchIndex(indexDirectory, "blue car", { mode: "text", top: 3 })).rejects.toMatchObject({
      kind: "index",
      exitCode: 40,
    });
  }, 30_000);
});
