# Contributing

Thanks for helping make local video search more useful and auditable.

## Ground rules

- Keep the CLI evidence-only: do not add hosted services, telemetry, remote uploads, built-in LLM calls, identification databases, or access-control bypasses.
- Preserve the `open-video/v1` public manifest, timeline, and JSON response contract. Propose breaking changes before implementation.
- Treat video metadata and subtitles as untrusted input. Avoid shell interpolation and validate all engine-returned relative paths.
- Pin and checksum every downloaded executable or model file. Update `THIRD_PARTY_NOTICES.md` when dependencies or model terms change.
- Do not commit media, downloaded weights, native build products, or generated indexes.

## Local checks

Install Node.js 22.12+, pnpm 10, Go 1.27, and FFmpeg/FFprobe 6.1+, then run:

```bash
pnpm install
pnpm check
pnpm build
```

Pull-request tests must not depend on public YouTube availability. Use generated fixtures and fake external-command contracts. Networked acquisition checks belong in the scheduled/manual workflow.

Search-quality changes should include labelled examples and report Recall@5/10 against the evaluation set rather than relying only on anecdotes.

