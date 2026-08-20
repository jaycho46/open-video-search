package media

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const maximumDurationSeconds = 2 * 60 * 60

type youtubeInfo struct {
	ID                string                     `json:"id"`
	Title             string                     `json:"title"`
	Duration          float64                    `json:"duration"`
	WebpageURL        string                     `json:"webpage_url"`
	Language          string                     `json:"language"`
	OriginalLanguage  string                     `json:"original_language"`
	Subtitles         map[string]json.RawMessage `json:"subtitles"`
	AutomaticCaptions map[string]json.RawMessage `json:"automatic_captions"`
}

// IsYouTubeURL validates the supported public YouTube URL forms.
func IsYouTubeURL(source string) bool {
	parsed, err := url.Parse(source)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return false
	}
	host := strings.ToLower(strings.TrimPrefix(parsed.Hostname(), "www."))
	return host == "youtube.com" || host == "m.youtube.com" || host == "music.youtube.com" || host == "youtu.be"
}

// ValidateYouTubeURL rejects playlists and URLs without a concrete video identifier.
func ValidateYouTubeURL(source string) error {
	if !IsYouTubeURL(source) {
		return fmt.Errorf("only public youtube.com and youtu.be URLs are supported")
	}
	parsed, _ := url.Parse(source)
	if parsed.Query().Get("list") != "" {
		return fmt.Errorf("playlists are not supported; provide a single video URL")
	}
	if strings.HasSuffix(strings.ToLower(parsed.Hostname()), "youtube.com") && parsed.Query().Get("v") == "" && !strings.HasPrefix(parsed.Path, "/shorts/") {
		return fmt.Errorf("youtube URL does not contain a video ID")
	}
	return nil
}

// HashFile returns a full SHA-256 digest without loading the source into memory.
func HashFile(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()

	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func chooseSubtitleLanguage(info youtubeInfo, requested string) (string, string) {
	if language := matchLanguage(requested, info.Subtitles); language != "" {
		return language, "manual"
	}
	if language := matchLanguage(requested, info.AutomaticCaptions); language != "" {
		return language, "automatic"
	}
	if language := matchLanguage(info.Language, info.Subtitles); language != "" {
		return language, "manual"
	}
	if language := matchLanguage(info.OriginalLanguage, info.Subtitles); language != "" {
		return language, "manual"
	}
	if language := matchLanguage(info.Language, info.AutomaticCaptions); language != "" {
		return language, "automatic"
	}
	if language := matchLanguage(info.OriginalLanguage, info.AutomaticCaptions); language != "" {
		return language, "automatic"
	}
	if language := matchLanguage("en", info.Subtitles); language != "" {
		return language, "manual"
	}
	if language := matchLanguage("en", info.AutomaticCaptions); language != "" {
		return language, "automatic"
	}
	if language := firstLanguage(info.Subtitles); language != "" {
		return language, "manual"
	}
	return firstLanguage(info.AutomaticCaptions), "automatic"
}

func matchLanguage(requested string, tracks map[string]json.RawMessage) string {
	requested = strings.ToLower(strings.TrimSpace(requested))
	if requested == "" {
		return ""
	}
	if _, ok := tracks[requested]; ok {
		return requested
	}
	base := strings.Split(requested, "-")[0]
	keys := sortedKeys(tracks)
	for _, key := range keys {
		lower := strings.ToLower(key)
		if lower == base || strings.HasPrefix(lower, base+"-") {
			return key
		}
	}
	return ""
}

func firstLanguage(tracks map[string]json.RawMessage) string {
	for _, key := range sortedKeys(tracks) {
		if key != "live_chat" {
			return key
		}
	}
	return ""
}

func sortedKeys(values map[string]json.RawMessage) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func findDownloadedMedia(directory string) (string, error) {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return "", err
	}
	for _, entry := range entries {
		if entry.IsDir() || strings.HasSuffix(strings.ToLower(entry.Name()), ".vtt") {
			continue
		}
		extension := strings.ToLower(filepath.Ext(entry.Name()))
		switch extension {
		case ".mp4", ".mkv", ".webm", ".mov":
			return filepath.Join(directory, entry.Name()), nil
		}
	}
	return "", fmt.Errorf("yt-dlp did not produce a supported media file")
}

func findVTT(directory string) string {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return ""
	}
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(strings.ToLower(entry.Name()), ".vtt") {
			return filepath.Join(directory, entry.Name())
		}
	}
	return ""
}
