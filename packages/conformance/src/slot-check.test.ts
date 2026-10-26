// The slot check's rules the acceptance tests reach only on the shipped table (#349): a kit two rows share
// attributes a planted fill's problem to the row that plants it; a table row no published slot names is a problem;
// and the frozen digests are checked when the caller passes none. Plus the kits a real fill must pass: a route other
// than the reference's, and a resolver that declines.
import type { ApiEntry, HubSlot } from '@deepbuild/contracts';
import { describe, expect, it } from 'vitest';
import { cleanFills, runKit, slotKits, slotProblems } from './index.js';
import type { SlotKit } from './slot-types.js';
import type { ResolverFill } from './slots/resolver.js';
import type { RouteFill } from './slots/route.js';

const SOURCE = 'deep.registerSource';
const api: ApiEntry[] = [{ method: SOURCE, variants: ['polled', 'mcp'], since: 'R2', stability: 'preview', digest: 'd1:0' }];
const kit = (slot: string): SlotKit => slotKits().find((k) => k.slot === slot)!;
const row = (variant: string, planted: string[]): HubSlot => ({ method: SOURCE, variant, interface: 'reading.source@1', digest: 'd1:0', fills: 'many', kit: 'reading.source@1', planted, since: 'R2' });
const admitting = (k: SlotKit, name: string): SlotKit => ({ ...k, planted: k.planted.map((p) => (p.name === name ? { ...p, fill: cleanFills(k)[0]! } : p)) });

describe('the slot check', () => {
  it('a kit two rows share: the fill it admits is named on the row that plants it, and not on the other', () => {
    const table = [row('polled', ['cache-as-of']), row('mcp', ['stale-mcp-digest'])];
    const problems = slotProblems(api, table, [admitting(kit('reading.source@1'), 'stale-mcp-digest')], {});
    expect(problems.filter((p) => p.variant === 'mcp' && p.fill === 'stale-mcp-digest'), JSON.stringify(problems)).not.toEqual([]);
    expect(problems.filter((p) => p.variant === 'polled' && p.fill !== null)).toEqual([]);
    expect(problems.filter((p) => p.variant === 'mcp').every((p) => p.reason.includes(', mcp')), 'each reason names its own slot').toBe(true);
  });

  it('a table row for a variant the published API doesn\'t name is a problem naming the method and the variant', () => {
    const table = [row('polled', ['cache-as-of']), row('mcp', ['stale-mcp-digest']), row('polled2', ['cache-as-of'])];
    const problems = slotProblems(api, table, [kit('reading.source@1')], {});
    expect(problems.filter((p) => p.method === SOURCE && p.variant === 'polled2'), JSON.stringify(problems)).not.toEqual([]);
  });

  it('a published register method with an empty variant list is a slot of its own: with no row for it, a problem names the method', () => {
    const table = [row('polled', ['cache-as-of']), row('mcp', ['stale-mcp-digest'])];
    const problems = slotProblems([...api, { method: 'deep.registerThing', variants: [], since: 'R2', stability: 'preview', digest: 'd1:0' }], table, [kit('reading.source@1')], {});
    expect(problems.filter((p) => p.method === 'deep.registerThing'), JSON.stringify(problems)).not.toEqual([]);
  });

  it('with no digests given, the rows are held to the contracts\' frozen digests: a row at another digest is a problem', () => {
    const table = [row('polled', ['cache-as-of']), row('mcp', ['stale-mcp-digest'])];
    const problems = slotProblems(api, table, [kit('reading.source@1')]);
    expect(problems.filter((p) => /digest/.test(p.reason)), JSON.stringify(problems)).toHaveLength(2);
  });
});

describe('the route@1 kit on a route other than the reference\'s', () => {
  it('a POST route that answers its method, refuses others with 405 and has no GET to keep idempotent passes', async () => {
    const fill: RouteFill = { slot: 'route@1', revision: 1, route: 'POST /webhook', handle: (r) => (r.method === 'POST' ? { status: 200, body: 'taken' } : { status: 405, body: 'no' }) };
    const report = await runKit(kit('route@1') as SlotKit<RouteFill>, fill, { parts: ['fixed'] });
    expect(report.verdict, JSON.stringify(report.cases)).toBe('PASS');
  });
  it('a route whose own method answers 204 passes: any success status is an answer', async () => {
    const fill: RouteFill = { slot: 'route@1', revision: 1, route: 'DELETE /cache', handle: (r) => (r.method === 'DELETE' ? { status: 204, body: '' } : { status: 405, body: 'no' }) };
    const report = await runKit(kit('route@1') as SlotKit<RouteFill>, fill, { parts: ['fixed'] });
    expect(report.verdict, JSON.stringify(report.cases)).toBe('PASS');
  });
});

describe('the resolver@1 kit on a resolver that declines', () => {
  it('a resolver that answers nothing on every ask passes: declining is not a wrong answer', async () => {
    const fill: ResolverFill = { slot: 'resolver@1', revision: 1, resolve: () => undefined };
    const report = await runKit(kit('resolver@1') as SlotKit<ResolverFill>, fill, { parts: ['fixed'] });
    expect(report.verdict, JSON.stringify(report.cases)).toBe('PASS');
  });
});
