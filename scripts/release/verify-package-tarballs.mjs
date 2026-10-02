import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const expectedPackages = [
  { name: "open-video-engine-darwin-arm64", os: "darwin", cpu: "arm64", engine: true },
  { name: "open-video-engine-darwin-x64", os: "darwin", cpu: "x64", engine: true },
  { name: "open-video-engine-linux-arm64", os: "linux", cpu: "arm64", engine: true },
  { name: "open-video-engine-linux-x64", os: "linux", cpu: "x64", engine: true },
  { name: "open-video", engine: false },
];

function runTar(args) {
  const result = spawnSync("tar", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `tar ${args.join(" ")} failed.`);
  }
  return result.stdout;
}

export function readPackageManifest(tarball) {
  return JSON.parse(runTar(["-xOzf", tarball, "package/package.json"]));
}

function listEntries(tarball) {
  return new Set(
    runTar(["-tzf", tarball])
      .split(/\r?\n/u)
      .filter(Boolean),
  );
}

function requireEntries(entries, tarball, required) {
  for (const entry of required) {
    if (!entries.has(entry)) throw new Error(`${path.basename(tarball)} is missing ${entry}.`);
  }
}

function verifyExecutableMode(tarball) {
  const listing = runTar(["-tvzf", tarball, "package/bin/open-video-engine"]);
  if (!/^-rwx/u.test(listing)) {
    throw new Error(`${path.basename(tarball)} does not preserve an executable engine binary.`);
  }
}

export async function verifyPackageTarballs(directory, version) {
  const files = (await readdir(directory)).filter((entry) => entry.endsWith(".tgz")).sort();
  const expectedFiles = expectedPackages.map(({ name }) => `${name}-${version}.tgz`).sort();
  if (JSON.stringify(files) !== JSON.stringify(expectedFiles)) {
    throw new Error(
      `Expected npm tarballs ${expectedFiles.join(", ")}, received ${files.join(", ") || "none"}.`,
    );
  }

  const packages = [];
  for (const expected of expectedPackages) {
    const tarball = path.join(directory, `${expected.name}-${version}.tgz`);
    const manifest = readPackageManifest(tarball);
    if (manifest.name !== expected.name || manifest.version !== version) {
      throw new Error(
        `${path.basename(tarball)} contains ${manifest.name}@${manifest.version}, expected ${expected.name}@${version}.`,
      );
    }

    const entries = listEntries(tarball);
    requireEntries(entries, tarball, [
      "package/package.json",
      "package/LICENSE",
      "package/THIRD_PARTY_NOTICES.md",
    ]);

    if (expected.engine) {
      if (manifest.os?.[0] !== expected.os || manifest.cpu?.[0] !== expected.cpu) {
        throw new Error(`${expected.name} has incorrect os/cpu package metadata.`);
      }
      requireEntries(entries, tarball, ["package/bin/open-video-engine"]);
      verifyExecutableMode(tarball);
    } else {
      requireEntries(entries, tarball, [
        "package/dist/cli.js",
        "package/dist/open-video-v1.schema.json",
        "package/README.md",
        "package/SECURITY.md",
      ]);
      if (manifest.bin?.["open-video"] !== "dist/cli.js") {
        throw new Error("open-video has an invalid CLI bin entry.");
      }
      for (const engine of expectedPackages.filter((entry) => entry.engine)) {
        if (manifest.optionalDependencies?.[engine.name] !== version) {
          throw new Error(
            `open-video must depend on ${engine.name}@${version}, received ${manifest.optionalDependencies?.[engine.name]}.`,
          );
        }
      }
    }

    packages.push({ name: manifest.name, version: manifest.version, tarball });
  }
  return packages;
}

async function main() {
  const [directory, version] = process.argv.slice(2);
  if (!directory || !version) {
    throw new Error(
      "Usage: node scripts/release/verify-package-tarballs.mjs <artifact-directory> <version>",
    );
  }
  const packages = await verifyPackageTarballs(path.resolve(directory), version);
  process.stdout.write(`${JSON.stringify({ packages }, null, 2)}\n`);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`package verification failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
