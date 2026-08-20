package media

import (
	"context"
	"fmt"
	"image"
	_ "image/jpeg"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"open-video/engine/internal/protocol"
)

const scaleFilter = "scale=if(gt(iw\\,ih)\\,min(768\\,iw)\\,-2):if(gt(iw\\,ih)\\,-2\\,min(768\\,ih))"

type frameCandidate struct {
	path        string
	timestampMS int64
	source      string
	hash        uint64
	brightness  float64
	sharpness   float64
	meanRed     float64
	meanGreen   float64
	meanBlue    float64
}

var sceneTimePattern = regexp.MustCompile(`pts_time:([0-9]+(?:\.[0-9]+)?)`)

// ExtractFrames combines uniform sampling with scene-cut candidates and removes adjacent duplicates.
func ExtractFrames(ctx context.Context, runner Runner, ffmpegPath, mediaPath, outputDirectory string, durationMS int64) ([]protocol.Frame, error) {
	rawDirectory := filepath.Join(outputDirectory, ".raw")
	if err := os.MkdirAll(rawDirectory, 0o755); err != nil {
		return nil, err
	}
	defer os.RemoveAll(rawDirectory)

	uniformPattern := filepath.Join(rawDirectory, "uniform_%06d.jpg")
	_, uniformStderr, err := runner.Run(ctx, ffmpegPath,
		"-hide_banner", "-y",
		"-i", mediaPath,
		"-vf", "fps=1/2,"+scaleFilter+",showinfo",
		"-fps_mode", "vfr",
		"-q:v", "3",
		uniformPattern,
	)
	if err != nil {
		return nil, fmt.Errorf("extract uniform frames: %w", err)
	}

	uniformFiles, err := filepath.Glob(filepath.Join(rawDirectory, "uniform_*.jpg"))
	if err != nil {
		return nil, err
	}
	sort.Strings(uniformFiles)
	uniformTimes := parseFrameTimes(string(uniformStderr))
	candidates := make([]frameCandidate, 0, len(uniformFiles))
	for index, path := range uniformFiles {
		timestampMS := sampledFrameTimestamp(uniformTimes, index, 2000)
		if timestampMS > durationMS {
			break
		}
		candidate, candidateErr := inspectFrame(path, timestampMS, "uniform")
		if candidateErr != nil {
			return nil, candidateErr
		}
		candidates = append(candidates, candidate)
	}

	scenePattern := filepath.Join(rawDirectory, "scene_%06d.jpg")
	_, sceneStderr, sceneErr := runner.Run(ctx, ffmpegPath,
		"-hide_banner", "-y",
		"-i", mediaPath,
		"-vf", "select=gt(scene\\,0.4),"+scaleFilter+",showinfo",
		"-fps_mode", "vfr",
		"-q:v", "3",
		scenePattern,
	)
	if sceneErr == nil {
		sceneFiles, _ := filepath.Glob(filepath.Join(rawDirectory, "scene_*.jpg"))
		sort.Strings(sceneFiles)
		times := parseFrameTimes(string(sceneStderr))
		for index, path := range sceneFiles {
			if index >= len(times) {
				break
			}
			timestampMS := int64(math.Round(times[index] * 1000))
			candidate, candidateErr := inspectFrame(path, timestampMS, "scene")
			if candidateErr == nil {
				candidates = append(candidates, candidate)
			}
		}
	}

	return finalizeFrames(candidates, outputDirectory), nil
}

func parseFrameTimes(stderr string) []float64 {
	matches := sceneTimePattern.FindAllStringSubmatch(stderr, -1)
	times := make([]float64, 0, len(matches))
	for _, match := range matches {
		value, err := strconv.ParseFloat(match[1], 64)
		if err == nil {
			times = append(times, value)
		}
	}
	return times
}

func sampledFrameTimestamp(times []float64, index int, fallbackIntervalMS int64) int64 {
	if index < len(times) {
		return int64(math.Round(times[index] * 1000))
	}
	return int64(index) * fallbackIntervalMS
}

func inspectFrame(path string, timestampMS int64, source string) (frameCandidate, error) {
	file, err := os.Open(path)
	if err != nil {
		return frameCandidate{}, err
	}
	defer file.Close()
	imageValue, _, err := image.Decode(file)
	if err != nil {
		return frameCandidate{}, fmt.Errorf("decode frame %s: %w", path, err)
	}
	hash, brightness, sharpness, meanRed, meanGreen, meanBlue := imageMetrics(imageValue)
	return frameCandidate{
		path:        path,
		timestampMS: timestampMS,
		source:      source,
		hash:        hash,
		brightness:  brightness,
		sharpness:   sharpness,
		meanRed:     meanRed,
		meanGreen:   meanGreen,
		meanBlue:    meanBlue,
	}, nil
}

