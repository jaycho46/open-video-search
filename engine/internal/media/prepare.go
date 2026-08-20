package media

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"open-video/engine/internal/protocol"
)

type PrepareOptions struct {
	Source       string
	WorkDir      string
	Language     string
	SubtitlePath string
	FFmpegPath   string
	FFprobePath  string
	YTDLPPath    string
	JSRuntime    string
}

// Prepare resolves a source, extracts subtitles and searchable frames, and returns stable metadata.
func Prepare(ctx context.Context, runner Runner, options PrepareOptions, progress func(string, string)) (protocol.PrepareResult, error) {
	if options.Source == "" || options.WorkDir == "" {
		return protocol.PrepareResult{}, fmt.Errorf("source and work directory are required")
	}
	if err := os.MkdirAll(options.WorkDir, 0o755); err != nil {
		return protocol.PrepareResult{}, err
	}
	mediaDirectory := filepath.Join(options.WorkDir, "media")
	framesDirectory := filepath.Join(options.WorkDir, "frames")
	if err := os.MkdirAll(mediaDirectory, 0o755); err != nil {
		return protocol.PrepareResult{}, err
	}
	if err := os.MkdirAll(framesDirectory, 0o755); err != nil {
		return protocol.PrepareResult{}, err
	}

	result := protocol.PrepareResult{
		ProtocolVersion: protocol.ProtocolVersion,
		EngineVersion:   protocol.EngineVersion,
		Source:          options.Source,
		Language:        options.Language,
	}

	progress("source", "Resolving video source")
	mediaPath, err := prepareSource(ctx, runner, options, mediaDirectory, &result)
	if err != nil {
		return protocol.PrepareResult{}, err
	}
	result.MediaPath = mediaPath

	progress("probe", "Reading video metadata")
	probe, err := Probe(ctx, runner, options.FFprobePath, mediaPath)
	if err != nil {
		return protocol.PrepareResult{}, err
	}
	if probe.DurationMS > maximumDurationSeconds*1000 {
		return protocol.PrepareResult{}, fmt.Errorf("video duration exceeds the v1 two-hour limit")
	}
	result.Probe = probe
	if result.Title == "" {
		result.Title = probe.Title
	}
	if result.Probe.Title == "" && result.VideoID != "" {
		result.Probe.Title = result.VideoID
	}
	if result.Title == "" {
		result.Title = result.Probe.Title
	}

	progress("subtitles", "Selecting subtitles")
	subtitlePath, subtitleSource, warning, subtitleErr := prepareSubtitles(ctx, runner, options, mediaPath, mediaDirectory, probe)
	if subtitleErr != nil {
		return protocol.PrepareResult{}, subtitleErr
	}
	if subtitlePath != "" {
		result.SubtitlePath = subtitlePath
		result.SubtitleSource = subtitleSource
	}
	if warning != "" {
		result.Warnings = append(result.Warnings, warning)
	}

	progress("frames", "Extracting searchable frames")
	frames, err := ExtractFrames(ctx, runner, options.FFmpegPath, mediaPath, framesDirectory, probe.DurationMS)
	if err != nil {
		return protocol.PrepareResult{}, err
	}
	if len(frames) == 0 {
		return protocol.PrepareResult{}, fmt.Errorf("no searchable frames were extracted")
	}
	result.Frames = frames
	return result, nil
}

