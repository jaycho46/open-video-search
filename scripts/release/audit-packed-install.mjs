import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function verifyPackedAuditReport(report) {
  if (report?.auditReportVersion !== 2) {
    throw new Error(`Unsupported npm audit report version ${report?.auditReportVersion}.`);
  }
  if (report.error) throw new Error("npm audit returned an error report.");
  const vulnerabilities = report.vulnerabilities;
  if (!vulnerabilities || typeof vulnerabilities !== "object" || Array.isArray(vulnerabilities)) {
    throw new Error("npm audit did not return a vulnerability map.");
  }
  const counts = report.metadata?.vulnerabilities;
  for (const severity of ["info", "low", "moderate", "high", "critical", "total"]) {
    if (!Number.isSafeInteger(counts?.[severity]) || counts[severity] < 0) {
      throw new Error(`npm audit did not return a valid ${severity} vulnerability count.`);
    }
  }
  const names = Object.keys(vulnerabilities).sort();
  if (names.length > 0 || Object.values(counts).some((count) => count !== 0)) {
    throw new Error(`Packed install contains vulnerabilities: ${names.join(", ") || "see audit counts"}. No advisory exceptions are permitted.`);
  }
  return { status: "clean", advisories: [] };
}

export async function auditPackedInstall(directory) {
  const result = spawnSync("npm", ["audit", "--omit=dev", "--json"], {
    cwd: directory,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (![0, 1].includes(result.status)) {
    throw new Error(result.stderr.trim() || `npm audit exited with status ${result.status}.`);
  }

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`npm audit did not return JSON: ${result.stdout.trim() || result.stderr.trim()}`);
  }

  const verified = verifyPackedAuditReport(report);
  if (result.status !== 0) throw new Error("npm audit exited unsuccessfully despite a clean report.");
  return verified;
}

async function main() {
  const [directory] = process.argv.slice(2);
  if (!directory) {
    throw new Error("Usage: node scripts/release/audit-packed-install.mjs <installed-project-directory>");
  }
  const result = await auditPackedInstall(path.resolve(directory));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`packed-install audit failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
