import { describe, expect, it } from 'vitest';
import {
  decay,
  halfLifeYears,
  matchSource,
  negativeMultiplier,
  streakRequired,
  trustScore,
  wilsonLowerBound,
  type TrustCitation,
} from '../src/civic/trust.js';

/** Every number here is a worked example from docs/SCORING.md. */

const now = new Date('2026-11-10T00:00:00Z');
const cite = (over: Partial<TrustCitation> & { id: string }): TrustCitation => ({
  direction: 'positive',
  actionDate: now,
  trustAtAdd: 0.5,
  accurateYes: 9,
  accurateNo: 1,
  sourceWeight: 1,
  ...over,
});

describe('Wilson lower bound (§2)', () => {
  it('reproduces the table', () => {
    expect(wilsonLowerBound(9, 10)).toBeCloseTo(0.596, 3);
    expect(wilsonLowerBound(900, 1000)).toBeCloseTo(0.88, 3);
    expect(wilsonLowerBound(0, 0)).toBe(0);
  });
});

describe('fade and multipliers (§3.1)', () => {
  it('reproduces half-lives and negative multipliers', () => {
    expect(halfLifeYears(0.8)).toBeCloseTo(5.2, 10);
    expect(halfLifeYears(0.2)).toBeCloseTo(2.8, 10);
    expect(negativeMultiplier(0.8)).toBeCloseTo(1.3, 10);
    expect(negativeMultiplier(0.2)).toBeCloseTo(0.7, 10);
    expect(decay(halfLifeYears(0.5), 0.5)).toBeCloseTo(0.5, 10);
  });
});

describe('streak gate (§3.2)', () => {
  it('requires 5 / 3 / 1 consecutive positives at t = 0 / 0.5 / 1', () => {
    expect(streakRequired(0)).toBe(5);
    expect(streakRequired(0.5)).toBe(3);
    expect(streakRequired(1)).toBe(1);
  });

  it('counts nothing until the streak is reached, and a negative resets it', () => {
    const two = [cite({ id: 'a' }), cite({ id: 'b' })];
    const r = trustScore(two, now);
    expect(r.score).toBe(50);
    expect(r.pendingStreak).toEqual({ have: 2, need: 3 });
    const three = trustScore([...two, cite({ id: 'c' })], now);
    expect(three.score).toBeGreaterThan(50);
    expect(three.pendingStreak).toBeNull();
    const reset = trustScore(
      [
        cite({ id: 'a', actionDate: new Date('2026-01-01') }),
        cite({ id: 'b', actionDate: new Date('2026-02-01') }),
        cite({ id: 'n', direction: 'negative', actionDate: new Date('2026-03-01') }),
        cite({ id: 'c', actionDate: new Date('2026-04-01') }),
      ],
      now,
    );
    expect(reset.positives).toBe(0);
    expect(reset.pendingStreak).toEqual({ have: 1, need: 3 });
  });
});

describe('score (§3.3)', () => {
  it('reproduces the worked example: 61.25', () => {
    // Three positives with s = 0.8, one negative with s = -0.6; fresh, w = 1,
    // past the gate, negative added at t = 0.5. We feed s directly by
    // choosing vote counts whose Wilson bound we then override via weight.
    const s = (target: number) => {
      const lb = wilsonLowerBound(9, 10);
      return target / lb; // sourceWeight that turns WilsonLB into the target s
    };
    const result = trustScore(
      [
        cite({ id: 'p1', sourceWeight: s(0.8), actionDate: now }),
        cite({ id: 'p2', sourceWeight: s(0.8), actionDate: now }),
        cite({ id: 'p3', sourceWeight: s(0.8), actionDate: now }),
        cite({ id: 'n1', direction: 'negative', sourceWeight: s(0.6), actionDate: now }),
      ],
      now,
    );
    expect(result.score).toBeCloseTo(61.25, 6);
    expect(result.counted).toBe(4);
  });

  it('stays near 50 with little evidence and strictly inside 0..100', () => {
    const one = trustScore([cite({ id: 'x', trustAtAdd: 1 })], now);
    expect(one.score).toBeGreaterThan(50);
    expect(one.score).toBeLessThan(60);
    const many = trustScore(
      Array.from({ length: 200 }, (_, i) =>
        cite({ id: `n${i}`, direction: 'negative', accurateYes: 1000, accurateNo: 0 }),
      ),
      now,
    );
    expect(many.score).toBeGreaterThan(0);
  });

  it('older citations fade', () => {
    const fresh = trustScore([cite({ id: 'n', direction: 'negative' })], now).score;
    const old = trustScore(
      [cite({ id: 'n', direction: 'negative', actionDate: new Date('2016-11-10') })],
      now,
    ).score;
    expect(old).toBeGreaterThan(fresh);
  });
});

describe('approved source matching (docs/SOURCES.md)', () => {
  const domains = ['gov', 'apnews.com', 'cde.ucr.cjis.gov'];
  it('accepts approved hosts and subdomains, rejects look-alikes', () => {
    expect(matchSource('https://www.congress.gov/bill/1', domains)).toBe('gov');
    expect(matchSource('https://cde.ucr.cjis.gov/x', domains)).toBe('cde.ucr.cjis.gov');
    expect(matchSource('https://apnews.com/article/x', domains)).toBe('apnews.com');
    expect(matchSource('https://apnews.com.evil.example/x', domains)).toBeNull();
    expect(matchSource('https://notapnews.com/x', domains)).toBeNull();
    expect(matchSource('javascript:alert(1)', domains)).toBeNull();
    expect(matchSource('ftp://www.census.gov/x', domains)).toBeNull();
  });
});
