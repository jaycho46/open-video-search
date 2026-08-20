# Open Video

Open Video is a local-first, open-source search engine for moments inside a video. It indexes one public YouTube video or local MP4/MOV/MKV/WebM file, then returns timestamped subtitles and original frames relevant to a natural-language query.

It deliberately stops at evidence retrieval. It does not call an LLM, identify products from a catalog, look up vehicle prices, upload media, run a service, or expose an MCP server. The included `$watch` Agent Skill teaches a host model how to inspect the returned evidence and answer responsibly.

> v0.1 is an early implementation. The public `manifest.json`, `timeline.jsonl`, and JSON command responses follow the `open-video/v1` contract; vector and text-index internals may be regenerated between releases.

## What it produces

```text
<index>/
├── manifest.json
├── timeline.jsonl
├── subtitles.vtt
├── frames/
└── index/
    ├── frames.jsonl
    ├── vectors.f32
    └── text-index.json
```

The TypeScript CLI owns the public schema, cache, local CLIP embeddings, CJK-aware subtitle search, and weighted reciprocal-rank fusion. A private Go executable invokes FFprobe, FFmpeg, and the pinned managed yt-dlp binary for media acquisition and extraction.

See the [`open-video/v1` compatibility boundary](docs/public-contract.md) and the [private engine JSONL protocol](docs/engine-protocol.md) for exact contracts.

## Requirements

- macOS or Linux on arm64 or x64
- Node.js 22.12 or newer; Node.js 24 LTS is the development baseline
- FFmpeg and FFprobe 6.1 or newer on `PATH`
- No API key

The first setup downloads a verified yt-dlp binary and a pinned quantized CLIP model into the platform cache. Whisper is downloaded only when explicitly requested. Set `OPEN_VIDEO_CACHE_DIR` to relocate all managed assets and indexes.

## Install

The intended public installation after the first release is:

```bash
npm install --global open-video
open-video setup
```

For a source checkout:

```bash
corepack enable
pnpm install
pnpm build
pnpm open-video doctor --json
```

`open-video setup --offline` performs no network access and succeeds only when every required managed asset is already present. Add `--asr` to install the optional Whisper model.

## Use

```bash
# Create or reuse an index.
open-video index "https://www.youtube.com/watch?v=VIDEO_ID" --language ko --json
open-video index ./movie.mkv --subtitles ./movie.ko.vtt --json

# Search subtitles and frames. Korean visual intent is best supplied in English to CLIP.
open-video search youtube-VIDEO_ID "흰 옷" \
  --visual-query "woman wearing a white dress" \
  --mode hybrid --top 10 --json

# Expand one candidate into evenly spaced original-media frames plus full local subtitles.
open-video context youtube-VIDEO_ID --at 00:13:24.500 --before 6s --after 6s --frames 5 --json

# Walk the whole video without overflowing an agent context window.
open-video timeline youtube-VIDEO_ID --chunk 60s --page-size 10 --json
```

Run `open-video --help` for the complete command surface. Human-readable output is the default. `--json` writes one stable result to stdout; progress and errors go to stderr. Times are always integer milliseconds in JSON, frame paths in responses are absolute, and YouTube hits include a deep link when possible.

## `$watch` Agent Skill

The reusable skill is in [`skills/watch`](skills/watch). Install that directory with an Agent Skills-compatible host and invoke it explicitly:

```text
$watch https://www.youtube.com/watch?v=VIDEO_ID 이 영상 내용을 요약해줘
$watch https://www.youtube.com/watch?v=VIDEO_ID 여주인공의 흰 옷은 어느 브랜드 제품이야?
$watch https://www.youtube.com/watch?v=VIDEO_ID 남자 주인공의 차 연식과 현재 시세를 알려줘
```

The skill requires the host to open returned frames before answering, label uncertain identifications, attach timestamps, and separate video observations from external web research. `/watch` is documented as a trigger phrase, but registering a host-specific slash-command UI is outside this repository.

## Retrieval pipeline

1. Hash the full local file or derive a stable YouTube video ID.
2. Obtain a maximum-720p YouTube proxy and the best requested/manual/automatic subtitles, or reference the original local file.
3. Combine two-second uniform samples with FFmpeg scene candidates above `0.4`.
4. Save long-edge-768 JPEGs and drop adjacent perceptual duplicates while keeping timeline gaps at four seconds or less.
5. Embed frames with pinned quantized CLIP; normalize subtitle text and add word plus CJK two/three-character tokens to MiniSearch.
6. Fuse the top 50 visual and text ranks with weighted RRF (`0.7` visual, `0.3` text).
7. Build the complete index in a sibling temporary directory and atomically replace only after validation.

## Privacy, access, and limits

- Media, frames, captions, vectors, and queries stay local. There is no telemetry or remote upload.
- Only public, single-video YouTube URLs are supported. Playlists, cookies, login, private or age-gated videos, and DRM bypass are not supported.
- v0.1 accepts one video up to two hours. OCR, face recognition, image queries, multi-video search, and search-result MP4 clips are intentionally absent.
- CLIP is English-centered. Use `--visual-query` with concise English descriptions for non-English questions.
- ASR is opt-in and does not translate speech.
- Process only content you are authorized to download or analyze.

See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) before redistributing binaries or model weights.

## Development

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm skill:validate
# With an authorized 12-video/60-query labelled dataset:
pnpm eval -- /absolute/path/to/dataset.json
```

The test suite includes Go parser/extraction tests, TypeScript ranking/token/schema tests, and a real FFmpeg + Go-engine integration test over a generated six-second video. Networked YouTube behavior remains a manual or scheduled test so pull requests are deterministic.

Capacity measurements and their limitations are recorded in [`docs/benchmarks.md`](docs/benchmarks.md). Search-quality release gates use the uncommitted authorized corpus described in [`eval/README.md`](eval/README.md).

## License

Open Video source code is licensed under Apache-2.0. Third-party tools and models retain their own terms.
