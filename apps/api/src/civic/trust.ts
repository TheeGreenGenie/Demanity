/**
 * Trust score v1: pure functions implementing docs/SCORING.md §2-§3
 * (approved per-category method). No I/O, so every number is reproducible
 * from the inputs and unit-tested against the document's worked examples.
 */

export const TRUST_V1 = {
  z: 1.96, // 95% Wilson interval
  baseHalfLifeYears: 4, // half-life = 4 × (0.5 + t)
  k: 5, // neutral cushion in the score denominator
  lowEvidenceBelow: 3, // counted citations
  methodVersion: 'scoring-v1',
} as const;

/** Lower bound of the Wilson score interval for k successes in n trials. */
export function wilsonLowerBound(k: number, n: number, z: number = TRUST_V1.z): number {
  if (n <= 0) return 0;
  const p = k / n;
  const z2 = z * z;
  return (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
}

/** §3.1: half-life in years for a citation added at trust t (0..1). */
export const halfLifeYears = (t: number) => TRUST_V1.baseHalfLifeYears * (0.5 + t);

/** §3.1: remaining weight after `ageYears`. */
export const decay = (ageYears: number, t: number) =>
  Math.pow(0.5, Math.max(0, ageYears) / halfLifeYears(t));

/** §3.1: negatives weigh 0.5× at t=0 up to 1.5× at t=1. Positives: 1×. */
export const negativeMultiplier = (t: number) => 0.5 + t;

/** §3.2: consecutive positives needed before any of them count. */
export const streakRequired = (t: number) => Math.ceil(1 + 4 * (1 - t) - 1e-9);

export interface TrustCitation {
  id: string;
  direction: 'positive' | 'negative';
  actionDate: Date;
  trustAtAdd: number; // t, 0..1
  accurateYes: number;
  accurateNo: number;
  sourceWeight: number; // w (source quality; bridging factor not applied yet)
}

export interface TrustResult {
  score: number; // 0..100, not rounded
  counted: number; // citations contributing (gate = 1 and accuracy votes > 0)
  positives: number;
  negatives: number;
  /** Positives waiting on the streak gate, e.g. { have: 2, need: 5 }. */
  pendingStreak: { have: number; need: number } | null;
  contributions: Array<{ id: string; x: number; gated: boolean }>;
}

const YEAR_MS = 365.25 * 86_400_000;

/**
 * §3.2 + §3.3. Citations are processed in action-date order. Positives
 * count only when their run since the last negative reaches N, where N is
 * taken from t of the first positive in the run (documented choice: the bar
 * a run must clear is set when it starts). A negative resets the run.
 */
export function trustScore(citations: TrustCitation[], now: Date): TrustResult {
  const sorted = [...citations].sort(
    (a, b) => a.actionDate.getTime() - b.actionDate.getTime() || a.id.localeCompare(b.id),
  );
  const gated = new Set<string>(); // positives that count
  let run: TrustCitation[] = [];
  const closeRun = () => {
    if (run.length > 0 && run.length >= streakRequired(run[0]!.trustAtAdd))
      for (const c of run) gated.add(c.id);
  };
  for (const c of sorted) {
    if (c.direction === 'negative') {
      closeRun();
      run = [];
    } else run.push(c);
  }
  closeRun();
  const pendingStreak =
    run.length > 0 && run.length < streakRequired(run[0]!.trustAtAdd)
      ? { have: run.length, need: streakRequired(run[0]!.trustAtAdd) }
      : null;

  let sum = 0;
  let sumAbs = 0;
  let counted = 0;
  let positives = 0;
  let negatives = 0;
  const contributions: TrustResult['contributions'] = [];
  for (const c of sorted) {
    const votes = c.accurateYes + c.accurateNo;
    const strength = wilsonLowerBound(c.accurateYes, votes);
    const isNeg = c.direction === 'negative';
    const gate = isNeg || gated.has(c.id) ? 1 : 0;
    const age = (now.getTime() - c.actionDate.getTime()) / YEAR_MS;
    const x =
      (isNeg ? -1 : 1) *
      strength *
      c.sourceWeight *
      decay(age, c.trustAtAdd) *
      gate *
      (isNeg ? negativeMultiplier(c.trustAtAdd) : 1);
    contributions.push({ id: c.id, x, gated: gate === 0 });
    if (gate === 1 && votes > 0) {
      counted++;
      if (isNeg) negatives++;
      else positives++;
    }
    sum += x;
    sumAbs += Math.abs(x);
  }
  return {
    score: 50 + (50 * sum) / (sumAbs + TRUST_V1.k),
    counted,
    positives,
    negatives,
    pendingStreak,
    contributions,
  };
}

/** True when `url` is https/http and its host is `domain` or a subdomain of it. */
export function hostMatches(url: string, domain: string): boolean {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    host = u.hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return false;
  }
  return host === domain || host.endsWith(`.${domain}`);
}

/** The most specific approved domain for a URL, or null. */
export function matchSource(url: string, domains: string[]): string | null {
  const hits = domains.filter((d) => hostMatches(url, d)).sort((a, b) => b.length - a.length);
  return hits[0] ?? null;
}
