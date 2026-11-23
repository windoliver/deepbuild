// AC5 #953.7fa9a285: "The interface's planted library fails one of its fixtures, or the pack is refused, naming the
// interface; and 2,000 total reads a step over a 500-node tree stay under the casual class's step ceiling, measured in
// the scheduled budget window on a reference Mac at the merged commit against its merge base; the PR says `Part of
// #953` until that window closes the issue; unmeasured, or before #546's ceiling exists, it is never PASS"
//
// Through `deep-logic first_party`, `check`, `pack_check`, `bake`, `budget` and `about` (README: The surface).
// - Each planted library mods.lib@1 ships, read from the first-party pack, carried as `planted_mods@1` claiming
//   mods.lib@1 (with the trivial own fixture any library of these exports passes) on the item of the interface's first
//   fixture: `link_refused`, a refusal naming mods.lib@1 and one of its fixtures. A copy of the interface's entry with
//   no planted library (pack modscopy@1.0.0) is `pack_refused` naming the interface; the same copy with the interface's
//   own planted libraries (modscopy@1.0.1) installs.
// - The step ceiling (README: Readings): "the casual class" is the figure class, the class `deep-logic` holds a piece
//   to when it names none (no class is called casual); its ceiling is #546's, in fuel, so it holds on any host. A seeded
//   500-node tree of 2,000 rows (seeds.json `budget`; model.ts: largePlan) in a figure piece: 60 steps, each one seeded
//   edit then total(node, stat) for every node and four stats, 2,000 reads, every one the brute-force recompute's.
//   logic.budget on [app] reads PASS with no failure, holds the item to an app ceiling that is the figure class's at
//   60 Hz from the merge base's metering record (⌊4,000,000 × 0.75 ÷ ns per fuel⌋), and every step's fuel is at or
//   under it. Off the reference Mac (macOS arm64), or with the merge base's record unreadable, the test then fails
//   INCONCLUSIVE, never passes. The budget window's own record is the window's (README: Not covered).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TIMEOUT, arr, int, isObject, logicBin, num, obj, prebuild, refusedOf, show, type JsonObject } from '../190/helpers.ts';
import { pack, packCheckCall, packJson, refusalWhere } from '../416/interfaces/helpers.ts';
import {
  AC, IFACE, bakeCall, bytesOf, checkCall, inconclusive, judge, libEntry, linkOf, mergeBaseMetering, modsPack, onReferenceMac, piece, run, type Assets,
} from './helpers.ts';
import { STATS, largePlan, seededCase } from './model.ts';

prebuild(() => { logicBin(); });

const SEEDS = JSON.parse(readFileSync(new URL('./seeds.json', import.meta.url), 'utf8')) as { budget: { seed: number; nodes: number; rows: number; edits: number } };
/** The figure class's frame CPU (Budget classes), in ns, and #546's share of it a step may take. */
const FIGURE_NS = 4_000_000;

