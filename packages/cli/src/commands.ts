import { Command, CommanderError, Option } from "commander";

import { CLI_VERSION } from "./constants.js";
import { listCache, pruneCache, removeCache } from "./cache.js";
import { parseSearchConstraint } from "./compositional-search.js";
import { getContext } from "./context.js";
import { doctor } from "./doctor.js";
import { OpenVideoError } from "./errors.js";
import { indexVideo } from "./indexer.js";
import { inspectIndex } from "./inspect.js";
import { printResult } from "./output.js";
import { searchIndex } from "./search.js";
import { setup } from "./setup.js";
import { getTimeline } from "./timeline.js";
import { parseMilliseconds } from "./time.js";

function integer(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new OpenVideoError("usage", `Expected an integer, received '${value}'.`);
  return parsed;
}

function boundedInteger(value: string, minimum: number, maximum: number, name: string): number {
  const parsed = integer(value);
  if (parsed < minimum || parsed > maximum) {
    throw new OpenVideoError("usage", `${name} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function progress(stage: string, message: string): void {
  process.stderr.write(`[${stage}] ${message}\n`);
}

export async function runCli(argv = process.argv): Promise<void> {
  const program = new Command();
  program
    .name("open-video")
    .description("Local-first semantic search for moments inside videos")
    .version(CLI_VERSION)
    .showHelpAfterError()
    .allowExcessArguments(false)
    .exitOverride();
  if (argv.includes("--json")) {
    program.configureOutput({
      writeErr: () => undefined,
    });
  }

  program
    .command("setup")
    .description("Install verified managed assets; FFmpeg 6.1+ remains a system dependency")
    .option("--asr", "also install the optional Whisper ASR model", false)
    .option("--offline", "use installed assets only", false)
    .action(async (options: { asr: boolean; offline: boolean }) => {
      const result = await setup({ ...options, onProgress: (message) => progress("setup", message) });
      printResult(result, false);
    });

  program
    .command("doctor")
    .description("Check the native engine, FFmpeg, and managed assets")
    .option("--json", "emit stable JSON", false)
    .action(async (options: { json: boolean }) => printResult(await doctor(), options.json));

  program
    .command("index")
    .description("Index a public YouTube URL or local video")
    .argument("<youtube-url|local-file>")
    .option("--language <bcp47>", "preferred subtitle or ASR language")
    .option("--subtitles <file>", "explicit subtitle file")
    .option("--asr", "run optional local Whisper when subtitles are unavailable", false)
    .option("--output <directory>", "write the index to this directory")
    .option("--offline", "use installed binaries, models, and caches only", false)
    .option("--json", "emit stable JSON", false)
    .action(
      async (
        source: string,
        options: {
          language?: string;
          subtitles?: string;
          asr: boolean;
          output?: string;
          offline: boolean;
          json: boolean;
        },
      ) => {
        const result = await indexVideo(source, {
          language: options.language,
          subtitles: options.subtitles,
          asr: options.asr,
          output: options.output,
          offline: options.offline,
          onProgress: progress,
        });
        printResult(result, options.json);
      },
    );

  program
    .command("search")
    .description("Find timestamped subtitle and visual evidence")
    .argument("<video-id|index-directory>")
    .argument("<text-query>")
    .option("--visual-query <english-visual-query>", "English CLIP query, especially useful for non-English questions")
    .option("--text-constraint <id=query>", "repeatable subtitle constraint for one temporal window", collect, [])
    .option("--visual-constraint <id=query>", "repeatable English visual constraint for one temporal window", collect, [])
    .option("--window <duration>", "compositional evidence window from 8s through 12s")
    .option("--require-all", "return only windows matching every logical constraint", false)
    .addOption(new Option("--mode <mode>").choices(["hybrid", "visual", "text"]).default("hybrid"))
    .option("--top <count>", "maximum result count", (value) => boundedInteger(value, 1, 50, "top"), 10)
    .option("--json", "emit stable JSON", false)
    .action(
      async (
        reference: string,
        query: string,
        options: {
          visualQuery?: string;
          textConstraint: string[];
          visualConstraint: string[];
          window?: string;
          requireAll: boolean;
          mode: "hybrid" | "visual" | "text";
          top: number;
          json: boolean;
        },
      ) => {
        const constraints = [
          ...options.textConstraint.map((value) => parseSearchConstraint(value, "text")),
          ...options.visualConstraint.map((value) => parseSearchConstraint(value, "visual")),
        ];
        const result = await searchIndex(reference, query, {
          visualQuery: options.visualQuery,
          mode: options.mode,
          top: options.top,
          constraints,
          windowMS: options.window === undefined ? undefined : parseMilliseconds(options.window),
          requireAll: options.requireAll,
        });
        printResult(result, options.json);
      },
    );

  program
    .command("context")
    .description("Extract evenly distributed frames and full subtitles around a timestamp")
    .argument("<video-id|index-directory>")
    .requiredOption("--at <time>", "HH:MM:SS.mmm or integer milliseconds")
    .option("--before <duration>", "context before timestamp", "6s")
    .option("--after <duration>", "context after timestamp", "6s")
    .option("--frames <count>", "number of context frames", (value) => boundedInteger(value, 1, 20, "frames"), 5)
    .option("--json", "emit stable JSON", false)
    .action(
      async (
        reference: string,
        options: { at: string; before: string; after: string; frames: number; json: boolean },
      ) => {
        const result = await getContext(reference, {
          at: parseMilliseconds(options.at),
          before: parseMilliseconds(options.before),
          after: parseMilliseconds(options.after),
          frames: options.frames,
        });
        printResult(result, options.json);
      },
    );

  program
    .command("timeline")
    .description("Read the video timeline in bounded, cursor-paginated chunks")
    .argument("<video-id|index-directory>")
    .option("--chunk <duration>", "timeline chunk size", "60s")
    .option("--cursor <token>", "cursor returned by the previous page")
    .option("--page-size <count>", "chunks per page", (value) => boundedInteger(value, 1, 100, "page-size"), 10)
    .option("--json", "emit stable JSON", false)
    .action(
      async (
        reference: string,
        options: { chunk: string; cursor?: string; pageSize: number; json: boolean },
      ) => {
        const chunk = parseMilliseconds(options.chunk);
        if (chunk < 1_000) throw new OpenVideoError("usage", "Timeline chunks must be at least one second.");
        printResult(await getTimeline(reference, chunk, options.cursor, options.pageSize), options.json);
      },
    );

  program
    .command("inspect")
    .description("Inspect a manifest and index metadata")
    .argument("<video-id|index-directory>")
    .option("--json", "emit stable JSON", false)
    .action(async (reference: string, options: { json: boolean }) => printResult(await inspectIndex(reference), options.json));

  const cache = program.command("cache").description("Inspect and explicitly manage the local cache");
  cache
    .command("list")
    .option("--json", "emit stable JSON", false)
    .action(async (options: { json: boolean }) => printResult(await listCache(), options.json));
  cache
    .command("remove")
    .argument("<video-id>")
    .option("--json", "emit stable JSON", false)
    .action(async (videoId: string, options: { json: boolean }) => printResult(await removeCache(videoId), options.json));
  cache
    .command("prune")
    .description("Remove failed, corrupt, and interrupted cache entries")
    .option("--json", "emit stable JSON", false)
    .action(async (options: { json: boolean }) => printResult(await pruneCache(), options.json));

  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.exitCode === 0) return;
      throw new OpenVideoError("usage", error.message);
    }
    throw error;
  }
}
