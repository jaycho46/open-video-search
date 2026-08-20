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
  [--mode hybrid|visual|text] [--top 10] --json
```

Each hit contains `rank`, fused `score`, `match`, `start_ms`, `end_ms`, `timestamp_ms`, `subtitle`, up to three `frames`, and a `youtube_url` when available. A hit is a retrieval candidate, not a final identification.

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

