// AC6 (its seal half): "`constraint@1` seals with the four relation entries, each passing the constraint kit; a planted
// beside that iterates to convergence, its op count changing with the gap, and one that reads its own place from the
// previous frame are each refused at the seal, naming the entry"
//
// Observed as #200's suite observes every registry: deep://registries/<core version> (`{"call": "registries"}`) lists
// the registry, its kit, its entries with their kit results and its planted entries with theirs; and the startup
// argument `--planted kit_admits_all:<registry>` (#200) gives the registry a kit that admits every entry, which the
// seal must refuse, naming the registry and each planted entry. The other half of AC6 (a keyed at.pos adds after the
// relation) is offset.test.ts. No upstream test (the oracle page: "Registries, kits and the closure rule are ours").
import { describe, expect, it } from 'vitest';
import { TIMEOUT, mentions, none, refusalOf, run, scenario, show, startup, theRegistry, useEvidence, useShowBuild } from './helpers.ts';

const build = useShowBuild();
const evidence = useEvidence();

const REGISTRY = 'constraint@1';
/** The four relation entries, the marks2d module's (the issue's Scope: "beside, edge, onto and align"). */
const RELATIONS = ['beside', 'edge', 'onto', 'align'];
/** This suite's names for the kit's two planted entries (README: names this suite chooses). */
const PLANTED = { converges: 'beside_converges', previous: 'beside_reads_previous_frame' };

describe('AC6 constraint@1 seals with the four relation entries, and its kit refuses its planted entries at the seal', () => {
  it('AC6 constraint@1 is the core\'s, filled only by canvas modules, and holds beside, edge, onto and align from marks2d, each passing every rule of the constraint kit', () => {
    const bin = build.bin();
    const s = startup(bin);
    expect(s.status, `the r2 build seals: ${s.stdout.slice(0, 800)} ${s.stderr.slice(-400)}`).toBe(0);
    const r = theRegistry(run(bin, scenario(evidence(), [{ call: 'registries' }]))[0]!, REGISTRY);
    expect(r.owner, `${REGISTRY} is declared by the core`).toBe('core');
    expect(r.fill, `${REGISTRY} is filled only by canvas modules (constraints run every frame)`).toEqual(['module']);
    // The constraint kit: runs after every read it declares; a fixed op count with no loop; seeking to 50 random times
    // equals playing, bit for bit; a two-item cycle through it refused at check, naming the chain (Constraint).
    expect(r.kit.length, `the constraint kit lists its rules (at least the design's four): ${show(r.raw['kit'])}`).toBeGreaterThanOrEqual(4);
    const failures: string[] = [];
    for (const name of RELATIONS) {
      const e = r.entries.find((x) => x.name === name);
      if (!e) { failures.push(`${REGISTRY} holds no entry ${name}; it holds ${r.entries.map((x) => x.name).join(', ') || 'none'}`); continue; }
      if (e.module !== 'marks2d') failures.push(`${name} is filled by ${e.module ?? 'no module'}, not marks2d`);
      if (e.origin !== 'first_party' || !e.since || !/^(d1:)?[0-9a-f]{64}$/.test(e.digest)) failures.push(`${name} isn't a first-party entry with since and digest: ${show(e.raw)}`);
      if (e.kit.verdict !== 'PASS') failures.push(`${name} fails the constraint kit: ${show(e.kit.raw)}`);
      const ran = new Set(e.kit.rules.map((x) => x.rule));
      for (const rule of r.kit) if (!ran.has(rule.rule)) failures.push(`${name}'s kit result has no result for the rule ${rule.rule}`);
      for (const x of e.kit.rules) if (x.verdict !== 'PASS') failures.push(`${name} fails the kit's rule ${x.rule}: ${x.message}`);
    }
    none(failures, 'the four relations pass the constraint kit');
  }, TIMEOUT);

  it('AC6 a planted beside that iterates to convergence and one that reads its own place from the previous frame are each refused by the kit at the seal, naming the entry, on rules of their own', () => {
    const bin = build.bin();
    const r = theRegistry(run(bin, scenario(evidence(), [{ call: 'registries' }]))[0]!, REGISTRY);
    const failures: string[] = [];
    const failed: Record<string, string[]> = {};
    for (const name of Object.values(PLANTED)) {
      const p = r.planted.find((x) => x.name === name);
      if (!p) { failures.push(`${REGISTRY} lists no planted entry ${name}; it lists ${r.planted.map((x) => x.name).join(', ') || 'none'}`); continue; }
      if (p.result.verdict !== 'FAIL') failures.push(`the constraint kit admits its planted entry ${name}: ${show(p.raw)}`);
      else if (!mentions(p.result.raw, name)) failures.push(`the kit refuses ${name} without naming it: ${show(p.result.raw)}`);
      failed[name] = p.result.rules.filter((x) => x.verdict === 'FAIL' && x.message !== '').map((x) => x.rule);
      if (failed[name]!.length === 0) failures.push(`the kit refuses ${name} with no failing rule's message: ${show(p.result.raw)}`);
    }
    none(failures, 'the planted entries fail the kit');
    // One loops (its op count changes with the gap), the other reads an earlier frame: no single rule refuses both
    // for the same reason, so each fails on a rule the other passes.
    const a = failed[PLANTED.converges]!; const b = failed[PLANTED.previous]!;
    expect(a.some((x) => !b.includes(x)) && b.some((x) => !a.includes(x)), `each planted entry fails a rule the other doesn't: ${PLANTED.converges} fails ${a.join(', ')}; ${PLANTED.previous} fails ${b.join(', ')}`).toBe(true);
  }, TIMEOUT);

  it('AC6 a constraint kit that admits every entry is refused at the seal (kit_admits_planted), naming constraint@1 and both planted entries', () => {
    const s = startup(build.bin(), `kit_admits_all:${REGISTRY}`);
    const r = refusalOf(s);
    expect(typeof r === 'string' ? r : '', 'the startup is the seal\'s refusal').toBe('');
    if (typeof r === 'string') return;
    expect(r.reason, `the refusal's reason: ${show(r.raw)}`).toBe('kit_admits_planted');
    expect(r.registry, 'the refusal names the registry').toBe(REGISTRY);
    for (const name of Object.values(PLANTED)) expect(mentions(r.entries, name), `the refusal names the planted entry ${name}: ${show(r.raw)}`).toBe(true);
  }, TIMEOUT);
});
