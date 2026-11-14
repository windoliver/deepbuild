// #524.98cf72b1: "The rope bridge, banner and ball-and-goal labs run as documents and pass physics.determinism and
// physics.audit at its defaults, with no fault"
//
// The labs are documents at packs/examples/labs/rope-bridge.json, banner.json and ball-and-goal.json (README: The labs),
// each a scene in the agent's form whose world `lab` the lab runs. "Run as documents": each is read from its file,
// its world built by `deep-physics` in its scene with no error issue (the bridge holding soft ropes, the banner the
// 28 × 10 cloth `banner` addressed r{row}c{col}), and the app presents all three with no error issue. Then, per lab,
// over its first 600 steps (5 s): physics.determinism (#522's `determinism`, on the scene's world) with at_times
// [1, 2.5, 4.5] s passes with no failure; physics.audit (this suite's `audit`) given no settings runs at the design's
// defaults (energy 0.01 a second, penetration 0.01 m, the four fault kinds, soft stretch 1.1) and passes with no failure;
// and the bake of the same 600 steps writes no `fault` row. The audit is shown able to fail on the same call: a cloth
// whose stretch is 0.5 Hz, hanging from its top row, stretches far past 1.1 and fails, naming the body under `soft`.
import { describe, expect, it } from 'vitest';
import {
  AUDIT_DEFAULTS, BANNER_NU, BANNER_NV, CRITERIA, DOC, LABS, TIMEOUT, admitted, ask, auditOf, bake, builtOf, check, cleanBuilds, cloth,
  determinismOf, issuesIn, labOf, none, obj, on, particlesOf, prebuild, presented, row, rowText, rowsOf, runShow, scenario, show, showBin,
  showCall, softWorld, useTemp, type JsonObject, type Lab,
} from './helpers.ts';

prebuild();
cleanBuilds();
const temp = useTemp();
const ID = CRITERIA[1];
const NAMES: Lab[] = ['bridge', 'banner', 'goal'];
const STEPS = 600;
const AT_TIMES = [1, 2.5, 4.5];

