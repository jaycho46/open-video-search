# Releasing Open Video

Open Video releases five npm packages at the same version:

- `open-video`
- `open-video-engine-darwin-arm64`
- `open-video-engine-darwin-x64`
- `open-video-engine-linux-arm64`
- `open-video-engine-linux-x64`

A pushed `v*` tag starts [the release workflow](../.github/workflows/release.yml). The workflow accepts only a semantic version tag whose version matches every package and runtime constant. The tagged commit must be contained in `main`.

## One-time repository and npm setup

The GitHub repository uses an `npm` deployment environment restricted to `v*` tags. Keep npm credentials in that environment, never as repository-wide secrets.

### Bootstrap the first npm release

npm trusted publishing can be connected only after a package exists. For the first release, create a short-lived granular npm access token with permission to publish the five public packages and add it to the GitHub `npm` environment:

```bash
gh secret set NPM_TOKEN \
  --repo jaycho46/open-video-search \
  --env npm
```

Do not put the token in a command argument, shell history, issue, pull request, or repository file. The command reads the value without committing it. The release workflow fails before publishing when a package is still unregistered and `NPM_TOKEN` is unavailable.

The npm account must have two-factor authentication enabled. Remove the bootstrap token after trusted publishing is configured.

### Move to npm trusted publishing

After all five packages exist on npm, configure a GitHub Actions trusted publisher for each package with the following values:

| Field | Value |
| --- | --- |
| Organization or user | `jaycho46` |
| Repository | `open-video-search` |
| Workflow | `release.yml` |
| Environment | `npm` |

The publish job grants only `id-token: write` and `contents: write`, installs npm `11.15.0`, and publishes provenance through GitHub OIDC. Once every package has a trusted publisher, remove the token:

```bash
gh secret delete NPM_TOKEN \
  --repo jaycho46/open-video-search \
  --env npm
```

## Prepare a release

Update the version in all of these locations:

- root `package.json`
- `packages/cli/package.json`
- each `packages/engine-*/package.json`
- `CLI_VERSION` in `packages/cli/src/constants.ts`
- `EngineVersion` in `engine/internal/protocol/types.go`

Then regenerate and validate the public contracts:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm check
pnpm release:verify v0.1.0
git diff -- schemas/open-video-v1.schema.json release/asset-manifest.json
```

Replace `v0.1.0` with the intended tag. Build before running checks so the generated release manifest reflects the new version. Review and commit generated contract changes with the version update. After committing, rebuild and run `git diff --exit-code -- schemas/open-video-v1.schema.json release/asset-manifest.json` to confirm reproducibility. Wait for the complete `CI` workflow on `main` to pass before tagging.

## Publish a release

Create an annotated tag on the verified `main` commit and push only that tag:

```bash
git switch main
git pull --ff-only origin main
git tag -a v0.1.0 -m "Open Video v0.1.0"
git push origin v0.1.0
```

Never move or force-push a release tag. Stable versions publish to npm's `latest` tag. Semantic prereleases such as `v0.2.0-beta.1` publish to `next` and are marked as prereleases, never Latest, on GitHub.

## What the workflow verifies

The release pipeline has four permission-separated stages:

1. **Verify** — checks the tag, all package/runtime versions, generated contracts, tests, build, and dependency audit.
2. **Build engines** — builds and executes the Go engine natively on macOS arm64, macOS x64, Linux arm64, and Linux x64 runners.
3. **Package** — creates the exact five npm tarballs, verifies their files and platform metadata, installs and audits the packed Linux release, and generates native archives, SHA-256 checksums, an asset manifest, the security policy, and an SPDX JSON SBOM of that exact packed install. The packed audit accepts only the exact reviewed upstream advisories documented in `SECURITY.md`; any new finding or transitive-version drift fails the release.
4. **Publish** — verifies the downloaded bundle, publishes engine packages before the CLI, then creates or repairs the GitHub Release.

Only the final `publish` job can request an npm OIDC token or write repository releases. Build and verification jobs have read-only repository access.

## Recover from a partial failure

npm versions are immutable. Never delete and republish a version or move its Git tag.

The publish script skips an exact package version that already exists, so rerunning the same GitHub Actions run can finish a release that stopped after publishing only some packages. The GitHub Release step also uploads missing assets or replaces incomplete assets when the release already exists. If an interrupted run left a draft, it publishes that draft only after all uploads succeed, then verifies the release is public and has the correct prerelease status.

If published contents are wrong, deprecate the affected version on npm, fix the repository, and publish a new patch version.
