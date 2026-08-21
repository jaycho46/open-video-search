import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const allowedAdvisories = [
  "https://github.com/advisories/GHSA-f88m-g3jw-g9cj",
  "https://github.com/advisories/GHSA-xcpc-8h2w-3j85",
];

const allowedVulnerabilities = [
  "@huggingface/transformers",
  "adm-zip",
  "onnxruntime-node",
  "open-video",
  "sharp",
];

const allowedVersions = {
  "@huggingface/transformers": "4.2.0",
  "adm-zip": "0.5.18",
  "onnxruntime-node": "1.24.3",
  sharp: "0.34.5",
};

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function requireEqual(label, actual, expected) {
  if (JSON.stringify(sorted(actual)) !== JSON.stringify(sorted(expected))) {
    throw new Error(
      `${label} changed: expected ${expected.join(", ")}, received ${actual.join(", ") || "none"}.`,
    );
  }
}

export function verifyPackedAuditReport(report, installedVersions = allowedVersions) {
  if (report.auditReportVersion !== 2) {
    throw new Error(`Unsupported npm audit report version ${report.auditReportVersion}.`);
  }

  const vulnerabilities = report.vulnerabilities ?? {};
  const names = Object.keys(vulnerabilities);
  if (names.length === 0) return { status: "clean", advisories: [] };

  requireEqual("Packed-install vulnerability set", names, allowedVulnerabilities);

  const advisories = [];
  for (const vulnerability of Object.values(vulnerabilities)) {
    if (vulnerability.severity !== "high") {
      throw new Error(`${vulnerability.name} changed severity to ${vulnerability.severity}.`);
    }
    for (const cause of vulnerability.via ?? []) {
      if (typeof cause === "object" && cause.url) advisories.push(cause.url);
    }
  }
  requireEqual("Packed-install advisory set", advisories, allowedAdvisories);

  if ((report.metadata?.vulnerabilities?.critical ?? 0) !== 0) {
    throw new Error("Packed install contains a critical vulnerability.");
  }

  for (const [name, expectedVersion] of Object.entries(allowedVersions)) {
    if (installedVersions[name] !== expectedVersion) {
      throw new Error(
        `${name} changed from the reviewed ${expectedVersion} to ${installedVersions[name] ?? "missing"}.`,
      );
    }
  }

  return { status: "bounded_exception", advisories: sorted(advisories) };
}

async function installedVersions(directory) {
  const versions = {};
  for (const name of Object.keys(allowedVersions)) {
    const manifest = JSON.parse(
      await readFile(path.join(directory, "node_modules", name, "package.json"), "utf8"),
    );
    versions[name] = manifest.version;
  }
  return versions;
}

export async function auditPackedInstall(directory) {
  const result = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
    cwd: directory,
    encoding: "utf8",
  });
  if (![0, 1].includes(result.status)) {
    throw new Error(result.stderr.trim() || `npm audit exited with status ${result.status}.`);
  }

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`npm audit did not return JSON: ${result.stdout.trim() || result.stderr.trim()}`);
  }

  return verifyPackedAuditReport(report, await installedVersions(directory));
}

async function main() {
  const [directory] = process.argv.slice(2);
  if (!directory) {
    throw new Error("Usage: node scripts/release/audit-packed-install.mjs <installed-project-directory>");
  }
  const result = await auditPackedInstall(path.resolve(directory));
  if (result.status === "bounded_exception") {
    process.stderr.write(
      `Packed install contains only the reviewed upstream advisories: ${result.advisories.join(", ")}\n`,
    );
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`packed-install audit failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
