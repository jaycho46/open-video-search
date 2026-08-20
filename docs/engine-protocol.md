# Native engine protocol v1

The Go executable is a private implementation detail used by the TypeScript CLI. It is not a second end-user product. Every stdout line is one JSON event; FFmpeg/FFprobe/yt-dlp diagnostics remain on stderr.

```json
{"type":"progress","stage":"frames","message":"Extracting searchable frames"}
{"type":"result","data":{"protocol_version":"1","engine_version":"0.1.0"}}
{"type":"error","code":"processing","message":"..."}
```

The CLI rejects a different `protocol_version` or `engine_version` before accepting results.

## Commands

- `version`: protocol and engine versions.
- `doctor`: FFmpeg, FFprobe, and optional yt-dlp availability/version support.
- `prepare`: resolve one source, probe media, select/convert subtitles, and create searchable frames.
- `context`: extract evenly spaced evidence frames around one timestamp.
- `audio`: extract mono 16 kHz Float32 LE samples for optional Transformers.js Whisper.

YouTube preparation always passes `--ignore-config`, disables remote components and default JavaScript runtimes, and explicitly enables the Node executable supplied by the CLI. This prevents ambient yt-dlp configuration, cookies, plugins, or remote challenge components from silently broadening acquisition behavior.

Process exit codes are `2` usage, `10` dependency, `20` acquisition/source, and `30` processing. The CLI maps missing/corrupt public indexes to its own exit code `40`.