func imageMetrics(value image.Image) (uint64, float64, float64, float64, float64, float64) {
	bounds := value.Bounds()
	gray := make([]float64, 9*8)
	var brightnessTotal float64
	var sharpnessTotal float64
	var redTotal float64
	var greenTotal float64
	var blueTotal float64
	var previous float64

	for y := 0; y < 8; y++ {
		for x := 0; x < 9; x++ {
			sourceX := bounds.Min.X + x*max(1, bounds.Dx()-1)/8
			sourceY := bounds.Min.Y + y*max(1, bounds.Dy()-1)/7
			r, g, b, _ := value.At(sourceX, sourceY).RGBA()
			luminance := 0.299*float64(r>>8) + 0.587*float64(g>>8) + 0.114*float64(b>>8)
			redTotal += float64(r >> 8)
			greenTotal += float64(g >> 8)
			blueTotal += float64(b >> 8)
			gray[y*9+x] = luminance
			brightnessTotal += luminance
			if x > 0 {
				sharpnessTotal += math.Abs(luminance - previous)
			}
			previous = luminance
		}
	}

	var hash uint64
	bit := 0
	for y := 0; y < 8; y++ {
		for x := 0; x < 8; x++ {
			if gray[y*9+x] > gray[y*9+x+1] {
				hash |= 1 << bit
			}
			bit++
		}
	}
	sampleCount := float64(len(gray))
	return hash,
		brightnessTotal / sampleCount,
		sharpnessTotal / 64,
		redTotal / sampleCount,
		greenTotal / sampleCount,
		blueTotal / sampleCount
}

func finalizeFrames(candidates []frameCandidate, outputDirectory string) []protocol.Frame {
	sort.Slice(candidates, func(left, right int) bool {
		if candidates[left].timestampMS == candidates[right].timestampMS {
			return candidates[left].source == "scene"
		}
		return candidates[left].timestampMS < candidates[right].timestampMS
	})

	kept := deduplicateFrameCandidates(candidates)

	sceneTimes := make([]int64, 0)
	for _, candidate := range candidates {
		if candidate.source == "scene" {
			sceneTimes = append(sceneTimes, candidate.timestampMS)
		}
	}
	sort.Slice(sceneTimes, func(left, right int) bool { return sceneTimes[left] < sceneTimes[right] })

	frames := make([]protocol.Frame, 0, len(kept))
	for _, candidate := range kept {
		filename := fmt.Sprintf("%012d.jpg", candidate.timestampMS)
		destination := filepath.Join(outputDirectory, filename)
		if err := os.Rename(candidate.path, destination); err != nil {
			continue
		}
		sceneID := sort.Search(len(sceneTimes), func(index int) bool { return sceneTimes[index] > candidate.timestampMS })
		frames = append(frames, protocol.Frame{
			ID:          strings.TrimSuffix(filename, filepath.Ext(filename)),
			TimestampMS: candidate.timestampMS,
			Path:        filepath.ToSlash(filepath.Join("frames", filename)),
			SceneID:     sceneID,
			Source:      candidate.source,
			Brightness:  math.Round(candidate.brightness*100) / 100,
			Sharpness:   math.Round(candidate.sharpness*100) / 100,
		})
	}
	return frames
}

func deduplicateFrameCandidates(candidates []frameCandidate) []frameCandidate {
	kept := make([]frameCandidate, 0, len(candidates))
	for index, candidate := range candidates {
		if len(kept) == 0 {
			kept = append(kept, candidate)
			continue
		}
		previous := kept[len(kept)-1]
		if candidate.timestampMS-previous.timestampMS < 250 {
			if candidate.sharpness > previous.sharpness {
				kept[len(kept)-1] = candidate
			}
			continue
		}
		isDuplicate := hammingDistance(candidate.hash, previous.hash) <= 4 && colorDistance(candidate, previous) < 12
		canSkipWithoutGap := index+1 < len(candidates) && candidates[index+1].timestampMS-previous.timestampMS <= 4000
		if isDuplicate && canSkipWithoutGap {
			continue
		}
		kept = append(kept, candidate)
	}
	return kept
}

func hammingDistance(left, right uint64) int {
	value := left ^ right
	count := 0
	for value != 0 {
		value &= value - 1
		count++
	}
	return count
}

func colorDistance(left, right frameCandidate) float64 {
	red := left.meanRed - right.meanRed
	green := left.meanGreen - right.meanGreen
	blue := left.meanBlue - right.meanBlue
	return math.Sqrt(red*red + green*green + blue*blue)
}
