package media

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestValidateYouTubeURL(t *testing.T) {
	valid := []string{
		"https://www.youtube.com/watch?v=abc123",
		"https://youtu.be/abc123",
		"https://youtube.com/shorts/abc123",
	}
	for _, value := range valid {
		if err := ValidateYouTubeURL(value); err != nil {
			t.Fatalf("expected %s to be valid: %v", value, err)
		}
	}

	invalid := []string{
		"https://example.com/watch?v=abc123",
		"https://youtube.com/playlist?list=abc123",
		"https://youtube.com/watch?v=abc123&list=playlist",
	}
	for _, value := range invalid {
		if err := ValidateYouTubeURL(value); err == nil {
			t.Fatalf("expected %s to be rejected", value)
		}
	}
}

func TestChooseSubtitleLanguage(t *testing.T) {
	info := youtubeInfo{
		Language: "ko",
		Subtitles: map[string]json.RawMessage{
			"en": json.RawMessage(`[]`),
			"ko": json.RawMessage(`[]`),
		},
		AutomaticCaptions: map[string]json.RawMessage{
			"ja": json.RawMessage(`[]`),
		},
	}

	language, source := chooseSubtitleLanguage(info, "ko-KR")
	if language != "ko" || source != "manual" {
		t.Fatalf("expected ko manual subtitles, got %s %s", language, source)
	}
}

func TestChooseSubtitleLanguageDefaultsToEnglishBeforeArbitraryTranslation(t *testing.T) {
	info := youtubeInfo{
		Subtitles: map[string]json.RawMessage{
			"de": json.RawMessage(`[]`),
			"en": json.RawMessage(`[]`),
		},
	}
	language, source := chooseSubtitleLanguage(info, "")
	if language != "en" || source != "manual" {
		t.Fatalf("expected en manual subtitles, got %s %s", language, source)
	}
}

func TestYtDLPBaseArgsIsolateConfigurationAndRuntime(t *testing.T) {
	args := ytDLPBaseArgs("/opt/node")
	joined := strings.Join(args, " ")
	for _, expected := range []string{"--ignore-config", "--no-plugin-dirs", "--no-remote-components", "--no-js-runtimes", "--js-runtimes", "node:/opt/node"} {
		if !strings.Contains(joined, expected) {
			t.Fatalf("expected %s in %q", expected, joined)
		}
	}
}
