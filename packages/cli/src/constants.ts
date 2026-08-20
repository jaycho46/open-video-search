export const CLI_VERSION = "0.1.0";
export const SCHEMA_VERSION = "open-video/v1" as const;
export const ENGINE_PROTOCOL_VERSION = "1";

export const SAMPLING_CONFIG = {
  interval_ms: 2_000,
  scene_threshold: 0.4,
  max_gap_ms: 4_000,
  long_edge_px: 768,
} as const;

export const CLIP_MODEL = {
  key: "clip",
  id: "onnx-community/CLIP-ViT-B-32-laion2B-s34B-b79K-ONNX",
  revision: "de693d0c5a5b263ae94ece9bf751e0cda14305d8",
  dtype: "q8",
  files: [
    "config.json",
    "merges.txt",
    "preprocessor_config.json",
    "special_tokens_map.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "vocab.json",
    "onnx/model_quantized.onnx",
  ],
  checksums: {
    "config.json": "c1d049824575fc7e2a68e7a75f556da00c8e240b08ef2f11f40fe901de637838",
    "merges.txt": "9fd691f7c8039210e0fced15865466c65820d09b63988b0174bfe25de299051a",
    "onnx/model_quantized.onnx":
      "2ac8410fe198fbd003cd97460bdd68653d99c33f53311881cd306190067aee9b",
    "preprocessor_config.json": "205d45875859846dc1ca211b9a19f5db72f47e953b396954ee34d48d8e95c3c6",
    "special_tokens_map.json": "2cdb3b8331a60c92fc1e55a13e9fd61fd2293c5a51275fdcccd62b780052530e",
    "tokenizer.json": "6d9109cc838977f3ca94a379eec36aecc7c807e1785cd729660ca2fc0171fb35",
    "tokenizer_config.json": "c3d2a67c48a59ffa8fd92de060608524b12cae93acb4fe83e5eb03147a001f5a",
    "vocab.json": "5047b556ce86ccaf6aa22b3ffccfc52d391ea4accdab9c2f2407da5b742d4363",
  },
} as const;

export const WHISPER_MODEL = {
  key: "whisper",
  id: "onnx-community/whisper-base_timestamped",
  revision: "608c49e61301901684bc36cac8f74b95ff6b5a8e",
  dtype: "q8",
  files: [
    "added_tokens.json",
    "config.json",
    "generation_config.json",
    "merges.txt",
    "normalizer.json",
    "preprocessor_config.json",
    "special_tokens_map.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "vocab.json",
    "onnx/encoder_model_quantized.onnx",
    "onnx/decoder_model_merged_quantized.onnx",
  ],
  checksums: {
    "added_tokens.json": "9715fd2243b6f06a5858b5e32950d2853f73dd5bc201aafcf76f5082a2d8acd1",
    "config.json": "f4d0608f7d918166da7edb3e188de5ef1bfe70d9802e785d271fd88111e9cf4b",
    "generation_config.json": "61070cf8de25b1e9256e8e102ded49d8d24a8369ed36ef84fdf21549e68125a0",
    "merges.txt": "2df2990a395e35e8dfbc7511e08c12d56018d8d04691e0133e5d63b21e154dc6",
    "normalizer.json": "bf1c507dc8724ca9cf9903640dacfb69dae2f00edee4f21ceba106a7392f26dd",
    "onnx/encoder_model_quantized.onnx":
      "2714484ebe1bae7c1646e8eadb768bb9d415cf11763466d21f23039a29c62e6f",
    "onnx/decoder_model_merged_quantized.onnx":
      "cf9a8d5bcddc0917a0078135b484cedcaf44f28909cd91910abd29dced9171db",
    "preprocessor_config.json": "a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d",
    "special_tokens_map.json": "e67ae3a0aaa99abcd9f187138e12db1f65c16a14761c50ef10eef2c174a7a691",
    "tokenizer.json": "27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566",
    "tokenizer_config.json": "2e036e4dbacfdeb7242c7d4ec4149f4a16e86026048f94d1637e3a8ee9c6a573",
    "vocab.json": "50d6a919f0a0601d56a04eb583c780d18553aa388254ba3158eb6a00f13e2c1a",
  },
} as const;

export const YTDLP_VERSION = "2026.08.19";

export const YTDLP_ASSETS = {
  "darwin-arm64": {
    filename: "yt-dlp_macos",
    sha256: "0f192b7ec147ab6288885d6351d9ab67367640029b4377576ef46dd79cf7b202",
  },
  "darwin-x64": {
    filename: "yt-dlp_macos",
    sha256: "0f192b7ec147ab6288885d6351d9ab67367640029b4377576ef46dd79cf7b202",
  },
  "linux-arm64": {
    filename: "yt-dlp_linux_aarch64",
    sha256: "b16e4dab368a816cd05d477d698a605a6ae87ccee1c8ffd38fa21d7254141fcc",
  },
  "linux-x64": {
    filename: "yt-dlp_linux",
    sha256: "58162f9bfdc27458ea47bfcb311cf47028f17d8154a8bf7d689861d46399230a",
  },
} as const;

export const EXIT_CODES = {
  usage: 2,
  dependency: 10,
  acquisition: 20,
  processing: 30,
  index: 40,
} as const;

export const MAX_VIDEO_DURATION_MS = 2 * 60 * 60 * 1_000;
export const TIMELINE_SEGMENT_MS = 2_000;
export const RRF_K = 60;
export const VISUAL_WEIGHT = 0.7;
export const TEXT_WEIGHT = 0.3;
export const MIN_SEARCH_WINDOW_MS = 8_000;
export const MAX_SEARCH_WINDOW_MS = 12_000;
export const DEFAULT_SEARCH_WINDOW_MS = 12_000;
