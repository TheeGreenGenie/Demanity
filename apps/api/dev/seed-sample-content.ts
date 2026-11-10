import type { Pool } from '@demanity/db';

/**
 * DEVELOPMENT ONLY. Adds a handful of clearly labelled sample posts and
 * comments, written by the dev seed moderators, so the app isn't empty while
 * designing the UI. Every title starts with "[Sample]" and contains no
 * real-world factual claims (docs/SOURCES.md requires citations for those).
 *
 * The production guard blocks startup while dev seed accounts exist. Deleting
 * an account does NOT delete its posts (they show as "deleted account"), so
 * remove these posts first: DELETE FROM posts WHERE title LIKE '[Sample]%'.
 */

const SAMPLES: Array<{
  community: string;
  author: string;
  title: string;
  body: string;
  comments: string[];
}> = [
  {
    community: 'humanity',
    author: 'dev_mod_1',
    title: '[Sample] Volunteers cleaned up the river trail',
    body: 'A placeholder story about neighbors spending a Saturday picking up litter together. Replace with real posts once people join.',
    comments: ['[Sample] This is what Humanity is for.', '[Sample] Count me in next time.'],
  },
  {
    community: 'humanity',
    author: 'dev_mod_2',
    title: '[Sample] A stranger returned my lost wallet',
    body: 'Sample text: small acts of honesty deserve to be noticed. Humanity posts get kudos, never dislikes.',
    comments: ['[Sample] Faith in people restored.'],
  },
  {
    community: 'humanity',
    author: 'dev_mod_1',
    title: '[Sample] Two neighbors who vote differently built a fence together',
    body: 'Placeholder for the kind of common-ground story this section exists to highlight.',
    comments: [],
  },
  {
    community: 'health',
    author: 'dev_mod_2',
    title: '[Sample] What would make local clinics easier to use?',
    body: 'Sample discussion prompt. Opinions are welcome; factual claims should cite an approved source.',
    comments: [
      '[Sample] Evening hours would help shift workers.',
      '[Sample] Clearer pricing up front.',
    ],
  },
  {
    community: 'education',
    author: 'dev_mod_1',
    title: '[Sample] How should schools communicate with parents?',
    body: 'Sample prompt for a respectful discussion.',
    comments: ['[Sample] One weekly summary instead of many messages.'],
  },
  {
    community: 'california',
    author: 'dev_mod_2',
    title: '[Sample] Local conversation thread for California',
    body: 'Location communities hold discussion about a place. Legislation for each state arrives in Phase 3.',
    comments: [],
  },
  {
    community: 'immigration',
    author: 'dev_mod_1',
    title: '[Sample] Ground rules for this community',
    body: 'Sample post: debate ideas, not people. Hate and harassment are removed, and every removal appears in the public moderation log.',
    comments: ['[Sample] Agreed. Let’s keep it civil.'],
  },
];

export async function seedSampleContent(
  pool: Pool,
): Promise<{ created: number; skipped: boolean }> {
  const { rows: existing } = await pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM posts WHERE title LIKE '[Sample]%'",
  );
  if ((existing[0]?.n ?? 0) > 0) return { created: 0, skipped: true };

  const { rows: authors } = await pool.query<{ id: string; username: string }>(
    `SELECT a.id, a.username FROM accounts a JOIN dev_seed_accounts s ON s.account_id = a.id
      WHERE a.username IN ('dev_mod_1', 'dev_mod_2')`,
  );
  const byName = new Map(authors.map((a) => [a.username, a.id]));
  if (byName.size < 2)
    throw new Error(
      'Run seed:dev-moderators first (sample content is written by dev_mod_1/dev_mod_2).',
    );

  let created = 0;
  for (const s of SAMPLES) {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO posts (community_id, author_id, title, body)
       SELECT c.id, $2, $3, $4 FROM communities c WHERE c.slug = $1 RETURNING id`,
      [s.community, byName.get(s.author), s.title, s.body],
    );
    const postId = rows[0]!.id;
    created++;
    for (const [i, body] of s.comments.entries()) {
      await pool.query('INSERT INTO comments (post_id, author_id, body) VALUES ($1, $2, $3)', [
        postId,
        byName.get(i % 2 === 0 ? 'dev_mod_2' : 'dev_mod_1'),
        body,
      ]);
    }
  }
  return { created, skipped: false };
}
