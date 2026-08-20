package media

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"open-video/engine/internal/protocol"
)

// ExtractContextFrames creates evenly spaced evidence frames around a timestamp.
func ExtractContextFrames(ctx context.Context, runner Runner, ffmpegPath, mediaPath, outputDirectory string, atMS, beforeMS, afterMS, durationMS int64, count int) ([]protocol.Frame, error) {
	if count < 1 || count > 20 {
		return nil, fmt.Errorf("frame count must be between 1 and 20")
	}
	if err := os.MkdirAll(outputDirectory, 0o755); err != nil {
		return nil, err
	}
	start := max(int64(0), atMS-beforeMS)
	end := min(durationMS, atMS+afterMS)
	if end <= start {
		return nil, fmt.Errorf("context window is empty")
	}

	frames := make([]protocol.Frame, 0, count)
	for index := 0; index < count; index++ {
		var timestampMS int64
		if count == 1 {
			timestampMS = min(max(start, atMS), end-1)
		} else {
			timestampMS = start + int64(index+1)*(end-start)/int64(count+1)
		}
		filename := fmt.Sprintf("%012d.jpg", timestampMS)
		path := filepath.Join(outputDirectory, filename)
		if _, err := os.Stat(path); os.IsNotExist(err) {
			_, _, err = runner.Run(ctx, ffmpegPath,
				"-hide_banner", "-loglevel", "error", "-y",
				"-ss", fmt.Sprintf("%.3f", float64(timestampMS)/1000),
				"-i", mediaPath,
				"-frames:v", "1",
				"-vf", scaleFilter,
				"-q:v", "2",
				path,
			)
			if err != nil {
				return nil, fmt.Errorf("extract context frame at %dms: %w", timestampMS, err)
			}
		}
		candidate, err := inspectFrame(path, timestampMS, "context")
		if err != nil {
			return nil, err
		}
		frames = append(frames, protocol.Frame{
			ID:          fmt.Sprintf("context-%d", timestampMS),
			TimestampMS: timestampMS,
			Path:        path,
			Source:      "context",
			Brightness:  candidate.brightness,
			Sharpness:   candidate.sharpness,
		})
	}
	return frames, nil
}

// ExtractAudio writes mono 16kHz little-endian float32 samples for local Whisper inference.
func ExtractAudio(ctx context.Context, runner Runner, ffmpegPath, mediaPath, outputPath string) error {
	if err := os.MkdirAll(filepath.Dir(outputPath), 0o755); err != nil {
		return err
	}
	_, _, err := runner.Run(ctx, ffmpegPath,
		"-hide_banner", "-loglevel", "error", "-y",
		"-i", mediaPath,
		"-vn", "-ac", "1", "-ar", "16000",
		"-f", "f32le",
		outputPath,
	)
	return err
}
