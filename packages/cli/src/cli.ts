#!/usr/bin/env node

import { runCli } from "./commands.js";
import { asOpenVideoError } from "./errors.js";

runCli().catch((error: unknown) => {
  const openVideoError = asOpenVideoError(error);
  const json = process.argv.includes("--json");
  if (json) {
    process.stderr.write(
      `${JSON.stringify({ error: { code: openVideoError.kind, message: openVideoError.message } })}\n`,
    );
  } else {
    process.stderr.write(`open-video: ${openVideoError.message}\n`);
  }
  process.exitCode = openVideoError.exitCode;
});

