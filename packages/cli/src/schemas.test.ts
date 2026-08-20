import { describe, expect, it } from "vitest";
import { toJSONSchema } from "zod";

import { SCHEMA_VERSION } from "./constants.js";
import { PublicSchema, SearchResponseSchema } from "./schemas.js";

describe("public schemas", () => {
  it("exports an open-video/v1 JSON Schema", () => {
    const schema = toJSONSchema(PublicSchema, { target: "draft-2020-12", unrepresentable: "any" });
    expect(schema.$schema).toContain("2020-12");
    expect(JSON.stringify(schema)).toContain(SCHEMA_VERSION);
  });

  it("rejects non-integer public timestamps", () => {
    expect(() =>
      SearchResponseSchema.parse({
        schema_version: SCHEMA_VERSION,
        video_id: "local-example",
        query: "car",
        mode: "text",
        hits: [{
          rank: 1,
          score: 1,
          match: ["text"],
          start_ms: 1.5,
          end_ms: 2_000,
          timestamp_ms: 0,
          subtitle: "car",
          frames: [],
        }],
      }),
    ).toThrow();
  });
});

