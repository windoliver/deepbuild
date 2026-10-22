// #28 AC27: a reference verdict function in test code agrees with the engine on 10,000 seeded generated claims,
// and the properties listed in How runs become one of five verdicts (One table, one reference) hold. Planted
// engines (pending ranked below PASS, results keyed by commit alone, and the others the design lists) fail the
// same comparison, naming the generated case.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { openItemId, verdict } from '../../../packages/verdicts/src/index.ts';
import type { ClaimCheck, ClaimInput, Result } from '../../../packages/verdicts/src/index.ts';
import { genClaim, GLOBS, PATHS, reorder } from './generate.ts';
import { referenceVerdict, type Planted, type RefVerdict } from './reference.ts';
import { check, claim, commitOf, highest, RANK, RESULTS, reqId, requirement, run, sameSet } from './helpers.ts';

const AGREE_SEED = process.env.AC28_SEED ? Number(process.env.AC28_SEED) : 0x2827_0001;
const AGREE_RUNS = 10_000;
const RUNS = 1000;
const SEEDS = fc.integer({ min: 0, max: 2 ** 31 - 1 });

type Comparable = { outcome: Result; checks: readonly { check: string; outcome: Result; counted: readonly string[] }[] };
/** The first difference between two verdicts on one claim, naming the case; null when they agree. */
function disagreement(seed: number, c: ClaimInput, got: Comparable, want: RefVerdict): string | null {
  const name = `seed ${seed}, ${c.claim}`;
  if (got.outcome !== want.outcome) return `${name}: outcome ${got.outcome}, the reference ${want.outcome}`;
  for (const w of want.checks) {
    const g = got.checks.find((r) => r.check === w.check);
    if (!g) return `${name}: no result for check ${w.check}`;
    if (g.outcome !== w.outcome) return `${name}: check ${w.check} ${g.outcome}, the reference ${w.outcome}`;
    if (!sameSet(g.counted, w.counted)) return `${name}: check ${w.check} counted [${[...g.counted].sort().join(', ')}], the reference [${[...w.counted].sort().join(', ')}]`;
  }
  return null;
}

describe('AC27 the reference agrees with the engine', () => {
  it(`AC27 on ${AGREE_RUNS.toLocaleString('en-US')} seeded generated claims (seed ${AGREE_SEED})`, () => {
    fc.assert(fc.property(SEEDS, (seed) => {
      const c = genClaim(seed);
      expect(disagreement(seed, c, verdict(c), referenceVerdict(c))).toBeNull();
    }), { seed: AGREE_SEED, numRuns: AGREE_RUNS });
  });
  for (const planted of ['pending-below-pass', 'commit-only', 'first-match', 'never-started-as-ran-nothing', 'leave-out-never-started'] as Planted[]) {
    it(`AC27 a planted engine (${planted}) fails the same comparison, naming the generated case`, () => {
      const out = fc.check(fc.property(SEEDS, (seed) => {
        const c = genClaim(seed);
        return disagreement(seed, c, referenceVerdict(c, planted), referenceVerdict(c)) === null;
      }), { seed: AGREE_SEED, numRuns: AGREE_RUNS });
      expect(out.failed, `${planted} is caught`).toBe(true);
      const seed = out.counterexample![0];
      const c = genClaim(seed);
      expect(disagreement(seed, c, referenceVerdict(c, planted), referenceVerdict(c))).toContain(`seed ${seed}`);
    });
  }
});

