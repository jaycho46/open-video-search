import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toJSONSchema } from "zod";

import { PublicSchema } from "../dist/schemas.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.resolve(scriptDirectory, "..");
const repository = path.resolve(packageDirectory, "../..");
const schema = toJSONSchema(PublicSchema, {
  target: "draft-2020-12",
  unrepresentable: "any",
});
schema.$id = "https://open-video.dev/schema/open-video-v1.schema.json";
schema.title = "Open Video v1 public data contract";
const content = `${JSON.stringify(schema, null, 2)}\n`;
await mkdir(path.join(repository, "schemas"), { recursive: true });
await writeFile(path.join(repository, "schemas", "open-video-v1.schema.json"), content, "utf8");
await writeFile(path.join(packageDirectory, "dist", "open-video-v1.schema.json"), content, "utf8");

