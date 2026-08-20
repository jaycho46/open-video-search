import { describe, expect, it } from "vitest";

import { createTextIndex, loadTextIndex, searchTextIndex, serializeTextIndex, tokenizeSearchText } from "./text-index.js";

describe("text index", () => {
  it("adds CJK bigrams and trigrams while preserving words", () => {
    expect(tokenizeSearchText("흰색 원피스 Car")).toEqual(
      expect.arrayContaining(["흰색", "원피스", "원피", "피스", "원피스", "car"]),
    );
  });

  it("round-trips MiniSearch JSON with the custom tokenizer", () => {
    const index = createTextIndex([
      { start_ms: 0, end_ms: 2_000, subtitle: "빨간 자동차가 도착한다", scene_ids: [0], frames: [] },
      { start_ms: 2_000, end_ms: 4_000, subtitle: "white dress", scene_ids: [1], frames: [] },
    ]);
    const restored = loadTextIndex(serializeTextIndex(index));
    expect(searchTextIndex(restored, "자동차")[0]?.id).toBe("0");
    expect(searchTextIndex(restored, "white")[0]?.id).toBe("2000");
  });
});

