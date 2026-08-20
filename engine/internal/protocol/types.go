package protocol

const (
	ProtocolVersion = "1"
	EngineVersion   = "0.1.0"
)

type Event struct {
	Type    string `json:"type"`
	Stage   string `json:"stage,omitempty"`
	Current int    `json:"current,omitempty"`
	Total   int    `json:"total,omitempty"`
	Message string `json:"message,omitempty"`
	Code    string `json:"code,omitempty"`
	Data    any    `json:"data,omitempty"`
}

type Dependency struct {
	Name      string `json:"name"`
	Path      string `json:"path,omitempty"`
	Version   string `json:"version,omitempty"`
	Available bool   `json:"available"`
	Supported bool   `json:"supported"`
}

type DoctorResult struct {
	ProtocolVersion string       `json:"protocol_version"`
	EngineVersion   string       `json:"engine_version"`
	Dependencies    []Dependency `json:"dependencies"`
}

type ProbeResult struct {
	Path            string          `json:"path"`
	DurationMS      int64           `json:"duration_ms"`
	Title           string          `json:"title,omitempty"`
	Width           int             `json:"width,omitempty"`
	Height          int             `json:"height,omitempty"`
	HasAudio        bool            `json:"has_audio"`
	HasSubtitles    bool            `json:"has_subtitles"`
	FormatName      string          `json:"format_name,omitempty"`
	VideoCodec      string          `json:"video_codec,omitempty"`
	AudioCodec      string          `json:"audio_codec,omitempty"`
	SubtitleStreams int             `json:"subtitle_streams"`
	SubtitleTracks  []SubtitleTrack `json:"subtitle_tracks,omitempty"`
}

type SubtitleTrack struct {
	Index    int    `json:"index"`
	Language string `json:"language,omitempty"`
}

type Frame struct {
	ID          string  `json:"id"`
	TimestampMS int64   `json:"timestamp_ms"`
	Path        string  `json:"path"`
	SceneID     int     `json:"scene_id"`
	Source      string  `json:"source"`
	Brightness  float64 `json:"brightness"`
	Sharpness   float64 `json:"sharpness"`
}

type PrepareResult struct {
	ProtocolVersion string      `json:"protocol_version"`
	EngineVersion   string      `json:"engine_version"`
	VideoID         string      `json:"video_id"`
	Title           string      `json:"title"`
	SourceType      string      `json:"source_type"`
	Source          string      `json:"source"`
	CanonicalURL    string      `json:"canonical_url,omitempty"`
	MediaPath       string      `json:"media_path"`
	SubtitlePath    string      `json:"subtitle_path,omitempty"`
	SubtitleSource  string      `json:"subtitle_source,omitempty"`
	Language        string      `json:"language,omitempty"`
	Probe           ProbeResult `json:"probe"`
	Frames          []Frame     `json:"frames"`
	Warnings        []string    `json:"warnings,omitempty"`
}

type ContextResult struct {
	ProtocolVersion string  `json:"protocol_version"`
	EngineVersion   string  `json:"engine_version"`
	Frames          []Frame `json:"frames"`
}

type AudioResult struct {
	ProtocolVersion string `json:"protocol_version"`
	EngineVersion   string `json:"engine_version"`
	Path            string `json:"path"`
	SampleRate      int    `json:"sample_rate"`
	Channels        int    `json:"channels"`
}
