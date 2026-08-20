package media

import (
	"testing"

	"open-video/engine/internal/protocol"
)

func TestParseProbe(t *testing.T) {
	raw := []byte(`{
      "format": {"duration": "12.345", "format_name": "matroska", "tags": {"title": "Fixture"}},
      "streams": [
        {"codec_type": "video", "codec_name": "h264", "width": 1280, "height": 720},
        {"codec_type": "audio", "codec_name": "aac"},
        {"index": 3, "codec_type": "subtitle", "codec_name": "webvtt", "tags": {"language": "ko"}}
      ]
    }`)

	result, err := ParseProbe(raw, "/tmp/fixture.mkv")
	if err != nil {
		t.Fatalf("ParseProbe returned an error: %v", err)
	}
	if result.DurationMS != 12345 {
		t.Fatalf("expected 12345ms, got %d", result.DurationMS)
	}
	if result.Width != 1280 || result.Height != 720 || !result.HasAudio || !result.HasSubtitles {
		t.Fatalf("unexpected probe result: %+v", result)
	}
	if len(result.SubtitleTracks) != 1 || result.SubtitleTracks[0].Index != 3 || result.SubtitleTracks[0].Language != "ko" {
		t.Fatalf("unexpected subtitle tracks: %+v", result.SubtitleTracks)
	}
}

func TestChooseEmbeddedSubtitlePrefersRequestedLanguage(t *testing.T) {
	tracks := []protocol.SubtitleTrack{{Index: 2, Language: "en"}, {Index: 4, Language: "ko-KR"}}
	if chosen := chooseEmbeddedSubtitle(tracks, "ko"); chosen != 4 {
		t.Fatalf("expected Korean stream 4, got %d", chosen)
	}
}

func TestParseProbeRejectsMissingVideo(t *testing.T) {
	_, err := ParseProbe([]byte(`{"format":{"duration":"2"},"streams":[]}`), "fixture")
	if err == nil {
		t.Fatal("expected a missing video stream error")
	}
}
