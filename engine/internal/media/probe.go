package media

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"

	"open-video/engine/internal/protocol"
)

type ffprobeOutput struct {
	Format struct {
		Duration   string            `json:"duration"`
		FormatName string            `json:"format_name"`
		Tags       map[string]string `json:"tags"`
	} `json:"format"`
	Streams []struct {
		Index     int               `json:"index"`
		CodecType string            `json:"codec_type"`
		CodecName string            `json:"codec_name"`
		Width     int               `json:"width"`
		Height    int               `json:"height"`
		Duration  string            `json:"duration"`
		Tags      map[string]string `json:"tags"`
	} `json:"streams"`
}

// Probe reads normalized media metadata with ffprobe.
func Probe(ctx context.Context, runner Runner, ffprobePath, mediaPath string) (protocol.ProbeResult, error) {
	stdout, _, err := runner.Run(ctx, ffprobePath,
		"-v", "error",
		"-show_format",
		"-show_streams",
		"-of", "json",
		mediaPath,
	)
	if err != nil {
		return protocol.ProbeResult{}, err
	}
	return ParseProbe(stdout, mediaPath)
}

// ParseProbe converts ffprobe JSON into the engine's stable probe contract.
func ParseProbe(raw []byte, mediaPath string) (protocol.ProbeResult, error) {
	var parsed ffprobeOutput
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return protocol.ProbeResult{}, fmt.Errorf("decode ffprobe output: %w", err)
	}

	durationSeconds := parseSeconds(parsed.Format.Duration)
	result := protocol.ProbeResult{
		Path:       mediaPath,
		FormatName: parsed.Format.FormatName,
		Title:      parsed.Format.Tags["title"],
	}

	for _, stream := range parsed.Streams {
		streamDuration := parseSeconds(stream.Duration)
		if streamDuration > durationSeconds {
			durationSeconds = streamDuration
		}
		switch stream.CodecType {
		case "video":
			if result.VideoCodec == "" {
				result.VideoCodec = stream.CodecName
				result.Width = stream.Width
				result.Height = stream.Height
			}
		case "audio":
			result.HasAudio = true
			if result.AudioCodec == "" {
				result.AudioCodec = stream.CodecName
			}
		case "subtitle":
			result.HasSubtitles = true
			result.SubtitleStreams++
			result.SubtitleTracks = append(result.SubtitleTracks, protocol.SubtitleTrack{
				Index: stream.Index, Language: stream.Tags["language"],
			})
		}
	}

	result.DurationMS = int64(math.Round(durationSeconds * 1000))
	if result.DurationMS <= 0 || result.VideoCodec == "" {
		return protocol.ProbeResult{}, fmt.Errorf("input has no readable video stream or duration")
	}
	return result, nil
}

func parseSeconds(value string) float64 {
	seconds, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil {
		return 0
	}
	return seconds
}
