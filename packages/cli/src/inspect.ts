import { directorySize } from "./files.js";
import { loadIndex } from "./index-store.js";

export async function inspectIndex(reference: string) {
  const index = await loadIndex(reference);
  return {
    index_directory: index.directory,
    size_bytes: await directorySize(index.directory),
    manifest: index.manifest,
  };
}

