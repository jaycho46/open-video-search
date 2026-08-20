# Security policy

Report suspected vulnerabilities privately to the maintainers of the eventual public repository rather than opening an exploit-details issue. No public security contact exists until that repository is created; do not publish v0.1 without adding one here.

Open Video is a local CLI, not a network service. It does not accept remote requests, upload media, load cookies, or execute video metadata/subtitles. Nevertheless, videos and indexes are untrusted input and should be processed with current dependencies on a non-privileged account.

## Dependency audit policy

CI runs `pnpm audit --prod --audit-level high`. The workspace currently overrides two transitive packages to patched versions:

- `sharp` `0.35.3`, replacing Transformers.js 4.2.0's `^0.34.5` request;
- `adm-zip` `0.6.0`, replacing ONNX Runtime Node 1.24.3's `^0.5.16` request.

The patched Sharp basic JPEG-to-raw API used by Transformers.js has been exercised by real CLIP indexing/search tests. `adm-zip` is used by ONNX Runtime's package installation path and Open Video never accepts ZIP input.

npm only applies `overrides` from the installation project's root. As a result, an npm project that installs the packed CLI as a dependency can still resolve `sharp@0.34.5` and `adm-zip@0.5.18` until the upstream dependency ranges are widened, and npm audit will report the corresponding 2026 high-severity advisories. Release maintainers must re-check the packed install, update Transformers.js/ONNX Runtime as soon as compatible patched ranges are published, and describe any remaining bounded exception in release notes and the SBOM. Do not silently add new exceptions.

## Model and executable integrity

- Every downloaded model file is pinned by repository revision and SHA-256.
- Every managed yt-dlp platform asset is pinned by release and SHA-256.
- yt-dlp ignores ambient configuration, cookies, plugins, remote components, and default JavaScript runtimes; the CLI supplies its own Node executable solely for public YouTube extraction.
- FFmpeg is a system dependency. Users must keep their selected build patched and review whether it is LGPL or GPL configured.

