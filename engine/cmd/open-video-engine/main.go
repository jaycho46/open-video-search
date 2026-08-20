package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"regexp"
	"strings"
	"time"

	"open-video/engine/internal/media"
	"open-video/engine/internal/protocol"
)

const (
	exitUsage      = 2
	exitDependency = 10
	exitSource     = 20
	exitProcessing = 30
)

func main() {
	if len(os.Args) < 2 {
		fail("usage", "expected one of: version, doctor, prepare, context, audio", exitUsage)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runner := media.ExecRunner{}

	switch os.Args[1] {
	case "version":
		emitResult(map[string]string{"protocol_version": protocol.ProtocolVersion, "engine_version": protocol.EngineVersion})
	case "doctor":
		runDoctor(ctx, runner, os.Args[2:])
	case "prepare":
		runPrepare(ctx, runner, os.Args[2:])
	case "context":
		runContext(ctx, runner, os.Args[2:])
	case "audio":
		runAudio(ctx, runner, os.Args[2:])
	default:
		fail("usage", "unknown engine command: "+os.Args[1], exitUsage)
	}
}

func runDoctor(ctx context.Context, runner media.Runner, args []string) {
	flags := flag.NewFlagSet("doctor", flag.ContinueOnError)
	ffmpegFlag := flags.String("ffmpeg", "", "ffmpeg executable")
	ffprobeFlag := flags.String("ffprobe", "", "ffprobe executable")
	ytdlpFlag := flags.String("yt-dlp", "", "yt-dlp executable")
	parseFlags(flags, args)

	dependencies := []protocol.Dependency{
		checkDependency(ctx, runner, *ffmpegFlag, "ffmpeg", []string{"-version"}, true),
		checkDependency(ctx, runner, *ffprobeFlag, "ffprobe", []string{"-version"}, true),
		checkDependency(ctx, runner, *ytdlpFlag, "yt-dlp", []string{"--version"}, false),
	}
	emitResult(protocol.DoctorResult{
		ProtocolVersion: protocol.ProtocolVersion,
		EngineVersion:   protocol.EngineVersion,
		Dependencies:    dependencies,
	})
}

func runPrepare(ctx context.Context, runner media.Runner, args []string) {
	flags := flag.NewFlagSet("prepare", flag.ContinueOnError)
	source := flags.String("source", "", "video source")
	workDir := flags.String("work-dir", "", "work directory")
	language := flags.String("language", "", "subtitle language")
	subtitles := flags.String("subtitles", "", "explicit subtitle path")
	ffmpegFlag := flags.String("ffmpeg", "", "ffmpeg executable")
	ffprobeFlag := flags.String("ffprobe", "", "ffprobe executable")
	ytdlpFlag := flags.String("yt-dlp", "", "yt-dlp executable")
	jsRuntime := flags.String("js-runtime", "", "Node.js runtime for yt-dlp JavaScript challenges")
	parseFlags(flags, args)

	ffmpegPath := requireExecutable(*ffmpegFlag, "ffmpeg")
	ffprobePath := requireExecutable(*ffprobeFlag, "ffprobe")
	ytdlpPath := ""
	if media.IsYouTubeURL(*source) {
		ytdlpPath = requireExecutable(*ytdlpFlag, "yt-dlp")
	}

	result, err := media.Prepare(ctx, runner, media.PrepareOptions{
		Source:       *source,
		WorkDir:      *workDir,
		Language:     *language,
		SubtitlePath: *subtitles,
		FFmpegPath:   ffmpegPath,
		FFprobePath:  ffprobePath,
		YTDLPPath:    ytdlpPath,
		JSRuntime:    *jsRuntime,
	}, func(stage, message string) {
		emit(protocol.Event{Type: "progress", Stage: stage, Message: message})
	})
	if err != nil {
		fail("processing", err.Error(), classifyError(err))
	}
	emitResult(result)
}

func runContext(ctx context.Context, runner media.Runner, args []string) {
	flags := flag.NewFlagSet("context", flag.ContinueOnError)
	mediaPath := flags.String("media", "", "media path")
	output := flags.String("output", "", "output directory")
	atMS := flags.Int64("at-ms", 0, "center timestamp")
	beforeMS := flags.Int64("before-ms", 6000, "milliseconds before")
	afterMS := flags.Int64("after-ms", 6000, "milliseconds after")
	durationMS := flags.Int64("duration-ms", 0, "video duration")
	count := flags.Int("frames", 5, "frame count")
	ffmpegFlag := flags.String("ffmpeg", "", "ffmpeg executable")
	parseFlags(flags, args)

	ffmpegPath := requireExecutable(*ffmpegFlag, "ffmpeg")
	frames, err := media.ExtractContextFrames(ctx, runner, ffmpegPath, *mediaPath, *output, *atMS, *beforeMS, *afterMS, *durationMS, *count)
	if err != nil {
		fail("processing", err.Error(), exitProcessing)
	}
	emitResult(protocol.ContextResult{ProtocolVersion: protocol.ProtocolVersion, EngineVersion: protocol.EngineVersion, Frames: frames})
}

func runAudio(ctx context.Context, runner media.Runner, args []string) {
	flags := flag.NewFlagSet("audio", flag.ContinueOnError)
	mediaPath := flags.String("media", "", "media path")
	output := flags.String("output", "", "output path")
	ffmpegFlag := flags.String("ffmpeg", "", "ffmpeg executable")
	parseFlags(flags, args)

	ffmpegPath := requireExecutable(*ffmpegFlag, "ffmpeg")
	if err := media.ExtractAudio(ctx, runner, ffmpegPath, *mediaPath, *output); err != nil {
		fail("processing", err.Error(), exitProcessing)
	}
	emitResult(protocol.AudioResult{ProtocolVersion: protocol.ProtocolVersion, EngineVersion: protocol.EngineVersion, Path: *output, SampleRate: 16000, Channels: 1})
}

func checkDependency(ctx context.Context, runner media.Runner, explicitPath, fallback string, args []string, required bool) protocol.Dependency {
	path, err := media.ResolveExecutable(explicitPath, fallback)
	if err != nil {
		return protocol.Dependency{Name: fallback, Available: false, Supported: !required}
	}
	stdout, stderr, err := runner.Run(ctx, path, args...)
	if err != nil {
		return protocol.Dependency{Name: fallback, Path: path, Available: false, Supported: false}
	}
	version := media.FirstLine(stdout)
	if version == "" {
		version = media.FirstLine(stderr)
	}
	supported := true
	if fallback == "ffmpeg" || fallback == "ffprobe" {
		supported = supportsFFmpeg(version)
	}
	return protocol.Dependency{Name: fallback, Path: path, Version: version, Available: true, Supported: supported}
}

func supportsFFmpeg(versionLine string) bool {
	match := regexp.MustCompile(`(?i)version\s+n?([0-9]+)\.([0-9]+)`).FindStringSubmatch(versionLine)
	if len(match) != 3 {
		return false
	}
	major := 0
	minor := 0
	fmt.Sscanf(match[1], "%d", &major)
	fmt.Sscanf(match[2], "%d", &minor)
	return major > 6 || (major == 6 && minor >= 1)
}

func requireExecutable(explicitPath, fallback string) string {
	path, err := media.ResolveExecutable(explicitPath, fallback)
	if err != nil {
		fail("dependency", err.Error(), exitDependency)
	}
	return path
}

func parseFlags(flags *flag.FlagSet, args []string) {
	flags.SetOutput(os.Stderr)
	if err := flags.Parse(args); err != nil {
		fail("usage", err.Error(), exitUsage)
	}
}

func classifyError(err error) int {
	message := strings.ToLower(err.Error())
	if strings.Contains(message, "youtube") || strings.Contains(message, "local video") || strings.Contains(message, "duration") {
		return exitSource
	}
	return exitProcessing
}

func emitResult(data any) {
	emit(protocol.Event{Type: "result", Data: data})
}

func emit(event protocol.Event) {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(event); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(exitProcessing)
	}
}

func fail(code, message string, exitCode int) {
	emit(protocol.Event{Type: "error", Code: code, Message: message})
	time.Sleep(5 * time.Millisecond)
	os.Exit(exitCode)
}
