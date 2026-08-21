import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseReleaseTag, verifyRelease } from "../../scripts/release/verify-release.mjs";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

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
  assert.equal(result.npmTag, "latest");
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
