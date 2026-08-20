# `open-video/v1` public contract

`packages/cli/src/schemas.ts` is the source of truth. `pnpm build` emits [`schemas/open-video-v1.schema.json`](../schemas/open-video-v1.schema.json) and includes the same JSON Schema in the npm package as the `open-video/schema` export.

## Compatibility boundary

Stable public artifacts:

- `manifest.json`
- `timeline.jsonl`
- JSON responses from `index`, `doctor`, `search`, `context`, and `timeline`

Regenerable implementation details:

- `index/frames.jsonl`
- `index/vectors.f32`
- `index/text-index.json`
- `.state.json`
- `.contexts/`

All stored public timeline and frame paths are relative to the index directory. CLI responses resolve evidence frame paths to absolute paths. All JSON time fields are integer milliseconds. A YouTube search/context response includes a `t` deep link when the source has a canonical URL.

Search responses include the normalized constraint variants and every hit includes ordered `matched_constraints`. A normal search returns timeline segments. Named constraints or `window_ms` return an 8–12 second evidence window; `require_all` means every logical constraint ID has retrieval evidence inside that window. Text and visual variants sharing an ID are alternatives for coverage. These fields describe retrieval candidates only: they do not assert that a host has opened the frames or verified the depicted fact.

`manifest.fingerprint` covers the source identity, CLI/indexing version, language and explicit subtitle checksum, ASR choice, complete pinned model fingerprints, and sampling configuration. A complete matching index is reused; a mismatch is built in a sibling temporary directory and atomically replaces the old index only after validation.