func prepareSource(ctx context.Context, runner Runner, options PrepareOptions, mediaDirectory string, result *protocol.PrepareResult) (string, error) {
	if IsYouTubeURL(options.Source) {
		if err := ValidateYouTubeURL(options.Source); err != nil {
			return "", err
		}
		if options.YTDLPPath == "" {
			return "", fmt.Errorf("yt-dlp is required for YouTube sources")
		}
		metadataArgs := ytDLPBaseArgs(options.JSRuntime)
		metadataArgs = append(metadataArgs, "--dump-single-json", "--no-playlist", "--skip-download", options.Source)
		stdout, _, err := runner.Run(ctx, options.YTDLPPath, metadataArgs...)
		if err != nil {
			return "", fmt.Errorf("read YouTube metadata: %w", err)
		}
		var info youtubeInfo
		if err := json.Unmarshal(stdout, &info); err != nil {
			return "", fmt.Errorf("decode YouTube metadata: %w", err)
		}
		if info.Duration > maximumDurationSeconds {
			return "", fmt.Errorf("video duration exceeds the v1 two-hour limit")
		}
		language, sourceKind := chooseSubtitleLanguage(info, options.Language)
		if options.Language == "" {
			result.Language = language
		}
		result.VideoID = "youtube-" + info.ID
		result.Title = info.Title
		result.SourceType = "youtube"
		result.CanonicalURL = info.WebpageURL

		args := append(ytDLPBaseArgs(options.JSRuntime),
			"--no-playlist", "--no-progress", "--no-warnings",
			"--ffmpeg-location", options.FFmpegPath,
			"-f", "bv*[height<=720]+ba/b[height<=720]",
			"--merge-output-format", "mkv",
			"-o", filepath.Join(mediaDirectory, "source.%(ext)s"),
		)
		if language != "" && options.SubtitlePath == "" {
			args = append(args, "--sub-langs", language, "--sub-format", "vtt")
			if sourceKind == "manual" {
				args = append(args, "--write-subs")
			} else {
				args = append(args, "--write-auto-subs")
			}
		}
		args = append(args, options.Source)
		if _, _, err := runner.Run(ctx, options.YTDLPPath, args...); err != nil {
			return "", fmt.Errorf("download YouTube source: %w", err)
		}
		return findDownloadedMedia(mediaDirectory)
	}

	absolutePath, err := filepath.Abs(options.Source)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(absolutePath)
	if err != nil || info.IsDir() {
		return "", fmt.Errorf("local video does not exist: %s", absolutePath)
	}
	extension := strings.ToLower(filepath.Ext(absolutePath))
	if extension != ".mp4" && extension != ".mov" && extension != ".mkv" && extension != ".webm" {
		return "", fmt.Errorf("unsupported local video extension: %s", extension)
	}
	digest, err := HashFile(absolutePath)
	if err != nil {
		return "", fmt.Errorf("hash local video: %w", err)
	}
	result.VideoID = "local-" + digest[:16]
	result.SourceType = "local"
	return absolutePath, nil
}

func ytDLPBaseArgs(jsRuntime string) []string {
	args := []string{"--ignore-config", "--no-plugin-dirs", "--no-remote-components"}
	if jsRuntime != "" {
		args = append(args, "--no-js-runtimes", "--js-runtimes", "node:"+jsRuntime)
	}
	return args
}

func prepareSubtitles(ctx context.Context, runner Runner, options PrepareOptions, mediaPath, mediaDirectory string, probe protocol.ProbeResult) (string, string, string, error) {
	destination := filepath.Join(options.WorkDir, "subtitles.vtt")
	if options.SubtitlePath != "" {
		if err := convertSubtitle(ctx, runner, options.FFmpegPath, options.SubtitlePath, destination); err != nil {
			return "", "", "", fmt.Errorf("explicit subtitles could not be converted: %w", err)
		}
		return destination, "explicit", "", nil
	}
	if downloaded := findVTT(mediaDirectory); downloaded != "" {
		if err := copyFile(downloaded, destination); err != nil {
			return "", "", "", fmt.Errorf("downloaded subtitles could not be copied: %w", err)
		}
		return destination, "platform", "", nil
	}
	if probe.HasSubtitles {
		streamIndex := chooseEmbeddedSubtitle(probe.SubtitleTracks, options.Language)
		_, _, err := runner.Run(ctx, options.FFmpegPath,
			"-hide_banner", "-loglevel", "error", "-y",
			"-i", mediaPath,
			"-map", fmt.Sprintf("0:%d", streamIndex),
			"-c:s", "webvtt",
			destination,
		)
		if err == nil {
			return destination, "embedded", "", nil
		}
		return "", "", "embedded subtitles were present but could not be converted", nil
	}
	return "", "", "no subtitles were available; visual search remains usable", nil
}

func chooseEmbeddedSubtitle(tracks []protocol.SubtitleTrack, requested string) int {
	if len(tracks) == 0 {
		return 0
	}
	requested = strings.ToLower(strings.TrimSpace(requested))
	base := strings.Split(requested, "-")[0]
	if requested != "" {
		for _, track := range tracks {
			language := strings.ToLower(track.Language)
			if language == requested || language == base || strings.HasPrefix(language, base+"-") {
				return track.Index
			}
		}
	}
	return tracks[0].Index
}

func convertSubtitle(ctx context.Context, runner Runner, ffmpegPath, source, destination string) error {
	if strings.EqualFold(filepath.Ext(source), ".vtt") {
		return copyFile(source, destination)
	}
	_, _, err := runner.Run(ctx, ffmpegPath,
		"-hide_banner", "-loglevel", "error", "-y",
		"-i", source,
		"-f", "webvtt",
		destination,
	)
	return err
}

func copyFile(source, destination string) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.Create(destination)
	if err != nil {
		return err
	}
	defer output.Close()
	_, err = io.Copy(output, input)
	return err
}
