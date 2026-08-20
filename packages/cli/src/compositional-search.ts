import {
  MAX_SEARCH_WINDOW_MS,
  MIN_SEARCH_WINDOW_MS,
  RRF_K,
  TEXT_WEIGHT,
  VISUAL_WEIGHT,
} from "./constants.js";
import { OpenVideoError } from "./errors.js";
import type { MatchKind } from "./ranking.js";

export type ConstraintModality = "visual" | "text";

export interface SearchConstraintInput {
  id: string;
  modality: ConstraintModality;
  query: string;
}

export interface ConstraintEvidence {
  constraintId: string;
  modality: ConstraintModality;
  query: string;
  rank: number;
  timestampMS: number;
  segmentId: string;
  frameId?: string;
}

export interface EvidenceWindow {
  startMS: number;
  endMS: number;
  timestampMS: number;
  score: number;
  coverage: number;
  matchedConstraints: string[];
  match: MatchKind[];
  evidence: ConstraintEvidence[];
}

const CONSTRAINT_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/u;
const MAX_LOGICAL_CONSTRAINTS = 8;

export function parseSearchConstraint(value: string, modality: ConstraintModality): SearchConstraintInput {
  const separator = value.indexOf("=");
  if (separator <= 0) {
    throw new OpenVideoError("usage", `Expected ${modality} constraint in id=query form.`);
  }
  const id = value.slice(0, separator).trim();
  const query = value.slice(separator + 1).trim();
  if (!CONSTRAINT_ID_PATTERN.test(id)) {
    throw new OpenVideoError(
      "usage",
      `Constraint id '${id}' must start with a lowercase letter and contain only a-z, 0-9, '_' or '-'.`,
    );
  }
  if (!query) throw new OpenVideoError("usage", `Constraint '${id}' must have a non-empty query.`);
  return { id, modality, query };
}

export function validateSearchWindow(windowMS: number): number {
  if (!Number.isInteger(windowMS) || windowMS < MIN_SEARCH_WINDOW_MS || windowMS > MAX_SEARCH_WINDOW_MS) {
    throw new OpenVideoError(
      "usage",
      `Search window must be between ${MIN_SEARCH_WINDOW_MS / 1_000}s and ${MAX_SEARCH_WINDOW_MS / 1_000}s.`,
    );
  }
  return windowMS;
}

