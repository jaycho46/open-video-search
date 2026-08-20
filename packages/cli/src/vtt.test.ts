import { describe, expect, it } from "vitest";

import { captionsInWindow, formatVttTimestamp, parseTimestamp, parseVtt } from "./vtt.js";

describe("VTT", () => {
  it("parses and formats timestamps", () => {
    expect(parseTimestamp("01:02:03.456")).toBe(3_723_456);
    expect(parseTimestamp("02:03.500")).toBe(123_500);
    expect(formatVttTimestamp(3_723_456)).toBe("01:02:03.456");
  });

  it("normalizes tags and joins repeated adjacent captions", () => {
    const cues = parseVtt(`WEBVTT

00:00:00.000 --> 00:00:02.000 align:start
<c.yellow>Hello&nbsp; world</c>

00:00:02.100 --> 00:00:04.000
Hello world

00:00:04.000 --> 00:00:06.000
다음 장면
`);
    expect(cues).toEqual([
      { start_ms: 0, end_ms: 4_000, text: "Hello world" },
      { start_ms: 4_000, end_ms: 6_000, text: "다음 장면" },
    ]);
    expect(captionsInWindow(cues, 3_000, 5_000)).toBe("Hello world 다음 장면");
  });
});

