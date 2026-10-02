import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseReleaseTag } from "./verify-release.mjs";

const securityNote = "Security note: the packed npm install is gated to two reviewed upstream advisories with no compatible upstream fix. See the attached SECURITY.md and repository security policy for exact versions, scope, and mitigations.";

function gh(args, { allowMissing = false } = {}) {
  const result = spawnSync("gh", args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status === 0) return result.stdout.trim();
  // Authentication and network failures must not be mistaken for a missing release.
  if (allowMissing && result.stderr.trim() === "release not found") return undefined;
  throw new Error(result.stderr.trim() || `gh ${args.join(" ")} failed.`);
}

function readRelease(runGh, tag, allowMissing = false) {
  const output = runGh(
    ["release", "view", tag, "--json", "tagName,isDraft,isPrerelease"],
    { allowMissing },
  );
  if (output === undefined && allowMissing) return undefined;
  const release = JSON.parse(output);
  if (release.tagName !== tag || typeof release.isDraft !== "boolean" || typeof release.isPrerelease !== "boolean") {
    throw new Error(`GitHub returned invalid release metadata for ${tag}.`);
  }
  return release;
}

export async function publishGitHubRelease(directory, tag, { runGh = gh } = {}) {
  const { version } = parseReleaseTag(tag);
  const assets = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => path.resolve(directory, entry.name))
    .sort();
  if (assets.length === 0) throw new Error("The verified release bundle is empty.");

  const existing = readRelease(runGh, tag, true);
  if (existing) {
    runGh(["release", "upload", tag, ...assets, "--clobber"]);
    if (existing.isDraft) {
      // Do not expose a recovered draft until every asset upload succeeds.
      runGh(["release", "edit", tag, "--draft=false", "--verify-tag"]);
    }
  } else {
    runGh([
      "release", "create", tag, ...assets,
      "--verify-tag", "--generate-notes", "--title", `Open Video ${version}`,
      "--notes", securityNote,
    ]);
  }

  const release = readRelease(runGh, tag);
  if (release.isDraft) {
    throw new Error(`GitHub Release ${tag} did not reach the expected published state.`);
  }
  return release;
}

async function main() {
  const [directory, tag] = process.argv.slice(2);
  if (!directory || !tag) {
    throw new Error("Usage: node scripts/release/publish-github-release.mjs <artifact-directory> <v1.2.3>");
  }
  const release = await publishGitHubRelease(directory, tag);
  process.stdout.write(`${JSON.stringify(release, null, 2)}\n`);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`GitHub Release publication failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