describe('AC27 the properties of One table, one reference', () => {
  it(`AC27 for ${RUNS} claims, the verdict is one of the five or pending, and doesn't change when records arrive in another order or one arrives twice`, () => {
    fc.assert(fc.property(SEEDS, (seed) => {
      const c = genClaim(seed);
      const v = verdict(c), w = verdict(reorder(c, seed));
      expect(RESULTS).toContain(v.outcome);
      expect(disagreement(seed, c, w, { outcome: v.outcome, stale: v.stale, checks: v.checks.map((r) => ({ ...r, inherited: r.inherited, never_started: r.never_started })), requirements: [] })).toBeNull();
      expect([...w.open_items.map((i) => i.id)].sort(), `seed ${seed}: the same open items`).toEqual([...v.open_items.map((i) => i.id)].sort());
    }), { seed: 0x2827_0002, numRuns: RUNS });
  });
  it(`AC27 for ${RUNS} claims, the verdict is the highest by precedence of what applies`, () => {
    fc.assert(fc.property(SEEDS, (seed) => {
      const c = genClaim(seed);
      const v = verdict(c);
      const applies: Result[] = [...v.checks.map((r) => r.outcome), ...v.requirements.map((r) => r.outcome)];
      if (!c.checks.length) applies.push('INVALID');
      expect(v.outcome, `seed ${seed}`).toBe(highest(applies));
    }), { seed: 0x2827_0003, numRuns: RUNS });
  });
  it(`AC27 for ${RUNS} claims, never PASS while a check is pending, never started, ran nothing or can't fail, or a requirement lacks a check at its depth, or has only the agent's own`, () => {
    const DEPTH = { unit: 0, integration: 1, journey: 2, live: 3 } as const;
    fc.assert(fc.property(SEEDS, (seed) => {
      const c = genClaim(seed);
      const v = verdict(c);
      if (v.outcome !== 'PASS') return;
      const name = `seed ${seed}, ${c.claim} passed`;
      expect(v.checks.filter((r) => r.outcome === 'pending'), name).toEqual([]);
      expect(c.checks.filter((k) => k.state === 'never_started' || k.cant_fail), name).toEqual([]);
      const counted = new Set(v.checks.flatMap((r) => r.counted));
      expect(c.runs.filter((r) => counted.has(r.run) && r.outcome === 'ran_nothing'), name).toEqual([]);
      for (const q of c.requirements.filter((x) => x.oracle !== 'person')) {
        const atDepth = c.checks.filter((k) => k.covers.includes(q.req) && DEPTH[k.depth] >= DEPTH[q.depth]);
        expect(atDepth.some((k) => k.source !== 'own'), `${name}: ${q.req} has a check at its depth that isn't the agent's own`).toBe(true);
      }
    }), { seed: 0x2827_0004, numRuns: RUNS });
  });
  it(`AC27 for ${RUNS} claims, once a verdict other than PASS is made, results of runs already started only raise it`, () => {
    let landed = 0;
    fc.assert(fc.property(SEEDS, fc.array(fc.constantFrom('passed', 'failed') as fc.Arbitrary<'passed' | 'failed'>, { maxLength: 3 }), (seed, outcomes) => {
      const c = genClaim(seed);
      const before = verdict(c);
      const running = c.checks.filter((k) => k.state === 'running');
      if (before.outcome === 'PASS' || before.outcome === 'pending' || !running.length) return;
      landed++;
      const runs = [...c.runs, ...running.flatMap((k) => outcomes.map((o, i) => run(k, c.commit, o, { run: `run:L${seed}${k.check}${i}` })))];
      const after = verdict({ ...c, runs, checks: c.checks.map((k) => (k.state === 'running' ? { ...k, state: 'ended' as const } : k)) });
      expect(RANK[after.outcome], `seed ${seed}: ${before.outcome} became ${after.outcome}`).toBeGreaterThanOrEqual(RANK[before.outcome]);
    }), { seed: 0x2827_0005, numRuns: RUNS });
    expect(landed, 'the property reached claims with results still landing').toBeGreaterThan(50);
  });
  it(`AC27 for ${RUNS} claims, a check that never started keeps its claim from passing and is never read as one that ran nothing`, () => {
    fc.assert(fc.property(SEEDS, fc.constantFrom('quick_check_failed', 'kept_working', 'loop', 'newer_claim') as fc.Arbitrary<NonNullable<ClaimCheck['never_started']>>, (seed, cause) => {
      const g = genClaim(seed);
      if (!g.checks.length) return;
      const first = g.checks[0]!;
      const c = { ...g, checks: [{ ...first, state: 'never_started' as const, never_started: cause }, ...g.checks.slice(1)], runs: g.runs.filter((r) => r.check !== first.check) };
      const v = verdict(c);
      const r = v.checks.find((x) => x.check === first.check)!;
      expect(r, `seed ${seed}`).toMatchObject({ outcome: 'pending', never_started: true, counted: [] });
      expect(v.outcome, `seed ${seed}, ${c.claim}`).not.toBe('PASS');
      expect(v.open_items.filter((i) => i.check === first.check), `seed ${seed}: no open item for it`).toEqual([]);
    }), { seed: 0x2827_0006, numRuns: RUNS });
  });
  it(`AC27 for ${RUNS} cases, a result never carries across a different commit, check digest, environment profile or tool version, and always carries when none of those nor its inputs changed and its evidence is kept`, () => {
    type Mutation = 'none' | 'no-change' | 'digest' | 'environment' | 'tools' | 'evidence' | 'input' | 'read';
    const mutations: Mutation[] = ['none', 'no-change', 'digest', 'environment', 'tools', 'evidence', 'input', 'read'];
    fc.assert(fc.property(fc.constantFrom(...GLOBS), fc.constantFrom(...GLOBS), fc.constantFrom(...mutations), fc.integer({ min: 0, max: 9 }), (mine, other, mutation, n) => {
      fc.pre(mine !== other);
      const C = commitOf(`carry-C${n}`), D = commitOf(`carry-D${n}`);
      const x = check('X', { inputs: [mine], covers: [reqId(1)] });
      const y = check('Y', { inputs: [other], covers: [reqId(2)] });
      const inOther = PATHS.find((p) => new RegExp(`^${other.replace('/**', '/')}`).test(p))!;
      const inMine = PATHS.find((p) => new RegExp(`^${mine.replace('/**', '/')}`).test(p))!;
      const old = run(x, C, 'passed', { reads: mutation === 'read' ? [inOther] : [] });
      if (mutation === 'digest') old.digest = 'd1:' + 'f'.repeat(64);
      if (mutation === 'environment') old.environment = { ...old.environment, viewport: '1440x900' };
      if (mutation === 'tools') old.tools = { ...old.tools, node: '20.18.0' };
      if (mutation === 'evidence') old.kept = false;
      const paths = mutation === 'input' ? [inMine] : [inOther];
      const c = claim({ commit: D, requirements: [requirement(1), requirement(2)], checks: [x, y], runs: [old], changes: mutation === 'no-change' ? [] : [{ from: C, paths }] });
      const counted = verdict(c).checks.find((r) => r.check === 'X')!.counted;
      expect(counted.includes(old.run), `${mutation}: X declares ${mine}, D changes ${paths.join(', ')}`).toBe(mutation === 'none');
    }), { seed: 0x2827_0007, numRuns: RUNS });
  });
  it(`AC27 for ${RUNS} cases, the same open item raised twice has one ID, and items with different scopes have two`, () => {
    const words = fc.array(fc.stringMatching(/^[a-z0-9]{1,8}$/), { minLength: 1, maxLength: 6 });
    fc.assert(fc.property(words, fc.constantFrom('R1', 'R2', null), fc.constantFrom('R1', 'R2', null), fc.constantFrom('shop', 'blog'), (ws, a, b, repo) => {
      const text = ws.join(' ');
      const scope = { repo, task: 'task:01K74FX2B4D6F8H0K2M4P6R8T0', req: a && reqId(Number(a.slice(1))) };
      const variant = ws.map((w) => w.toUpperCase()).join(' \t  ') + '.';
      expect(openItemId(variant, scope), `"${variant}" is "${text}" normalized`).toBe(openItemId(text, scope));
      const other = { ...scope, req: b && reqId(Number(b.slice(1))) };
      if (a !== b) expect(openItemId(text, other), `${String(a)} and ${String(b)} are two scopes`).not.toBe(openItemId(text, scope));
      expect(openItemId(text, { ...scope, task: 'task:01K74FX2B4D6F8H0K2M4P6R8T1' })).not.toBe(openItemId(text, scope));
    }), { seed: 0x2827_0008, numRuns: RUNS });
    expect(openItemId('café crashes', { repo: 'shop', task: 'task:T1', req: null })).toBe(openItemId('café crashes', { repo: 'shop', task: 'task:T1', req: null }));
  });
});
