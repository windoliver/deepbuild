// AC7 #1048.2c7f09e5: "The edge values for each control kind come from the `control@1` registry's own type and range,
// so a new control kind joins without a change here. A planted kind with no declared edge values fails the kit, naming
// it."
//
// Through deep-show's registries call (#308's helpers, read only), on the full build:
// - control@1's kit lists a part `edges`; every entry declares its kind's edge values (a non-empty `edges` in its
//   value) and passes that part, so a kind brings its own edge values with its entry (README: The surface).
// - Among its planted entries, one fails the part `edges` and only that part; it declares no edge values, and the
//   kit's result for it names it.
// That the values logic.edges puts come from these entries is read in criterion 5 (the slider's 0 and the ends of its
// range); a module's new kind run through logic.edges end to end isn't covered (README: Not covered).
// The wrong programs: the base (no edges part, no edge values), a kit that passes a kind with none, a planted entry
// whose failure doesn't name it.
import { describe, expect, it } from 'vitest';
import { REGISTRIES, listedRegistry, mentions, none, run, scenario, show, useBuilds, useEvidence, type Build } from '../308/helpers.ts';
import { AC } from './helpers.ts';

const FULL: Build = { set: 'full' };
const builds = useBuilds([FULL]);
const evidence = useEvidence();
const PART = 'edges';

describe(`${AC[7]} control@1 declares each kind's edge values, and its kit refuses a kind with none`, () => {
  it(`${AC[7]} every control@1 entry declares its edge values and passes the kit's edges part; a planted kind with none fails it, named`, () => {
    const [reply] = run(builds.bin(FULL), scenario(evidence(), [REGISTRIES]));
    const l = listedRegistry(reply!, 'control@1');
    expect(l.kit, `control@1's kit lists the part ${PART}: ${l.kit.join(', ')}`).toContain(PART);
    const failures: string[] = [];
    for (const e of l.entries) {
      const edges = e.value['edges'];
      if (!Array.isArray(edges) || edges.length === 0) failures.push(`${e.name} declares no edge values: ${show(edges)}`);
      if (!e.kit.rules.some((r) => r.rule === PART && r.verdict === 'PASS')) failures.push(`${e.name} doesn't pass the part ${PART}: ${show(e.kit.raw)}`);
    }
    expect(l.entries.length, 'control@1 has entries').toBeGreaterThan(0);
    none(failures, 'control@1\'s entries');
    const planted = l.planted.find((p) => p.result.rules.some((r) => r.rule === PART && r.verdict === 'FAIL'));
    expect(planted, `a planted entry fails the part ${PART}; planted: ${l.planted.map((p) => `${p.name}: ${p.result.rules.filter((r) => r.verdict === 'FAIL').map((r) => r.rule).join('+')}`).join(', ')}`).toBeDefined();
    expect(planted!.result.rules.filter((r) => r.verdict === 'FAIL').map((r) => r.rule), `${planted!.name} fails only the part ${PART}`).toEqual([PART]);
    const declared = (planted!.raw['value'] as { edges?: unknown } | undefined)?.edges;
    expect(Array.isArray(declared) && declared.length > 0, `${planted!.name} declares no edge values: ${show(declared as never)}`).toBe(false);
    expect(mentions(planted!.result.raw, planted!.name), `the kit's result for ${planted!.name} names it: ${show(planted!.result.raw)}`).toBe(true);
  }, 7_200_000);
});
