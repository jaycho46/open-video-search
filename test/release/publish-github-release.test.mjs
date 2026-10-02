import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { publishGitHubRelease } from "../../scripts/release/publish-github-release.mjs";

async function fixture(t, { tag = "v1.2.3", existing, fail, ignoreEdit = false, empty = false } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "open-video-github-release-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  if (!empty) {
    await writeFile(path.join(directory, "SHA256SUMS"), "test checksums");
    await writeFile(path.join(directory, "open-video.tgz"), "test artifact");
  }
  let state = existing ? { tagName: tag, ...existing } : undefined;
  const calls = [];
  const runGh = (args, options) => {
    calls.push(args);
    const operation = args[1];
    if (operation === fail) throw new Error(`simulated ${operation} failure`);
    assert.equal(args[0], "release");
    assert.equal(args[2], tag);
    if (operation === "view") {
      assert.deepEqual(args.slice(3), ["--json", "tagName,isDraft,isPrerelease"]);
      if (!state) {
        assert.equal(options.allowMissing, true);
        return undefined;
      }
      return JSON.stringify(state);
    }
    if (operation === "create") {
      state = { tagName: tag, isDraft: false, isPrerelease: args.includes("--prerelease=true") };
    } else if (operation === "edit" && !ignoreEdit) {
      state.isDraft = !args.includes("--draft=false");
      state.isPrerelease = args.includes("--prerelease=true");
    } else {
      assert.ok(operation === "upload" || operation === "edit");
    }
    return "";
  };
  return { directory, calls, publish: () => publishGitHubRelease(directory, tag, { runGh }) };
}

for (const [tag, prerelease] of [["v1.2.3", false]]) {
  test(`creates and verifies ${tag} with the correct release channel`, async (t) => {
    const { directory, calls, publish } = await fixture(t, { tag });
    assert.deepEqual(await publish(), { tagName: tag, isDraft: false, isPrerelease: prerelease });
    assert.deepEqual(calls.map((args) => args[1]), ["view", "create", "view"]);
    const create = calls[1];
    assert.equal(create.includes("--latest=false"), prerelease);
    assert.ok(create.includes("--verify-tag"));
    assert.ok(create.includes("--generate-notes"));
    assert.ok(create.includes(path.join(directory, "SHA256SUMS")));
    assert.ok(create.includes(path.join(directory, "open-video.tgz")));
  });

  test(`publishes a recovered ${tag} draft only after uploading assets`, async (t) => {
    const { calls, publish } = await fixture(t, {
      tag, existing: { isDraft: true, isPrerelease: false },
    });
    assert.deepEqual(await publish(), { tagName: tag, isDraft: false, isPrerelease: prerelease });
    assert.deepEqual(calls.map((args) => args[1]), ["view", "upload", "edit", "view"]);
    assert.ok(calls[1].includes("--clobber"));
    assert.ok(calls[2].includes("--draft=false"));
    assert.equal(calls[2].includes("--latest=false"), prerelease);
  });
}

test("does not re-promote an already published stable release on rerun", async (t) => {
  const { calls, publish } = await fixture(t, { existing: { isDraft: false, isPrerelease: false } });
  await publish();
  assert.deepEqual(calls.map((args) => args[1]), ["view", "upload", "view"]);
  assert.ok(calls.flat().every((arg) => !arg.startsWith("--latest")));
});

test("leaves a draft unpublished when asset upload fails", async (t) => {
  const { calls, publish } = await fixture(t, {
    existing: { isDraft: true, isPrerelease: false }, fail: "upload",
  });
  await assert.rejects(publish(), /simulated upload failure/u);
  assert.deepEqual(calls.map((args) => args[1]), ["view", "upload"]);
});

test("fails when GitHub refuses to publish the recovered draft", async (t) => {
  const { publish } = await fixture(t, {
    existing: { isDraft: true, isPrerelease: false }, fail: "edit",
  });
  await assert.rejects(publish(), /simulated edit failure/u);
});

test("rejects a successful command that leaves the release as a draft", async (t) => {
  const { publish } = await fixture(t, {
    existing: { isDraft: true, isPrerelease: false }, ignoreEdit: true,
  });
  await assert.rejects(publish(), /did not reach the expected published state/u);
});

test("does not create a release after an authentication or network lookup failure", async (t) => {
  const { calls, publish } = await fixture(t, { fail: "view" });
  await assert.rejects(publish(), /simulated view failure/u);
  assert.equal(calls.length, 1);
});

test("rejects an empty artifact bundle before calling GitHub", async (t) => {
  const { calls, publish } = await fixture(t, { empty: true });
  await assert.rejects(publish(), /release bundle is empty/u);
  assert.equal(calls.length, 0);
});
