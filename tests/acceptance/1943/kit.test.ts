// #1943.9249618e, the conformance clause: the setting and machine check kinds each ship with a planted failure they
// catch, run in their conformance test on a test host, and each passes check.kind@1 (#13).
//
// Each kind's own check.kind@1 kit (hostKit, README reading 9), run on a test host by the conformance package's one
// runner as #68's kinds' kits are: the kind passes every case, fixed and seeded; the kit ships a fixture whose id starts
// `planted-`, expected `failed`, which the kind passes; the kind's own planted runner (misses-the-drift for setting,
// never-restarts for machine) fails the kit on a `planted-` case with its message, and check.kind@1's planted runners
// past-deadline and dropped-output each fail it with their own message.
import { describe, expect, test } from 'vitest';
import { runKit } from '../../../packages/conformance/src/index.ts';
import type { HostKind } from '../../../packages/checks-host/src/index.ts';
import { AC, hostChecks, listed, PLANTS, SLOT_PLANTS, world, type Vm } from './helpers.ts';

const KINDS: [HostKind, Vm][] = [['setting', 'deep-ubuntu'], ['machine', 'deep-fedora']];

describe(AC, () => {
  test.each(KINDS)('%s: passes check.kind@1 on a test host (%s), fixed and seeded, catching its planted failure; its planted runners each fail the kit with their own message', async (kind, vm) => {
    const w = await world(vm);
    const { hostFill, hostKit } = await hostChecks();
    const kit = hostKit(kind, { config: w.config, host: w.alias, folder: w.folder });
    expect(kit.slot).toBe('check.kind@1');
    const planted = kit.fixtures.filter((f) => f.id.startsWith('planted-') && (f.expected as { outcome?: unknown } | null)?.outcome === 'failed');
    expect(planted.length, `${kind}'s kit fixtures: ${kit.fixtures.map((f) => f.id).join(', ')}`).toBeGreaterThan(0);

    const report = await runKit(kit, hostFill(kind, { config: w.config }));
    expect(report.cases.some((c) => c.part === 'seeded'), `${kind}'s kit has a seeded part`).toBe(true);
    expect(report.cases.filter((c) => c.outcome !== 'PASS').map((c) => `${c.id}: ${c.outcome} ${c.message}`), `seed ${report.seed}: ${listed(report, w)}`).toEqual([]);
    expect(report.verdict).toBe('PASS');

    const messages: string[] = [];
    for (const name of [PLANTS[kind], ...SLOT_PLANTS]) {
      const p = kit.planted.find((x) => x.name === name);
      expect(p, `${kind}'s planted runners: ${kit.planted.map((x) => x.name).join(', ')}`).toBeDefined();
      expect(p!.fill.kind).toBe(kind);
      expect(p!.message.length).toBeGreaterThan(0);
      const wrong = await runKit(kit, p!.fill, { parts: ['fixed'] });
      expect(wrong.verdict, `${name} on ${kind}'s kit: ${listed(wrong, w)}`).toBe('FAIL');
      const failing = wrong.cases.filter((c) => c.outcome === 'FAIL' && c.message.includes(p!.message));
      expect(failing.length, `a FAIL carries "${p!.message}" (${listed(wrong, w)})`).toBeGreaterThan(0);
      if (name === PLANTS[kind]) expect(failing.some((c) => c.id.startsWith('planted-')), `${name} fails a planted- case of ${kind}'s kit (${listed(wrong, w)})`).toBe(true);
      messages.push(p!.message);
    }
    expect(new Set(messages).size, `each planted runner has its own message: ${messages.join(' / ')}`).toBe(messages.length);
  }, 900_000);
});
