import type { PoolClient } from '@demanity/db';

/**
 * State subjects → one CRS policy area (DRAFT, REVIEW BEFORE RELEASE).
 *
 * Each subject votes for every topic whose keyword it contains (keyword table
 * `subject_category_map`). The topic with the most votes wins only if it is
 * strictly ahead of every other topic; a tie, or no matching subject, gives no
 * topic. Bill titles are never used: we only map what the state itself tagged.
 */
export function topicFromSubjects(
  subjects: string[],
  map: Array<{ keyword: string; category_slug: string }>,
): string | null {
  // Compare letters only: some states send tags with spaces removed
  // (live check, California: "Stategovernment", "Low-incomehousingtaxcredit").
  const letters = (x: string) => x.toLowerCase().replace(/[^a-z]/g, '');
  const keys = map.map((m) => ({ key: letters(m.keyword), slug: m.category_slug }));
  const votes = new Map<string, number>();
  for (const subject of subjects) {
    const s = letters(subject);
    const topics = new Set(keys.filter((m) => s.includes(m.key)).map((m) => m.slug));
    for (const t of topics) votes.set(t, (votes.get(t) ?? 0) + 1);
  }
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return null;
  if (ranked.length > 1 && ranked[0]![1] === ranked[1]![1]) return null; // ambiguous
  return ranked[0]![0];
}

/**
 * Re-applies the mapping to every bill that has stored subject tags, so
 * edits to `subject_category_map` take effect without re-fetching anything.
 * Bills whose topic was set by hand (category_auto = false with a topic) are
 * left alone.
 */
export async function remapSubjectTopics(client: PoolClient): Promise<number> {
  const { rows: map } = await client.query<{ keyword: string; category_slug: string }>(
    'SELECT keyword, category_slug FROM subject_category_map',
  );
  const { rows: topics } = await client.query<{ id: string; slug: string }>(
    "SELECT id, slug FROM communities WHERE kind = 'topic'",
  );
  const topicId = new Map(topics.map((t) => [t.slug, t.id]));
  const { rows: bills } = await client.query<{ id: string; subjects: string[] }>(
    'SELECT id, subjects FROM bills WHERE cardinality(subjects) > 0 AND (category_auto OR category_id IS NULL)',
  );
  let changed = 0;
  for (const b of bills) {
    const id = topicId.get(topicFromSubjects(b.subjects, map) ?? '') ?? null;
    const { rowCount } = await client.query(
      `UPDATE bills SET category_id = $2::uuid, category_auto = ($2::uuid IS NOT NULL)
        WHERE id = $1 AND category_id IS DISTINCT FROM $2::uuid`,
      [b.id, id],
    );
    changed += rowCount ?? 0;
  }
  return changed;
}
