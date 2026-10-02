import assert from "node:assert/strict";
import test from "node:test";

import { verifyPackedAuditReport } from "../../scripts/release/audit-packed-install.mjs";

function cleanReport() {
  return {
    auditReportVersion: 2,
    vulnerabilities: {},
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
  };
}

test("accepts a complete clean packed-install audit", () => {
  assert.deepEqual(verifyPackedAuditReport(cleanReport()), { status: "clean", advisories: [] });
});

for (const severity of ["low", "moderate", "high", "critical"]) {
  test(`rejects ${severity} vulnerabilities without advisory exceptions`, () => {
    const report = cleanReport();
    report.vulnerabilities.sharp = {
      name: "sharp", severity,
      via: [{ url: "https://github.com/advisories/GHSA-f88m-g3jw-g9cj" }],
    };
    report.metadata.vulnerabilities[severity] = 1;
    report.metadata.vulnerabilities.total = 1;
    assert.throws(() => verifyPackedAuditReport(report), /No advisory exceptions are permitted/u);
  });
}

test("rejects nonzero counts even if the vulnerability map is empty", () => {
  const report = cleanReport();
  report.metadata.vulnerabilities.high = 1;
  assert.throws(() => verifyPackedAuditReport(report), /contains vulnerabilities/u);
});

test("rejects listed vulnerabilities even if the counts are zero", () => {
  const report = cleanReport();
  report.vulnerabilities["adm-zip"] = { name: "adm-zip", severity: "high" };
  assert.throws(() => verifyPackedAuditReport(report), /contains vulnerabilities/u);
});

test("rejects missing or malformed audit fields instead of treating them as clean", () => {
  for (const report of [null, {}, { ...cleanReport(), auditReportVersion: 1 }]) {
    assert.throws(() => verifyPackedAuditReport(report), /Unsupported npm audit report/u);
  }
  for (const vulnerabilities of [undefined, null, [], ""]) {
    assert.throws(() => verifyPackedAuditReport({ ...cleanReport(), vulnerabilities }), /vulnerability map/u);
  }
  assert.throws(() => verifyPackedAuditReport({ ...cleanReport(), metadata: {} }), /vulnerability count/u);
  for (const count of [-1, "0", 0.5, undefined]) {
    const report = cleanReport();
    report.metadata.vulnerabilities.total = count;
    assert.throws(() => verifyPackedAuditReport(report), /valid total vulnerability count/u);
  }
  assert.throws(() => verifyPackedAuditReport({ ...cleanReport(), error: { code: "E503" } }), /error report/u);
});
