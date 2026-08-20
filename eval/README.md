# Search-quality evaluation

`corpus-v1/corpus.json` freezes a reproducible v0.1 evaluation corpus:

- 12 distinct public videos and 60 manually time-labelled queries;
- 8 development videos (40 queries) and 4 holdout videos (20 queries);
- per video: 2 subtitle, 2 visual, and 1 hybrid query;
- 24 subtitle, 24 visual, and 12 hybrid queries in total;
- Wikimedia Commons, Blender, and W3C source URLs, media SHA-256 values, attribution, and per-source licenses;
- a fingerprint over source hashes, splits, captions, and labels.

The two videos used while developing the `$watch` behavior tests are explicitly excluded by the corpus validator. They remain regression cases and cannot silently enter the quality benchmark.

Raw media, generated subtitles, frames, vectors, and indexes are not committed. The bilingual sidecar captions are human-authored scene descriptions for controlled text retrieval; they are not claimed to be speech transcripts. Corpus annotations use [CC0-1.0](corpus-v1/ANNOTATION_LICENSE.md). Downloaded media retains the license shown for its source entry.

## Validate the frozen labels

This deterministic check runs in `pnpm check` and performs no network access:

```bash
pnpm eval:validate
```

To also verify a previously downloaded media directory against every frozen byte count and SHA-256:

```bash
node eval/validate-corpus.mjs eval/corpus-v1/corpus.json \
  --media-directory /absolute/path/to/eval-workspace/media
```

## Prepare and run the development split

Build the CLI, download or reuse the eight development sources, generate VTT files, and create/reuse their indexes:

```bash
pnpm build
pnpm eval:prepare -- \
  --workspace /absolute/path/to/eval-workspace \
  --split development

pnpm eval -- /absolute/path/to/eval-workspace/dataset.development.json
```

Add `--offline` to `eval:prepare` when all source files and managed Open Video assets already exist locally. Every source file is accepted only after its frozen byte count and SHA-256 match.

## Holdout discipline

Do not use holdout results to change query wording, CLIP prompts, RRF weights, the 8–12 second window, sampling, or ranking code. Run it once for a release candidate. Both preparation and evaluation require an explicit acknowledgement:

```bash
pnpm eval:prepare -- \
  --workspace /absolute/path/to/eval-workspace \
  --split all \
  --acknowledge-holdout

pnpm eval -- \
  /absolute/path/to/eval-workspace/dataset.all.json \
  --acknowledge-holdout
```

Datasets containing holdout examples emit aggregate failure counts rather than query-level failures. The labels remain open for reproducibility, so this is a documented process boundary rather than a secrecy claim. Changing a frozen label changes `label_fingerprint` and must be reviewed as a corpus revision.

## Release thresholds

The full 12-video/60-query harness reports and enforces:

- visual/hybrid relevant-range Recall@10 of at least `0.80`;
- explicit subtitle-query Recall@5 of at least `0.95`;
- for every retrieved relevant hit, an evidence frame inside the labelled range or within two seconds of its boundary;
- no unintended frame gap above four seconds.

`dataset.example.json` remains a minimal template for a separate authorized corpus. The committed corpus is the reproducible v0.1 baseline; it is not large enough to establish broad real-world generalization on its own.

`corpus-v1/development-baseline.json` records the first untuned development run. The two missed visual queries are retained as measured failures; neither query labels nor production ranking were changed to make that run pass. The frozen holdout was not executed for that baseline.
