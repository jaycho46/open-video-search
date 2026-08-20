export function completeEvidenceGroups(anchors, toleranceMs = 12_000) {
  if (anchors.length === 0 || anchors.some((anchor) => anchor.hits.length === 0)) return [];

  const allHits = anchors.flatMap((anchor) =>
    anchor.hits.map((hit, index) => ({
      anchor_id: anchor.id,
      rank: hit.rank ?? index + 1,
      timestamp_ms: hit.timestamp_ms,
    })),
  );
  const starts = [...new Set(allHits.map((hit) => hit.timestamp_ms))].sort((left, right) => left - right);
  const groups = [];
  const seen = new Set();

  for (const windowStart of starts) {
    const windowEnd = windowStart + toleranceMs;
    const selected = [];
    for (const anchor of anchors) {
      const candidates = allHits
        .filter(
          (hit) =>
            hit.anchor_id === anchor.id &&
            hit.timestamp_ms >= windowStart &&
            hit.timestamp_ms <= windowEnd,
        )
        .sort((left, right) => left.rank - right.rank || left.timestamp_ms - right.timestamp_ms);
      if (candidates.length === 0) break;
      selected.push(candidates[0]);
    }
    if (selected.length !== anchors.length) continue;

    const timestamps = selected.map((hit) => hit.timestamp_ms);
    const startMs = Math.min(...timestamps);
    const endMs = Math.max(...timestamps);
    const key = selected.map((hit) => `${hit.anchor_id}:${hit.timestamp_ms}`).join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    groups.push({
      start_ms: startMs,
      end_ms: endMs,
      timestamp_ms: Math.round((startMs + endMs) / 2),
      matched_constraints: selected.map((hit) => hit.anchor_id),
      rank_sum: selected.reduce((sum, hit) => sum + hit.rank, 0),
    });
  }

  return groups.sort(
    (left, right) =>
      left.rank_sum - right.rank_sum ||
      left.end_ms - left.start_ms - (right.end_ms - right.start_ms) ||
      left.start_ms - right.start_ms,
  );
}

export function overlapsInterval(group, [startMs, endMs]) {
  return group.start_ms <= endMs && group.end_ms >= startMs;
}

export function verifiedEvidenceGroups(anchors, toleranceMs = 12_000) {
  return completeEvidenceGroups(
    anchors.map((anchor) => ({
      ...anchor,
      hits: anchor.hits.filter((hit) => hit.verified === true),
    })),
    toleranceMs,
  );
}
