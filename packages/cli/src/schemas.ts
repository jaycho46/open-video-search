import { z } from "zod";

import { SCHEMA_VERSION } from "./constants.js";

export const SourceSchema = z.object({
  type: z.enum(["youtube", "local"]),
  value: z.string(),
  canonical_url: z.string().optional(),
});

export const ModelDescriptorSchema = z.object({
  id: z.string(),
  revision: z.string(),
  dtype: z.string(),
  fingerprint: z.string(),
});

export const SamplingSchema = z.object({
  interval_ms: z.int().nonnegative(),
  scene_threshold: z.number().min(0).max(1),
  max_gap_ms: z.int().positive(),
  long_edge_px: z.int().positive(),
});

export const ManifestSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  video_id: z.string(),
  fingerprint: z.string(),
  source: SourceSchema,
  title: z.string(),
  duration_ms: z.int().positive(),
  language: z.string().optional(),
  subtitle_source: z.string().optional(),
  created_at: z.iso.datetime(),
  cli_version: z.string(),
  engine_version: z.string(),
  protocol_version: z.string(),
  visual_model: ModelDescriptorSchema,
  asr_model: ModelDescriptorSchema.optional(),
  sampling: SamplingSchema,
  frame_count: z.int().nonnegative(),
  timeline_count: z.int().nonnegative(),
  warnings: z.array(z.string()).default([]),
});

export const FrameSchema = z.object({
  id: z.string(),
  timestamp_ms: z.int().nonnegative(),
  path: z.string(),
  scene_id: z.int().nonnegative(),
  source: z.string(),
  brightness: z.number(),
  sharpness: z.number(),
});

export const TimelineFrameSchema = FrameSchema.pick({
  id: true,
  timestamp_ms: true,
  path: true,
  scene_id: true,
});

export const TimelineEntrySchema = z.object({
  start_ms: z.int().nonnegative(),
  end_ms: z.int().positive(),
  subtitle: z.string(),
  scene_ids: z.array(z.int().nonnegative()),
  frames: z.array(TimelineFrameSchema),
});

export const SearchHitSchema = z.object({
  rank: z.int().positive(),
  score: z.number(),
  match: z.array(z.enum(["visual", "text"])),
  start_ms: z.int().nonnegative(),
  end_ms: z.int().positive(),
  timestamp_ms: z.int().nonnegative(),
  subtitle: z.string(),
  frames: z.array(
    TimelineFrameSchema.extend({
      path: z.string(),
    }),
  ).max(3),
  youtube_url: z.string().optional(),
});

export const SearchResponseSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  video_id: z.string(),
  query: z.string(),
  visual_query: z.string().optional(),
  mode: z.enum(["hybrid", "visual", "text"]),
  hits: z.array(SearchHitSchema),
});

export const ContextResponseSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  video_id: z.string(),
  at_ms: z.int().nonnegative(),
  start_ms: z.int().nonnegative(),
  end_ms: z.int().positive(),
  subtitle: z.string(),
  frames: z.array(TimelineFrameSchema.extend({ path: z.string() })),
  youtube_url: z.string().optional(),
});

export const TimelineChunkSchema = z.object({
  start_ms: z.int().nonnegative(),
  end_ms: z.int().positive(),
  subtitle: z.string(),
  frames: z.array(TimelineFrameSchema.extend({ path: z.string() })),
});

export const TimelineResponseSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  video_id: z.string(),
  chunk_ms: z.int().positive(),
  items: z.array(TimelineChunkSchema),
  next_cursor: z.string().nullable(),
});

export const IndexResponseSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  video_id: z.string(),
  index_directory: z.string(),
  reused: z.boolean(),
  manifest: ManifestSchema,
});

export const DoctorDependencySchema = z.object({
  name: z.string(),
  path: z.string().optional(),
  version: z.string().optional(),
  available: z.boolean(),
  supported: z.boolean(),
});

export const DoctorResponseSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  ready: z.boolean(),
  cli_version: z.string(),
  engine_version: z.string().optional(),
  protocol_version: z.string().optional(),
  dependencies: z.array(DoctorDependencySchema),
  assets: z.array(
    z.object({
      name: z.string(),
      installed: z.boolean(),
      path: z.string().optional(),
      version: z.string().optional(),
    }),
  ),
});

export const PublicSchema = z.object({
  manifest: ManifestSchema,
  timeline_entry: TimelineEntrySchema,
  index_response: IndexResponseSchema,
  search_response: SearchResponseSchema,
  context_response: ContextResponseSchema,
  timeline_response: TimelineResponseSchema,
  doctor_response: DoctorResponseSchema,
});

export type Manifest = z.infer<typeof ManifestSchema>;
export type Frame = z.infer<typeof FrameSchema>;
export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;
export type SearchResponse = z.infer<typeof SearchResponseSchema>;
export type ContextResponse = z.infer<typeof ContextResponseSchema>;
export type TimelineResponse = z.infer<typeof TimelineResponseSchema>;
export type IndexResponse = z.infer<typeof IndexResponseSchema>;
export type DoctorResponse = z.infer<typeof DoctorResponseSchema>;

