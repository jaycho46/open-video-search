import { readFile } from "node:fs/promises";

import { CLIP_MODEL, WHISPER_MODEL } from "./constants.js";
import { ensureClipModel, ensureWhisperModel } from "./assets.js";
import { OpenVideoError } from "./errors.js";
import { openVideoPaths } from "./paths.js";
import { normalizeVector } from "./ranking.js";
import type { CaptionCue } from "./vtt.js";

interface TensorLike {
  data: ArrayLike<number>;
  dims: number[];
}

interface ClipOutput {
  image_embeds: TensorLike;
  text_embeds: TensorLike;
}

interface AsrChunk {
  text?: string;
  timestamp?: [number | null, number | null];
}

interface AsrOutput {
  text?: string;
  chunks?: AsrChunk[];
}

function rowsFromTensor(tensor: TensorLike): Float32Array[] {
  const dimension = tensor.dims.at(-1) ?? tensor.data.length;
  const rows = Math.max(1, Math.floor(tensor.data.length / dimension));
  const output: Float32Array[] = [];
  for (let row = 0; row < rows; row += 1) {
    const vector = new Float32Array(dimension);
    for (let column = 0; column < dimension; column += 1) {
      vector[column] = Number(tensor.data[row * dimension + column] ?? 0);
    }
    output.push(normalizeVector(vector));
  }
  return output;
}

async function configureTransformers(): Promise<typeof import("@huggingface/transformers")> {
  const transformers = await import("@huggingface/transformers");
  transformers.env.localModelPath = openVideoPaths().models;
  transformers.env.allowLocalModels = true;
  transformers.env.allowRemoteModels = false;
  transformers.env.useBrowserCache = false;
  return transformers;
}

async function createClipRuntime(offline: boolean) {
  await ensureClipModel(offline);
  const transformers = await configureTransformers();
  const [model, tokenizer, processor] = await Promise.all([
    transformers.CLIPModel.from_pretrained(CLIP_MODEL.key, {
      dtype: CLIP_MODEL.dtype,
      local_files_only: true,
    }),
    transformers.AutoTokenizer.from_pretrained(CLIP_MODEL.key, {
      local_files_only: true,
    }),
    transformers.AutoProcessor.from_pretrained(CLIP_MODEL.key, {
      local_files_only: true,
    }),
  ]);
  return { model, processor, tokenizer, transformers };
}

let clipRuntime: Awaited<ReturnType<typeof createClipRuntime>> | undefined;

async function getClipRuntime(offline: boolean): Promise<Awaited<ReturnType<typeof createClipRuntime>>> {
  clipRuntime ??= await createClipRuntime(offline);
  return clipRuntime;
}

export interface EmbeddingProgress {
  current: number;
  total: number;
}

export async function embedImages(
  imagePaths: string[],
  offline: boolean,
  onProgress?: (progress: EmbeddingProgress) => void,
): Promise<Float32Array[]> {
  if (imagePaths.length === 0) return [];
  const runtime = await getClipRuntime(offline);
  const vectors: Float32Array[] = [];
  const batchSize = 8;
  for (let start = 0; start < imagePaths.length; start += batchSize) {
    const paths = imagePaths.slice(start, start + batchSize);
    const images = await Promise.all(paths.map((imagePath) => runtime.transformers.RawImage.read(imagePath)));
    const imageInputs = await runtime.processor(images);
    const textInputs = runtime.tokenizer(Array.from({ length: paths.length }, () => "a video frame"), {
      padding: true,
      truncation: true,
    });
    const output = (await runtime.model({ ...textInputs, ...imageInputs })) as unknown as ClipOutput;
    vectors.push(...rowsFromTensor(output.image_embeds));
    onProgress?.({ current: Math.min(start + paths.length, imagePaths.length), total: imagePaths.length });
  }
  return vectors;
}

export async function embedText(
  text: string,
  dummyImagePath: string,
  offline: boolean,
): Promise<Float32Array> {
  const runtime = await getClipRuntime(offline);
  const image = await runtime.transformers.RawImage.read(dummyImagePath);
  const imageInputs = await runtime.processor([image]);
  const textInputs = runtime.tokenizer([text], { padding: true, truncation: true });
  const output = (await runtime.model({ ...textInputs, ...imageInputs })) as unknown as ClipOutput;
  const vector = rowsFromTensor(output.text_embeds)[0];
  if (!vector) throw new OpenVideoError("processing", "CLIP returned no text embedding.");
  return vector;
}

export async function transcribeAudio(
  audioPath: string,
  durationMS: number,
  language: string | undefined,
  offline: boolean,
): Promise<CaptionCue[]> {
  await ensureWhisperModel(offline);
  const transformers = await configureTransformers();
  const transcriber = await transformers.pipeline("automatic-speech-recognition", WHISPER_MODEL.key, {
    dtype: WHISPER_MODEL.dtype,
    local_files_only: true,
  });
  const data = await readFile(audioPath);
  if (data.byteLength % 4 !== 0) {
    throw new OpenVideoError("processing", "The extracted Whisper audio buffer is not Float32-aligned.");
  }
  const audio = new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);
  const options: Record<string, unknown> = {
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: true,
  };
  if (language) options.language = language.split("-")[0];
  const raw = (await transcriber(audio, options)) as unknown;
  const result = (Array.isArray(raw) ? raw[0] : raw) as AsrOutput | undefined;
  if (!result) return [];

  const cues: CaptionCue[] = [];
  for (const chunk of result.chunks ?? []) {
    const text = chunk.text?.normalize("NFKC").replace(/\s+/gu, " ").trim();
    const start = chunk.timestamp?.[0];
    const end = chunk.timestamp?.[1];
    if (!text || start === null || start === undefined) continue;
    const startMS = Math.max(0, Math.round(start * 1_000));
    const endMS = Math.min(durationMS, Math.max(startMS + 1, Math.round((end ?? start + 5) * 1_000)));
    cues.push({ start_ms: startMS, end_ms: endMS, text });
  }
  if (cues.length === 0 && result.text?.trim()) {
    cues.push({ start_ms: 0, end_ms: durationMS, text: result.text.normalize("NFKC").trim() });
  }
  return cues;
}

