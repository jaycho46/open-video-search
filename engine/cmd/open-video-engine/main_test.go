package main

import "testing"

func TestSupportsFFmpeg(t *testing.T) {
	valid := []string{
		"ffmpeg version 6.1 Copyright",
		"ffmpeg version n6.1.2-static build",
		"ffmpeg version 7.0.1 Copyright",
	}
	for _, value := range valid {
		if !supportsFFmpeg(value) {
			t.Fatalf("expected supported version: %s", value)
		}
	}
	invalid := []string{"ffmpeg version 6.0", "ffmpeg version 5.1", "unknown"}
	for _, value := range invalid {
		if supportsFFmpeg(value) {
			t.Fatalf("expected unsupported version: %s", value)
		}
	}
}