describe(`${AC[5]} the interface's planted library, and reads within the step ceiling`, () => {
  it(`${AC[5]} the interface's planted library fails one of its fixtures, or the pack is refused, naming the interface`, () => {
    const m = modsPack();
    expect(m.iface.planted.length, 'mods.lib@1 ships a planted library').toBeGreaterThan(0);
    const fixture = obj(JSON.parse(bytesOf(m.assets, m.iface.fixtures[0]!).toString('utf8')), `fixture ${m.iface.fixtures[0]}`);
    const params = obj(obj(fixture['item'], 'the fixture\'s item')['params'], 'the fixture item\'s params');
    const calls = m.iface.planted.map((id) => {
      const bytes = bytesOf(m.assets, id);
      const lib = libEntry('planted_mods@1', { name: id.slice(0, 12), bytes, b64: bytes.toString('base64'), sha: id }, [IFACE]);
      const assets: Assets = { ...m.assets };
      const packs = [packJson(pack('modsplants', [lib], '1.0.0', 'installed'), assets)];
      return checkCall({
        seed: 0, packs, items: { fixture: { kind: 'logic@1', params: { ...params, links: [{ name: 'planted_mods@1', asset: id }] } } }, assets,
        ...(fixture['controls'] !== undefined ? { controls: fixture['controls'] } : {}),
      });
    });
    run(calls).forEach((reply, i) => {
      const r = refusedOf(reply, `the check of mods.lib@1's fixture item linking planted library ${m.iface.planted[i]} as planted_mods@1 claiming ${IFACE}`);
      expect(r.code, 'the planted library is refused at link').toBe('link_refused');
      const named = refusalWhere(r.refusals, (x) => x['interface'] === IFACE && m.iface.fixtures.includes(String(x['fixture'])), `a refusal names ${IFACE} and the fixture of it the planted library fails`);
      expect(named['library'], 'and the library').toBe('planted_mods@1');
    });

    const entry = (planted: string[]) => ({ exports: m.iface.exports, ...(m.iface.layout ? { layout: m.iface.layout } : {}), fixtures: m.iface.fixtures, planted, digest: m.iface.digest });
    const [bare, whole] = run([
      packCheckCall(pack('modscopy', [], '1.0.0', 'installed', { [IFACE]: entry([]) }), m.assets),
      packCheckCall(pack('modscopy', [], '1.0.1', 'installed', { [IFACE]: entry(m.iface.planted) }), m.assets),
    ]);
    const r = refusedOf(bare!, 'the pack check of modscopy@1.0.0, mods.lib@1 without its planted library');
    expect([r.code, r.pack], 'the pack is refused').toEqual(['pack_refused', 'modscopy@1.0.0']);
    refusalWhere(r.refusals, (x) => x['interface'] === IFACE || x['interface'] === `modscopy.${IFACE}`, 'a refusal names the interface mods.lib@1');
    expect([whole!['ok'], whole!['installed'], whole!['pack']], `with the interface's own planted libraries the copy installs: ${show(whole)}`).toEqual([true, true, 'modscopy@1.0.1']);
  }, TIMEOUT);

  it(`${AC[5]} 2,000 total reads a step over a 500-node tree stay under the casual class's step ceiling on a reference Mac, against its merge base; unmeasured or with no ceiling it is never PASS`, () => {
    const c = seededCase(SEEDS.budget.seed, { minNodes: SEEDS.budget.nodes, maxNodes: SEEDS.budget.nodes, minRows: SEEDS.budget.rows, maxRows: SEEDS.budget.rows, edits: SEEDS.budget.edits, attached: 1 });
    expect([c.nodes, c.attaches.length, c.adds.length], 'a 500-node tree, every node attached, with 2,000 rows').toEqual([500, 500, 2000]);
    const plan = largePlan(c);
    const edits = plan.steps.map((s, k) => [s, k] as const).filter(([s]) => s.note.startsWith('edit '));
    expect(edits.length, 'sixty steps each read 2,000 totals after an edit').toBe(SEEDS.budget.edits);
    for (const [s] of edits) expect(s.reads, 'every node\'s four stats').toEqual([{ first: 0, count: 500 }]);
    const reads = c.nodes * STATS.length;
    expect(reads).toBe(2000);
    const { module, link } = linkOf('ref');
    const p = piece({ tree: { plan, nodes: c.nodes, reads, module, link } }, [], 'figure');
    const steps = plan.steps.length;
    const [about, bake, budget] = run([{ call: 'about' }, bakeCall(p, steps), { call: 'budget', piece: p, track: [], steps, fuel_share: 1, on: ['app'] }]);
    const wrong = judge(bake!, [{ item: 'tree', label: `the 500-node tree ${c.seed}`, plan, nodes: c.nodes }], 'the 500-node bake');
    expect(wrong.map((w) => w.message), 'every total read is the brute-force recompute\'s').toEqual([]);

    expect([budget!['ok'], budget!['kind']], `logic.budget ran: ${show(budget)}`).toEqual([true, 'logic.budget']);
    const report = isObject(budget!['report']) && isObject(budget!['report']['items']) ? budget!['report']['items'] : {};
    const held = isObject(report['tree']) && isObject(report['tree']['ceiling']) ? report['tree']['ceiling']['app'] : undefined;
    expect(typeof held, `#546's ceiling exists: logic.budget holds the item to an app ceiling (report.items.tree.ceiling.app): ${show(budget)}`).toBe('number');
    const ceiling = held as number;
    expect(budget!['verdict'], `logic.budget on [app] reads PASS: ${show(budget!['failures'])}`).toBe('PASS');
    expect(arr(budget!['failures'], 'logic.budget.failures'), 'with no failure').toEqual([]);
    const fuel = arr(bake!['steps'], 'the bake\'s steps').map((s, i) => {
      const o = obj(s, `steps[${i}]`);
      return { step: int(o['step'], 'step'), fuel: int(obj(obj(o['items'], 'items')['tree'], 'items.tree')['fuel'], `the fuel of step ${o['step']}`) };
    });
    const over = fuel.filter((f) => f.fuel > ceiling);
    expect(over, `no step's fuel passes the ceiling ${ceiling}`).toEqual([]);
    const busiest = Math.max(...edits.map(([, k]) => fuel.find((f) => f.step === k)?.fuel ?? Infinity));
    expect(busiest, 'the busiest edit step, 2,000 reads, is within it').toBeLessThanOrEqual(ceiling);

    // Against the merge base: the ceiling is the figure class's at 60 Hz from the merge base's metering record.
    const base = mergeBaseMetering();
    if (typeof base === 'string') return inconclusive(`the steps fit ${ceiling} fuel (the busiest ${busiest}), but ${base}`);
    const nsApp = num(obj((about as JsonObject)['ns_per_fuel'], 'about.ns_per_fuel')['app'], 'about.ns_per_fuel.app');
    expect(nsApp, `the build's ns per fuel unit is the merge base's (${base.rev.slice(0, 12)})`).toBe(base.nsPerFuelApp);
    expect(ceiling, 'the ceiling is the figure class\'s at 60 Hz: ⌊4,000,000 × 0.75 ÷ ns per fuel⌋').toBe(Math.floor((FIGURE_NS * 0.75) / base.nsPerFuelApp));
    if (!onReferenceMac()) inconclusive(`the steps fit the figure class's ceiling ${ceiling} (the busiest ${busiest} fuel), but this host is ${process.platform}/${process.arch}, not the reference Mac (macOS arm64)`);
  }, TIMEOUT);
});
