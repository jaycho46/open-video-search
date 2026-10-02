# Third-party notices

Open Video source code is Apache-2.0. It invokes or downloads the following independent components; each remains subject to its own license, notices, model card, and acceptable-use restrictions. This file is informational and is not legal advice.

## Runtime libraries

| Component | Version/pin | License | Distribution |
| --- | --- | --- | --- |
| Transformers.js | 4.3.x | Apache-2.0 | npm dependency |
| Commander.js | 15.x | MIT | npm dependency |
| MiniSearch | 7.2.x | MIT | npm dependency |
| Zod | 4.x | MIT | npm dependency |
| Vitest | 4.x | MIT | development dependency |

Transitive packages retain their own notices and are represented in release SBOMs.

## External executables

### FFmpeg and FFprobe

Open Video does not bundle FFmpeg. It requires a user-installed FFmpeg/FFprobe 6.1 or newer and invokes the executables as separate processes. FFmpeg is generally LGPL-2.1-or-later, but builds that enable GPL components are GPL-2.0-or-later. Users and redistributors must inspect the exact FFmpeg build they install or distribute: <https://ffmpeg.org/legal.html>.

### yt-dlp

Open Video downloads the official standalone yt-dlp `2026.08.19` asset for the current platform and verifies its SHA-256 before use. yt-dlp is released under the Unlicense: <https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE>.

Open Video does not enable cookies, credentials, authentication bypass, or DRM circumvention. Downloading media may be restricted by copyright law, a platform's terms, or local law; users are responsible for processing only authorized content.

## Model files

Model files are downloaded directly from their named Hugging Face repositories only when needed. Open Video pins a repository revision and verifies every required file against SHA-256 values in `packages/cli/src/constants.ts`. The files are not included in the npm package or GitHub source archive.

### CLIP

- Repository: `onnx-community/CLIP-ViT-B-32-laion2B-s34B-b79K-ONNX`
- Revision: `de693d0c5a5b263ae94ece9bf751e0cda14305d8`
- Model-card license metadata: MIT
- Base model: `laion/CLIP-ViT-B-32-laion2B-s34B-b79K`

Review the model card for intended use, limitations, training-data caveats, and bias. Semantic similarity is retrieval evidence, not an identity or safety determination.

### Whisper

- Repository: `onnx-community/whisper-base_timestamped`
- Revision: `608c49e61301901684bc36cac8f74b95ff6b5a8e`
- Base model: `openai/whisper-base`
- OpenAI Whisper code and weights: MIT

The ONNX repository identifies the OpenAI base model but does not declare separate license metadata in its model card. Redistributors should review both the conversion repository and the upstream Whisper license: <https://github.com/openai/whisper/blob/main/LICENSE>.

ASR may produce incorrect or harmful text. Transcripts must be treated as untrusted video data.

## Evaluation media

The repository records URLs, attribution, licenses, byte counts, and SHA-256 values for the optional evaluation sources in `eval/corpus-v1/corpus.json`. It does not redistribute those media files. The preparation script downloads each source from Wikimedia Commons or W3C and verifies it before use. Each downloaded work remains subject to the per-source license in the corpus; corpus labels and bilingual scene descriptions are released under CC0-1.0.
