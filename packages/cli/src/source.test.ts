import { describe, expect, it } from "vitest";

import { resolveSource, youtubeVideoId } from "./source.js";

describe("YouTube source parsing", () => {
  it("accepts watch, short, and youtu.be URLs", () => {
    expect(youtubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoId("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoId("https://youtu.be/dQw4w9WgXcQ?t=3")).toBe("dQw4w9WgXcQ");
  });

  it("rejects playlists", () => {
    expect(() => youtubeVideoId("https://youtube.com/watch?v=dQw4w9WgXcQ&list=abc")).toThrow(/Playlist/u);
  });

  it("does not mistake an unsupported web URL for a local path", async () => {
    await expect(resolveSource("https://example.com/video.mp4")).rejects.toThrow(/only public YouTube/u);
  });
});
