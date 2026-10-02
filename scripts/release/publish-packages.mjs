import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { expectedPackages, verifyPackageTarballs } from "./verify-package-tarballs.mjs";

function npm(args, { allowMissing = false, inherit = false } = {}) {
  const result = spawnSync("npm", args, {
    encoding: "utf8",
    stdio: inherit ? "inherit" : "pipe",
  });
  if (result.status === 0) return inherit ? "" : result.stdout.trim();
  const error = inherit ? "npm command failed" : `${result.stdout}\n${result.stderr}`.trim();
  if (allowMissing && /E404|404 Not Found/u.test(error)) return undefined;
  throw new Error(error || `npm ${args.join(" ")} failed.`);
}

function registryVersion(name, version) {
  const output = npm(["view", `${name}@${version}`, "version", "--json"], {
    allowMissing: true,
  });
  if (output === undefined) return undefined;
  return JSON.parse(output);
}

function packageExists(name) {
  return npm(["view", name, "name", "--json"], { allowMissing: true }) !== undefined;
}

export async function publishPackages(directory, version, npmTag) {
  if (!new Set(["latest", "next"]).has(npmTag)) {
    throw new Error(`Unsupported npm distribution tag '${npmTag}'.`);
  }

  const packages = await verifyPackageTarballs(directory, version);
  const byName = new Map(packages.map((entry) => [entry.name, entry]));
  const unpublishedNames = expectedPackages
    .map((entry) => entry.name)
    .filter((name) => !packageExists(name));

  if (unpublishedNames.length > 0 && !process.env.NPM_TOKEN) {
    throw new Error(
      `The initial npm publish requires the NPM_TOKEN environment secret. Packages not yet registered: ${unpublishedNames.join(", ")}.`,
    );
  }

  const published = [];
  const skipped = [];
  for (const expected of expectedPackages) {
    const entry = byName.get(expected.name);
    const existing = registryVersion(expected.name, version);
    if (existing === version) {
      process.stdout.write(`Skipping immutable existing package ${expected.name}@${version}.\n`);
      skipped.push(expected.name);
      continue;
    }

    process.stdout.write(`Publishing ${expected.name}@${version} with npm tag ${npmTag}.\n`);
    npm(
      ["publish", entry.tarball, "--access", "public", "--tag", npmTag, "--provenance"],
      { inherit: true },
    );
    const verified = registryVersion(expected.name, version);
    if (verified !== version) {
      throw new Error(`npm did not return ${expected.name}@${version} after publication.`);
    }
    published.push(expected.name);
  }
  return { published, skipped };
}

async function main() {
  const [directory, version, npmTag] = process.argv.slice(2);
  if (!directory || !version || !npmTag) {
    throw new Error(
      "Usage: node scripts/release/publish-packages.mjs <artifact-directory> <version> <latest|next>",
    );
  }
  const result = await publishPackages(path.resolve(directory), version, npmTag);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`npm publication failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
