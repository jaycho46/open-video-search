import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRepository = path.resolve(scriptDirectory, "../..");

const packageDirectories = [
  "packages/engine-darwin-arm64",
  "packages/engine-darwin-x64",
  "packages/engine-linux-arm64",
  "packages/engine-linux-x64",
  "packages/cli",
];

export function parseReleaseTag(tag) {
  const match = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?)$/u.exec(tag);
  if (!match) {
    throw new Error(`Release tag '${tag}' must use the form v1.2.3 or v1.2.3-beta.1.`);
  }
  return {
    version: match[1],
    npmTag: match[1].includes("-") ? "next" : "latest",
  };
}

async function readJson(target) {
  return JSON.parse(await readFile(target, "utf8"));
}

function sourceVersion(source, expression, label) {
  const match = expression.exec(source);
  if (!match) throw new Error(`Unable to read ${label}.`);
  return match[1];
}

function assertVersion(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} is ${actual}, but the release tag requires ${expected}.`);
  }
}

export async function verifyRelease(tag, repository = defaultRepository) {
  const { version, npmTag } = parseReleaseTag(tag);
  const packageMetadata = [];

  const rootPackage = await readJson(path.join(repository, "package.json"));
  assertVersion(rootPackage.version, version, "root package version");

  for (const directory of packageDirectories) {
    const manifest = await readJson(path.join(repository, directory, "package.json"));
    assertVersion(manifest.version, version, `${manifest.name} package version`);
    packageMetadata.push({ name: manifest.name, directory, version: manifest.version });
  }

  const constants = await readFile(path.join(repository, "packages/cli/src/constants.ts"), "utf8");
  assertVersion(
    sourceVersion(constants, /CLI_VERSION\s*=\s*"([^"]+)"/u, "CLI_VERSION"),
    version,
    "CLI_VERSION",
  );

  const engineTypes = await readFile(path.join(repository, "engine/internal/protocol/types.go"), "utf8");
  assertVersion(
    sourceVersion(engineTypes, /EngineVersion\s*=\s*"([^"]+)"/u, "EngineVersion"),
    version,
    "Go EngineVersion",
  );

  const releaseManifest = await readJson(path.join(repository, "release/asset-manifest.json"));
  assertVersion(releaseManifest.cli_version, version, "release manifest CLI version");
  assertVersion(releaseManifest.engine_version, version, "release manifest engine version");

  return { version, npmTag, packages: packageMetadata };
}

async function main() {
  const tag = process.argv[2];
  if (!tag) throw new Error("Usage: node scripts/release/verify-release.mjs <v1.2.3>");
  const result = await verifyRelease(tag);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `version=${result.version}\nnpm_tag=${result.npmTag}\n`,
      "utf8",
    );
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`release verification failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
