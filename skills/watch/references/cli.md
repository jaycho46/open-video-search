# open-video CLI reference

Use `--json` for agent workflows. Successful commands write exactly one final result to stdout; progress and diagnostics go to stderr. Stored and returned times are integer milliseconds. Returned frame paths are absolute and can be opened by the host.

## Readiness and indexing

```bash
open-video doctor --json
open-video setup [--asr] [--offline]
open-video index <youtube-url|local-file> \
  [--language <bcp47>] [--subtitles <file>] [--asr] \
  [--output <directory>] [--offline] --json
```

`index` returns `video_id`, `index_directory`, `reused`, and `manifest`. The same source and settings reuse a complete index. Offline mode fails clearly if a required binary or model is absent.

## Search

```bash
open-video search <video-id|index-directory> "<text-query>" \
  [--visual-query "<english-visual-query>"] \
  [--text-constraint "<id>=<query>"]... \
  [--visual-constraint "<id>=<english-query>"]... \
  [--window 8s..12s] [--require-all] \
  [--mode hybrid|visual|text] [--top 10] --json
```

Without constraint flags, search keeps returning ranked two-second timeline segments. With named constraints or `--window`, it returns temporal evidence windows. The positional text query and `--visual-query` share the logical ID `query`; repeated named flags add logical IDs. Text and visual variants with the same ID are alternative retrieval evidence for that condition and do not each count as a separate required condition. `--require-all` filters out windows that do not contain a candidate for every ID. Windows must be between 8 and 12 seconds; named constraints default to 12 seconds.

Each hit contains `rank`, fused `score`, modality `match`, ordered `matched_constraints`, `start_ms`, `end_ms`, `timestamp_ms`, combined `subtitle`, up to three `frames`, and a `youtube_url` when available. `matched_constraints` reports retrieval candidates, not visually verified facts or a final identification. Open the frames and use `context` before treating a condition as observed.

## Context and timeline

```bash
open-video context <video-id|index-directory> \
  --at <HH:MM:SS.mmm|milliseconds> \
  [--before 6s] [--after 6s] [--frames 5] --json

open-video timeline <video-id|index-directory> \
  [--chunk 60s] [--cursor <token>] [--page-size 10] --json
```

`context` returns the complete subtitle text overlapping the requested window and evenly distributed original-media frames. `timeline` returns bounded chunks plus `next_cursor`; continue until it is null.

## Inspection and cache

```bash
open-video inspect <video-id|index-directory> --json
open-video cache list --json
open-video cache remove <video-id> --json
open-video cache prune --json
```

`cache remove` is explicit and destructive. `cache prune` only removes failed, interrupted, or corrupt entries; valid indexes and YouTube proxies remain cached.

## Error classes

Exit codes distinguish usage (`2`), dependencies (`10`), source acquisition (`20`), processing (`30`), and missing/corrupt indexes (`40`). With `--json`, errors are emitted to stderr as an `error.code` and `error.message` object.
