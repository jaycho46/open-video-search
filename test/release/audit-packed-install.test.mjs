import assert from "node:assert/strict";
import test from "node:test";

import { verifyPackedAuditReport } from "../../scripts/release/audit-packed-install.mjs";

const reviewedVersions = {
  "@huggingface/transformers": "4.2.0",
  "adm-zip": "0.5.18",
  "onnxruntime-node": "1.24.3",
  sharp: "0.34.5",
};

function reviewedReport() {
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      "@huggingface/transformers": {
        name: "@huggingface/transformers",
        severity: "high",
        via: ["onnxruntime-node", "sharp"],
      },
      "adm-zip": {
        name: "adm-zip",
        severity: "high",
        via: [{ url: "https://github.com/advisories/GHSA-xcpc-8h2w-3j85" }],
      },
      "onnxruntime-node": { name: "onnxruntime-node", severity: "high", via: ["adm-zip"] },
      "open-video": {
        name: "open-video",
        severity: "high",
        via: ["@huggingface/transformers"],
      },
      sharp: {
        name: "sharp",
        severity: "high",
        via: [{ url: "https://github.com/advisories/GHSA-f88m-g3jw-g9cj" }],
      },
    },
    metadata: { vulnerabilities: { critical: 0 } },
  };
}

test("accepts only the reviewed packed-install advisories", () => {
  assert.deepEqual(verifyPackedAuditReport(reviewedReport(), reviewedVersions), {
    status: "bounded_exception",
    advisories: [
      "https://github.com/advisories/GHSA-f88m-g3jw-g9cj",
      "https://github.com/advisories/GHSA-xcpc-8h2w-3j85",
    ],
  });
});

test("accepts a clean packed install", () => {
  assert.deepEqual(
    verifyPackedAuditReport({ auditReportVersion: 2, vulnerabilities: {} }, reviewedVersions),
    { status: "clean", advisories: [] },
  );
});

test("rejects a new advisory even when it affects a reviewed package", () => {
  const report = reviewedReport();
  report.vulnerabilities.sharp.via.push({
    url: "https://github.com/advisories/GHSA-new-advisory",
  });
  assert.throws(
    () => verifyPackedAuditReport(report, reviewedVersions),
    /Packed-install advisory set changed/u,
  );
});

test("rejects an unreviewed transitive version", () => {
  assert.throws(
    () =>
      verifyPackedAuditReport(reviewedReport(), {
        ...reviewedVersions,
        sharp: "0.34.6",
      }),
    /sharp changed from the reviewed 0\.34\.5/u,
  );
});