describe(`${ID} the three labs run as documents and pass physics.determinism and physics.audit at its defaults, with no fault`, () => {
  it(`${ID} the rope bridge, banner and ball-and-goal labs are documents the physics module builds and the app presents`, () => {
    const labs = NAMES.map(labOf);
    const replies = ask(labs.map(check));
    const built = NAMES.map((n, i) => builtOf(replies[i], `the ${n} lab's world`));
    const ropes = Object.entries(built[0]!.soft).filter(([, s]) => s.shape === 'rope');
    expect(ropes.length, `the rope bridge stands on soft ropes: its built soft bodies are ${show(built[0]!.soft as unknown as JsonObject)}`).toBeGreaterThan(0);
    const flag = built[1]!.soft['banner'];
    expect(flag, `the banner lab builds the soft body banner: ${show(built[1]!.soft as unknown as JsonObject)}`).toBeDefined();
    expect([flag!.shape, flag!.particles], 'the banner is a 28 × 10 cloth').toEqual(['cloth', BANNER_NU * BANNER_NV]);
    const declared = obj(obj(labs[1]!.doc['soft'], 'the banner lab: soft')['banner'], 'the banner lab: soft.banner');
    expect([declared['nu'], declared['nv'], declared['address']], 'the banner lab declares 28 columns, 10 rows, addressed r{row}c{col}').toEqual([BANNER_NU, BANNER_NV, 'r{row}c{col}']);
    const [first] = ask([bake(labs[1]!, 1)]);
    const addresses = particlesOf(first, 'banner', 2, 'the banner lab, one step').addresses;
    expect(addresses, 'the banner\'s particles are banner#r0c0 to banner#r9c27').toEqual(expect.arrayContaining(['r0c0', 'r0c27', 'r9c0', 'r9c27']));

    const docs = NAMES.map((_, i) => DOC(i + 1));
    const shown = runShow(showBin(), scenario(temp(), docs, labs.map((l, i) => showCall(docs[i]!, l.scene!))), 'the three labs');
    shown.forEach((r, i) => {
      presented(r, `the ${NAMES[i]} lab (${LABS[NAMES[i]!]})`);
      expect(issuesIn(r, `the ${NAMES[i]} lab`).filter((x) => x['severity'] === 'error').map((x) => show(x)), `the ${NAMES[i]} lab: no error issue`).toEqual([]);
    });
  }, TIMEOUT);

  it(`${ID} physics.determinism over each lab's first 5 s, sampled at 1, 2.5 and 4.5 s, passes with no failure`, () => {
    const labs = NAMES.map(labOf);
    const replies = ask(labs.map((l) => ({ call: 'determinism', ...on(l), steps: STEPS, at_times: AT_TIMES })));
    const fails: string[] = [];
    replies.forEach((r, i) => {
      const d = determinismOf(r, `physics.determinism of the ${NAMES[i]} lab`);
      if (d.verdict !== 'PASS' || d.failures.length) fails.push(`the ${NAMES[i]} lab: ${d.verdict}, failures ${show(d.failures.map((f) => f.raw))}`);
    });
    none(fails, 'physics.determinism of the three labs');
  }, TIMEOUT);

  it(`${ID} physics.audit at its defaults passes each lab over its first 5 s with no fault, and fails a cloth stretched past 1.1, naming it`, () => {
    const labs = NAMES.map(labOf);
    const limp = { doc: softWorld({ soft: { limp: cloth([-0.5, 3, 0], [0.1, 0, 0], [0, -0.1, 0], 10, 10, { pins: row(0, 10), stretch: { hz: 0.5, damping_ratio: 1 } }) } }), id: 'limp' };
    const [control] = ask([check(limp)]);
    admitted(control, 'the cloth whose stretch is 0.5 Hz');
    const replies = ask([...labs.map((l) => ({ call: 'audit', ...on(l), steps: STEPS })), ...labs.map((l) => bake(l, STEPS)), { call: 'audit', ...on(limp), steps: STEPS }]);
    const fails: string[] = [];
    NAMES.forEach((n, i) => {
      const a = auditOf(replies[i], `physics.audit of the ${n} lab`);
      const s = a.settings;
      const defaults = [
        [obj(s['energy'] ?? {}, 'settings.energy')['max_gain'], AUDIT_DEFAULTS.energy.max_gain, 'energy.max_gain'],
        [obj(s['penetration'] ?? {}, 'settings.penetration')['max'], AUDIT_DEFAULTS.penetration.max, 'penetration.max'],
        [JSON.stringify([...((s['faults'] as string[] | undefined) ?? [])].sort()), JSON.stringify([...AUDIT_DEFAULTS.faults].sort()), 'faults'],
        [obj(s['soft'] ?? {}, 'settings.soft')['max_stretch'], AUDIT_DEFAULTS.soft.max_stretch, 'soft.max_stretch'],
      ] as const;
      for (const [got, want, key] of defaults) if (got !== want) fails.push(`the ${n} lab's audit ran with ${key} ${show(got as JsonObject[keyof JsonObject])}, not its default ${show(want)}`);
      if (a.verdict !== 'PASS' || a.failures.length) fails.push(`the ${n} lab's audit: ${a.verdict}, failures ${show(a.failures.map((f) => f.raw))}`);
      const faults = rowsOf(replies[NAMES.length + i], `the ${n} lab's bake`).filter((r) => r.kind === 'fault');
      if (faults.length) fails.push(`the ${n} lab writes faults: ${faults.slice(0, 5).map(rowText).join('; ')}`);
    });
    none(fails, 'physics.audit at its defaults, and no fault, over the three labs');
    const bad = auditOf(replies[2 * NAMES.length], 'physics.audit of the cloth whose stretch is 0.5 Hz');
    expect(bad.verdict, 'the over-stretched cloth fails the audit').toBe('FAIL');
    expect(bad.failures.filter((f) => f.rule === 'soft' && f.id === 'limp').map((f) => show(f.raw)), `a soft failure names limp: ${show(bad.failures.map((f) => f.raw))}`).not.toEqual([]);
  }, TIMEOUT);
});
