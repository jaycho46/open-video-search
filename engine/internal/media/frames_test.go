package media

import (
	"image"
	"image/color"
	"testing"
)

func TestImageMetricsDistinguishFlatColors(t *testing.T) {
	red := image.NewRGBA(image.Rect(0, 0, 18, 16))
	green := image.NewRGBA(image.Rect(0, 0, 18, 16))
	for y := 0; y < 16; y++ {
		for x := 0; x < 18; x++ {
			red.Set(x, y, color.RGBA{R: 255, A: 255})
			green.Set(x, y, color.RGBA{G: 128, A: 255})
		}
	}

	redHash, _, _, redMean, redGreen, redBlue := imageMetrics(red)
	greenHash, _, _, greenRed, greenMean, greenBlue := imageMetrics(green)
	if redHash != greenHash {
		t.Fatalf("flat colors should have the same difference hash")
	}
	distance := colorDistance(
		frameCandidate{meanRed: redMean, meanGreen: redGreen, meanBlue: redBlue},
		frameCandidate{meanRed: greenRed, meanGreen: greenMean, meanBlue: greenBlue},
	)
	if distance < 12 {
		t.Fatalf("expected colors to remain distinct, distance=%f", distance)
	}
}

func TestParseFrameTimes(t *testing.T) {
	times := parseFrameTimes("n:0 pts:10 pts_time:1.25 foo\nn:1 pts:20 pts_time:3")
	if len(times) != 2 || times[0] != 1.25 || times[1] != 3 {
		t.Fatalf("unexpected scene times: %#v", times)
	}
}

func TestSampledFrameTimestampPrefersFFmpegTime(t *testing.T) {
	times := []float64{1.25, 3.25}
	if timestamp := sampledFrameTimestamp(times, 1, 2000); timestamp != 3250 {
		t.Fatalf("expected ffmpeg timestamp, got %d", timestamp)
	}
	if timestamp := sampledFrameTimestamp(times, 2, 2000); timestamp != 4000 {
		t.Fatalf("expected fallback timestamp, got %d", timestamp)
	}
}

func TestDeduplicateFrameCandidatesKeepsCoverageAfterSceneCandidate(t *testing.T) {
	candidates := []frameCandidate{
		{timestampMS: 480000, source: "uniform"},
		{timestampMS: 482000, source: "uniform"},
		{timestampMS: 484000, source: "uniform"},
		{timestampMS: 486000, source: "uniform"},
		{timestampMS: 486753, source: "scene", hash: ^uint64(0), meanRed: 100},
		{timestampMS: 488000, source: "uniform", hash: ^uint64(0), meanRed: 100},
		{timestampMS: 490000, source: "uniform", hash: ^uint64(0), meanRed: 100},
		{timestampMS: 492000, source: "uniform", hash: ^uint64(0), meanRed: 100},
	}

	kept := deduplicateFrameCandidates(candidates)
	for index := 1; index < len(kept); index++ {
		if gap := kept[index].timestampMS - kept[index-1].timestampMS; gap > 4000 {
			t.Fatalf("expected frame coverage within 4000ms, got %d", gap)
		}
	}
	if last := kept[len(kept)-1].timestampMS; last != 492000 {
		t.Fatalf("expected final sample to remain, got %d", last)
	}
}
