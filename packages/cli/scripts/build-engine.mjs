import { chmod, copyFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.resolve(scriptDirectory, "..");
const repository = path.resolve(packageDirectory, "../..");
const output = path.join(packageDirectory, "vendor", "open-video-engine");
await mkdir(path.dirname(output), { recursive: true });
const result = spawnSync("go", ["build", "-trimpath", "-ldflags", "-s -w", "-o", output, "./cmd/open-video-engine"], {
  cwd: path.join(repository, "engine"),
  encoding: "utf8",
  stdio: "inherit",
});
if (result.status !== 0) process.exit(result.status ?? 1);
await chmod(output, 0o755);

const packageName = `engine-${process.platform}-${process.arch}`;
const platformPackage = path.join(repository, "packages", packageName);
await mkdir(path.join(platformPackage, "bin"), { recursive: true });
await copyFile(output, path.join(platformPackage, "bin", "open-video-engine"));
await chmod(path.join(platformPackage, "bin", "open-video-engine"), 0o755);

