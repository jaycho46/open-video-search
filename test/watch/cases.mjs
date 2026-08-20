export const WATCH_BEHAVIOR_CASES = [
  {
    id: "zass-restaurant-name",
    source: "https://www.youtube.com/watch?v=Djiel71Ioic",
    video_id: "youtube-Djiel71Ioic",
    question: "이 영상에서 아저씨가 포지타노에서 방문한 레스토랑 이름이 뭐야?",
    ground_truth_ms: [500_000, 524_000],
    expected_outcome: "match",
    review_note: "The frame at 518000ms visibly shows the Zass information card.",
    anchors: [
      {
        id: "restaurant-event",
        args: ["search", "youtube-Djiel71Ioic", "포지타노 레스토랑 식당", "--mode", "text", "--top", "10", "--json"],
        hits: [510_000, 512_000, 720_000, 718_000, 722_000, 36_000, 30_000, 32_000, 514_000, 38_000].map(
          (timestamp_ms, index) => ({
            timestamp_ms,
            rank: index + 1,
            verified: [510_000, 512_000, 514_000].includes(timestamp_ms),
          }),
        ),
      },
      {
        id: "restaurant-name-card",
        args: [
          "search",
          "youtube-Djiel71Ioic",
          "레스토랑 이름",
          "--visual-query",
          "restaurant information card showing its name at a luxury hotel terrace",
          "--mode",
          "visual",
          "--top",
          "10",
          "--json",
        ],
        hits: [108_000, 164_000, 454_000, 542_000, 684_000, 166_000, 496_000, 680_000, 546_000, 518_000].map(
          (timestamp_ms, index) => ({ timestamp_ms, rank: index + 1, verified: timestamp_ms === 518_000 }),
        ),
      },
    ],
  },
  {
    id: "fried-food-sunglasses",
    source: "https://www.youtube.com/watch?v=JS87kxzpHzg",
    video_id: "youtube-JS87kxzpHzg",
    question: "강민경이 오징어튀김 먹을 때 쓰고 있던 선글라스의 근거 장면을 찾아줘",
    ground_truth_ms: [720_000, 750_000],
    reject_timestamp_ms: 152_000,
    expected_outcome: "insufficient",
    review_note: "Frames at 740000ms and 742116ms show a white cap and no sunglasses.",
    anchors: [
      {
        id: "fried-food-event",
        args: ["search", "youtube-JS87kxzpHzg", "오징어 튀김", "--mode", "text", "--top", "10", "--json"],
        hits: [890_000, 892_000, 726_000, 728_000].map((timestamp_ms, index) => ({
          timestamp_ms,
          rank: index + 1,
          verified: [726_000, 728_000].includes(timestamp_ms),
        })),
      },
      {
        id: "sunglasses-attribute",
        args: [
          "search",
          "youtube-JS87kxzpHzg",
          "선글라스",
          "--visual-query",
          "woman wearing dark narrow oval sunglasses at a restaurant",
          "--mode",
          "visual",
          "--top",
          "10",
          "--json",
        ],
        hits: [158_000, 854_000, 742_116, 92_000, 152_000, 98_000, 740_000, 150_000, 916_000, 154_000].map(
          (timestamp_ms, index) => ({
            timestamp_ms,
            rank: index + 1,
            verified: [158_000, 152_000, 150_000, 154_000].includes(timestamp_ms),
          }),
        ),
      },
    ],
  },
];
