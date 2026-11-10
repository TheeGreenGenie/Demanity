import { useCallback, useEffect, useState } from 'react';

import { describeError, type Page, type Post } from '@/lib/api';

/**
 * Loads a reverse-chronological list of posts with "load more" paging.
 * `key` identifies the list; when it changes, the list reloads from the top.
 */
export function usePagedPosts(
  fetchPage: (cursor: string | null) => Promise<Page<Post>>,
  key: string,
) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  // First page: state is only set from the promise callbacks (never synchronously in the effect).
  useEffect(() => {
    let cancelled = false;
    fetchPage(null)
      .then((page) => {
        if (cancelled) return;
        setPosts(page.posts);
        setNext(page.next);
        setError(null);
      })
      .catch((err) => !cancelled && setError(describeError(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key`/`version` identify the request
  }, [key, version]);

  const loadMore = useCallback(async () => {
    if (!next) return;
    setLoading(true);
    try {
      const page = await fetchPage(next);
      setPosts((prev) => [...prev, ...page.posts]);
      setNext(page.next);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, [fetchPage, next]);

  return {
    posts,
    loading,
    error,
    hasMore: next !== null,
    loadMore,
    reload: () => setVersion((v) => v + 1),
  };
}
