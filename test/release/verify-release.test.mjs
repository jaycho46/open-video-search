import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseReleaseTag, verifyRelease } from "../../scripts/release/verify-release.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("the documented pnpm release verification command succeeds", async () => {
  const documentation = await readFile(path.join(repository, "docs/releasing.md"), "utf8");
  const command = /^pnpm release:verify (.+)$/mu.exec(documentation);
  assert.ok(command, "expected a release verification command in the release guide");
  const rootPackage = JSON.parse(await readFile(path.join(repository, "package.json"), "utf8"));
  const args = command[1].trim().split(/\s+/u);
  args[args.length - 1] = `v${rootPackage.version}`;
  execFileSync("pnpm", ["release:verify", ...args], { cwd: repository, stdio: "pipe" });
});

test("parses stable and prerelease tags", () => {
  assert.deepEqual(parseReleaseTag("v1.2.3"), { version: "1.2.3", npmTag: "latest" });
  assert.deepEqual(parseReleaseTag("v1.2.3-beta.1"), { version: "1.2.3-beta.1", npmTag: "next" });
});

test("rejects tags outside the release convention", () => {
  assert.throws(() => parseReleaseTag("1.2.3"), /must use the form/u);
  assert.throws(() => parseReleaseTag("v1.2"), /must use the form/u);
  assert.throws(() => parseReleaseTag("release-v1.2.3"), /must use the form/u);
});

test("accepts the repository's synchronized release metadata", async () => {
  const rootPackage = JSON.parse(await readFile(path.join(repository, "package.json"), "utf8"));
  const result = await verifyRelease(`v${rootPackage.version}`, repository);
  assert.equal(result.version, rootPackage.version);
  assert.equal(result.npmTag, rootPackage.version.includes("-") ? "next" : "latest");
  assert.deepEqual(
    result.packages.map((entry) => entry.name),
    [
      "open-video-engine-darwin-arm64",
      "open-video-engine-darwin-x64",
      "open-video-engine-linux-arm64",
      "open-video-engine-linux-x64",
      "open-video",
    ],
  );
});

for (const [version, npmTag] of [["1.2.3", "latest"], ["1.2.3-beta.1", "next"]]) {
  test(`accepts synchronized ${version} release metadata`, async (t) => {
    const fixture = await mkdtemp(path.join(tmpdir(), "open-video-release-test-"));
    t.after(() => rm(fixture, { recursive: true, force: true }));
    const files = {
      "package.json": JSON.stringify({ version }),
      "packages/cli/package.json": JSON.stringify({ name: "open-video", version }),
      "packages/cli/src/constants.ts": `export const CLI_VERSION = "${version}";`,
      "engine/internal/protocol/types.go": `const EngineVersion = "${version}"`,
      "release/asset-manifest.json": JSON.stringify({ cli_version: version, engine_version: version }),
    };
    for (const platform of ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"]) {
      files[`packages/engine-${platform}/package.json`] = JSON.stringify({
        name: `open-video-engine-${platform}`, version,
      });
    }
    for (const [relative, contents] of Object.entries(files)) {
      const target = path.join(fixture, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, contents);
    }
    const result = await verifyRelease(`v${version}`, fixture);
    assert.equal(result.version, version);
    assert.equal(result.npmTag, npmTag);
    assert.equal(result.packages.length, 5);
  });
}
