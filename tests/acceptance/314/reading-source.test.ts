// AC5: deep.registerSource's polled and MCP variants fill reading.source@1, many at once, and its kit refuses two
// planted fills, each naming the fill: a source whose cached answer carries the as-of time of the cache read
// instead of the reading's own, and an MCP source called after its tool's schema digest changed.
import { describe, expect, it } from 'vitest';
import { cleans, failing, planted, PLANTED, READING_SOURCE, run, slotKit } from './helpers.ts';

const kit = slotKit(READING_SOURCE);

describe('AC5 the polled and MCP variants fill reading.source@1, many at once, and its kit refuses the two planted fills, each naming the fill', () => {
  it('AC5 the slot takes many fills, and the kit\'s reference fills are a polled source and an MCP source, both passing', async () => {
    expect(kit.fills).toBe('many');
    const variants = cleans(kit).map((f) => f.variant);
    expect(variants, `reference fills: ${variants.join(', ')}`).toEqual(expect.arrayContaining(['polled', 'mcp']));
    for (const fill of cleans(kit)) {
      const report = await run(kit, fill, { seed: 1 });
      expect(report.cases.filter((c) => c.outcome !== 'PASS').map((c) => `${c.id}: ${c.outcome} ${c.message}`), `the ${fill.variant} source passes`).toEqual([]);
    }
  }, 120_000);

  it('AC5 a source whose cached answer carries the as-of time of the cache read fails the kit, naming the fill', async () => {
    const p = planted(kit, 'cache-as-of');
    expect(p.fill.variant, 'the cached source is a polled source').toBe('polled');
    const report = await run(kit, p.fill, { seed: 1 });
    expect(report.verdict).not.toBe('PASS');
    const named = failing(report).filter((c) => c.message.includes(p.message));
    expect(named.length, `a FAIL names "${p.message}" (failures: ${failing(report).map((c) => c.message).join(' | ')})`).toBeGreaterThan(0);
    for (const c of named) expect(c.codes).toEqual(expect.arrayContaining(p.codes));
  }, 120_000);

  it('AC5 an MCP source called after its tool\'s schema digest changed fails the kit, naming the fill', async () => {
    const p = planted(kit, 'stale-mcp-digest');
    expect(p.fill.variant, 'the stale-digest source is an MCP source').toBe('mcp');
    const report = await run(kit, p.fill, { seed: 1 });
    expect(report.verdict).not.toBe('PASS');
    const named = failing(report).filter((c) => c.message.includes(p.message));
    expect(named.length, `a FAIL names "${p.message}" (failures: ${failing(report).map((c) => c.message).join(' | ')})`).toBeGreaterThan(0);
    for (const c of named) expect(c.codes).toEqual(expect.arrayContaining(p.codes));
  }, 120_000);

  it('AC5 the two refusals are each the fill\'s own: different messages, different rules, and neither carries the other\'s message', async () => {
    const [cache, digest] = PLANTED[READING_SOURCE]!.map((name) => planted(kit, name));
    expect(cache!.message).not.toBe(digest!.message);
    expect(cache!.breaks).not.toBe(digest!.breaks);
    const onCache = await run(kit, cache!.fill, { seed: 1 });
    expect(failing(onCache).some((c) => c.message.includes(digest!.message)), 'the cached source is not refused as the stale-digest one').toBe(false);
    const onDigest = await run(kit, digest!.fill, { seed: 1 });
    expect(failing(onDigest).some((c) => c.message.includes(cache!.message)), 'the stale-digest source is not refused as the cached one').toBe(false);
  }, 120_000);
});
