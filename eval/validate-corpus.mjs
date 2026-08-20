import path from "node:path";
import { fileURLToPath } from "node:url";

import { labelFingerprint, readCorpus, validateCorpus, verifyMediaFile } from "./corpus-v1/lib.mjs";

const args = process.argv.slice(2);
let corpusArgument;
for (let index = 0; index < args.length; index += 1) {
  const value = args[index];
  if (value === "--media-directory") {
    index += 1;
    continue;
  }
  if (!value.startsWith("--") && corpusArgument === undefined) corpusArgument = value;
}
const corpusPath = path.resolve(corpusArgument ?? fileURLToPath(new URL("./corpus-v1/corpus.json", import.meta.url)));
const mediaFlag = process.argv.indexOf("--media-directory");
const mediaDirectory = mediaFlag >= 0 ? process.argv[mediaFlag + 1] : undefined;
const printFingerprint = process.argv.includes("--print-fingerprint");
const corpus = await readCorpus(corpusPath);

if (printFingerprint) {
  process.stdout.write(`${labelFingerprint(corpus)}\n`);
  process.exit(0);
}

const result = validateCorpus(corpus, { verifyFingerprint: !process.argv.includes("--skip-fingerprint") });
if (mediaDirectory) {
  for (const video of corpus.videos) {
    await verifyMediaFile(path.resolve(mediaDirectory, video.filename), video);
  }
  result.verified_media = corpus.videos.length;
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
