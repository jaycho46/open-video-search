import { describe, expect, it } from "vitest";

import { parseMilliseconds } from "./time.js";

describe("parseMilliseconds", () => {
  it("accepts integer milliseconds, durations, and timestamps", () => {
    expect(parseMilliseconds("1500")).toBe(1_500);
    expect(parseMilliseconds("6s")).toBe(6_000);
    expect(parseMilliseconds("1.5m")).toBe(90_000);
    expect(parseMilliseconds("01:02:03.250")).toBe(3_723_250);
  });
});

