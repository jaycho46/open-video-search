# Security policy

Report suspected vulnerabilities through [GitHub private vulnerability reporting](https://github.com/jaycho46/open-video-search/security/advisories/new). Do not open a public issue containing exploit details, vulnerable media, tokens, private paths, or other sensitive evidence. Include affected versions, reproduction steps, impact, and any suggested mitigation in the private report.

Open Video is a local CLI, not a network service. It does not accept remote requests, upload media, load cookies, or execute video metadata/subtitles. Nevertheless, videos and indexes are untrusted input and should be processed with current dependencies on a non-privileged account.

## Dependency audit policy

CI runs `pnpm audit --prod --audit-level high`. The workspace currently overrides two transitive packages to patched versions:

- `sharp` `0.35.5`, within Transformers.js 4.3.0's `^0.35.4` request;
- `adm-zip` `0.6.1`, within ONNX Runtime Node 1.30.0's `^0.6.0` request.

Sharp decodes the frames used by Transformers.js. `adm-zip` is used by ONNX Runtime's package installation path and Open Video never accepts ZIP input.

npm only applies `overrides` from the installation project's root; workspace overrides do not protect downstream installations. The published CLI therefore requires Transformers.js 4.3.x, whose upstream dependency ranges allow the patched Sharp and adm-zip releases. Both PR CI and the release workflow separately install the exact CLI and engine tarballs in a clean npm project without overrides and audit that resolved dependency tree. Existing installations should refresh their lockfile and audit their own resolved dependencies.

The packed-install release audit requires zero reported vulnerabilities at every severity. There are no advisory exceptions, including the previously allowed `GHSA-f88m-g3jw-g9cj` and `GHSA-xcpc-8h2w-3j85`. An unavailable, malformed, or failing audit blocks publication. The policy is shipped beside an SBOM of the exact packed install and summarized in every GitHub Release. Audits describe the advisories known at release time, not a guarantee against future vulnerabilities.

## Model and executable integrity

- Every downloaded model file is pinned by repository revision and SHA-256.
- Every managed yt-dlp platform asset is pinned by release and SHA-256.
- yt-dlp ignores ambient configuration, cookies, plugins, remote components, and default JavaScript runtimes; the CLI supplies its own Node executable solely for public YouTube extraction.
- FFmpeg is a system dependency. Users must keep their selected build patched and review whether it is LGPL or GPL configured.