export function normalizeSearchConstraints(
  constraints: SearchConstraintInput[],
  mode: "hybrid" | "visual" | "text",
): SearchConstraintInput[] {
  const normalized: SearchConstraintInput[] = [];
  const seen = new Set<string>();
  for (const constraint of constraints) {
    const id = constraint.id.trim();
    const query = constraint.query.trim();
    if (!CONSTRAINT_ID_PATTERN.test(id) || !query) {
      throw new OpenVideoError("usage", `Invalid search constraint '${constraint.id}'.`);
    }
    if (mode === "text" && constraint.modality === "visual") {
      throw new OpenVideoError("usage", "Visual constraints cannot be used with --mode text.");
    }
    if (mode === "visual" && constraint.modality === "text") {
      throw new OpenVideoError("usage", "Text constraints cannot be used with --mode visual.");
    }
    const key = `${id}\u0000${constraint.modality}\u0000${query}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ id, modality: constraint.modality, query });
  }
  if (new Set(normalized.map((constraint) => constraint.id)).size > MAX_LOGICAL_CONSTRAINTS) {
    throw new OpenVideoError("usage", `A search may contain at most ${MAX_LOGICAL_CONSTRAINTS} logical constraints.`);
  }
  return normalized;
}

function modalityWeight(modality: ConstraintModality): number {
  return modality === "visual" ? VISUAL_WEIGHT : TEXT_WEIGHT;
}

function compareEvidence(left: ConstraintEvidence, right: ConstraintEvidence): number {
  return left.rank - right.rank || left.timestampMS - right.timestampMS || left.query.localeCompare(right.query);
}

function compareWindows(left: EvidenceWindow, right: EvidenceWindow): number {
  const leftSpan = Math.max(...left.evidence.map((item) => item.timestampMS)) -
    Math.min(...left.evidence.map((item) => item.timestampMS));
  const rightSpan = Math.max(...right.evidence.map((item) => item.timestampMS)) -
    Math.min(...right.evidence.map((item) => item.timestampMS));
  return right.coverage - left.coverage || right.score - left.score || leftSpan - rightSpan ||
    left.timestampMS - right.timestampMS;
}

function sameConstraintSet(left: EvidenceWindow, right: EvidenceWindow): boolean {
  return left.matchedConstraints.length === right.matchedConstraints.length &&
    left.matchedConstraints.every((value, index) => value === right.matchedConstraints[index]);
}

function overlapRatio(left: EvidenceWindow, right: EvidenceWindow): number {
  const overlap = Math.max(0, Math.min(left.endMS, right.endMS) - Math.max(left.startMS, right.startMS));
  const shorter = Math.min(left.endMS - left.startMS, right.endMS - right.startMS);
  return shorter <= 0 ? 0 : overlap / shorter;
}

/**
 * Groups independently ranked evidence into generic temporal windows. A logical
 * constraint is satisfied by either of its modalities; repeated query variants
 * in one modality contribute only their best rank.
 */
export function buildEvidenceWindows(
  evidence: ConstraintEvidence[],
  constraintOrder: string[],
  durationMS: number,
  windowMS: number,
  requireAll: boolean,
): EvidenceWindow[] {
  validateSearchWindow(windowMS);
  if (!Number.isInteger(durationMS) || durationMS <= 0) {
    throw new OpenVideoError("index", "Video duration must be a positive integer.");
  }
  const orderedIds = [...new Set(constraintOrder)];
  const allowedIds = new Set(orderedIds);
  const valid = evidence.filter(
    (item) => allowedIds.has(item.constraintId) && Number.isInteger(item.rank) && item.rank > 0 &&
      Number.isInteger(item.timestampMS) && item.timestampMS >= 0 && item.timestampMS <= durationMS,
  );
  const seeds = [...new Set(valid.map((item) => item.timestampMS))].sort((left, right) => left - right);
  const candidates: EvidenceWindow[] = [];

  for (const seed of seeds) {
    const end = Math.min(durationMS, seed + windowMS);
    const inside = valid.filter((item) => item.timestampMS >= seed && item.timestampMS <= end);
    const selected: ConstraintEvidence[] = [];
    const matchedConstraints: string[] = [];

    for (const constraintId of orderedIds) {
      const matching = inside.filter((item) => item.constraintId === constraintId);
      if (matching.length === 0) continue;
      matchedConstraints.push(constraintId);
      for (const modality of ["visual", "text"] as const) {
        const best = matching.filter((item) => item.modality === modality).sort(compareEvidence)[0];
        if (best) selected.push(best);
      }
    }
    if (selected.length === 0 || (requireAll && matchedConstraints.length !== orderedIds.length)) continue;

    const timestamps = selected.map((item) => item.timestampMS);
    const timestampMS = Math.round((Math.min(...timestamps) + Math.max(...timestamps)) / 2);
    let startMS = Math.max(0, timestampMS - Math.floor(windowMS / 2));
    let endMS = Math.min(durationMS, startMS + windowMS);
    startMS = Math.max(0, endMS - windowMS);
    const match = (["visual", "text"] as const).filter((modality) =>
      selected.some((item) => item.modality === modality));
    candidates.push({
      startMS,
      endMS: Math.max(startMS + 1, endMS),
      timestampMS,
      score: selected.reduce((total, item) => total + modalityWeight(item.modality) / (RRF_K + item.rank), 0),
      coverage: matchedConstraints.length,
      matchedConstraints,
      match,
      evidence: selected,
    });
  }

  candidates.sort(compareWindows);
  const exact = new Set<string>();
  const distinct: EvidenceWindow[] = [];
  for (const candidate of candidates) {
    const signature = candidate.evidence
      .map((item) => `${item.constraintId}:${item.modality}:${item.timestampMS}:${item.rank}:${item.query}`)
      .sort()
      .join("|");
    if (exact.has(signature)) continue;
    exact.add(signature);
    if (distinct.some((item) => sameConstraintSet(item, candidate) && overlapRatio(item, candidate) >= 0.5)) continue;
    distinct.push(candidate);
  }
  return distinct;
}
