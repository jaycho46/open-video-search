# Benchmarks

## 2026-08-20 synthetic two-hour ceiling

This is a capacity check, not a search-quality result.

| Field | Result |
| --- | --- |
| Host | Apple M1 Max, 32 GiB, macOS 15.7.9 arm64 |
| Runtime | Node 22.22.3, Go toolchain 1.27.0, FFmpeg 7.0.1 |
| Input | 2:00:00 constant-color H.264, 320x180, 1 fps, no audio/subtitles |
| Extracted/embedded frames | 1,800 |
| Maximum timeline frame gap | 4,000 ms |
| Timeline entries | 3,600 |
| Cold index wall time | 34.57 s |
| Maximum resident set size | 627,425,280 bytes (598.36 MiB) |
| Generated index size | 11 MiB |
| Matching second index | 0.08 s, `reused: true` |

The constant image exercises the four-second anti-gap rule: perceptual deduplication discards adjacent two-second samples but must retain every other sample. It does not represent decode cost for high-motion 720p footage.

Representative Linux arm64/x64 measurements remain a release-note gate and should be captured from the release candidate with the [manual four-platform benchmark workflow](../.github/workflows/benchmark.yml) before v0.1 is published.
