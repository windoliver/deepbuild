// AC1: each kind ships with a planted failure it catches, run in its conformance test. The planted failure is a
// fixture of the kind's own check.kind@1 kit, its id starting `planted-`, whose expected run is `failed`; the kind
// passes that case, and a runner that misses every fault fails it.
import { describe, expect, it } from 'vitest';
import { runKit } from '../../../packages/conformance/src/index.ts';
import type { CheckResult } from '../../../packages/conformance/src/index.ts';
import { caseOf, KINDS, listed, work } from './helpers.ts';

const KIT_TEST = 300_000;

describe.each(KINDS)('AC1 the %s kind ships with a planted failure it catches, run in its conformance test', (kind) => {
  it(`AC1 ${kind}: its kit's planted failure is caught by the kind and missed by a runner that reports passed on any work`, async () => {
    const w = await work();
    const kit = w.workKit(kind);
    const planted = kit.fixtures.filter((f) => f.id.startsWith('planted-') && (f.expected as { outcome?: unknown } | null)?.outcome === 'failed');
    expect(planted.length, `${kind}'s kit fixtures: ${kit.fixtures.map((f) => f.id).join(', ')}`).toBeGreaterThan(0);

    const right = await runKit(kit, w.workFill(kind), { parts: ['fixed'] });
    for (const f of planted) expect(caseOf(right, f.id)?.outcome, `the ${kind} kind on ${f.id} (${listed(right)})`).toBe('PASS');

    // The wrong program: a runner that never looks at the work.
    const passes = (): CheckResult => ({ outcome: 'passed', testsRun: 1, failures: [], evidence: [], read: [], mask: null });
    const blind = { ...w.workFill(kind), run: passes };
    const wrong = await runKit(kit, blind, { parts: ['fixed'] });
    for (const f of planted) expect(caseOf(wrong, f.id)?.outcome, `a runner that reports passed on ${f.id} (${listed(wrong)})`).toBe('FAIL');
  }, KIT_TEST);
});
