import { copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.resolve(scriptDirectory, "..");
const repository = path.resolve(packageDirectory, "../..");
const packages = [
  packageDirectory,
  ...["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"].map((target) =>
    path.join(repository, "packages", `engine-${target}`),
  ),
];
for (const destination of packages) {
  await copyFile(path.join(repository, "LICENSE"), path.join(destination, "LICENSE"));
  await copyFile(
    path.join(repository, "THIRD_PARTY_NOTICES.md"),
    path.join(destination, "THIRD_PARTY_NOTICES.md"),
  );
}

