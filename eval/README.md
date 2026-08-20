# Search-quality evaluation

The v0.1 release gate requires at least 12 authorized videos and 60 labelled visual, subtitle, and hybrid queries. Media and generated indexes are intentionally not committed.

Create a JSON file following `dataset.example.json`, index each source with the release candidate, and run:

```bash
pnpm build
pnpm eval -- /absolute/path/to/dataset.json
```

The harness reports:

- visual/hybrid relevant-range Recall@10, threshold `0.80`;
- explicit subtitle-query Recall@5, threshold `0.95`;
- whether a returned evidence frame is inside the labelled range or within two seconds of its boundary;
- whether any index has an unintended frame gap above four seconds.

It exits non-zero when the dataset is too small or a threshold fails. Keep raw media and indexes out of Git; publish only aggregate metrics and representative hardware/runtime details in release notes.

