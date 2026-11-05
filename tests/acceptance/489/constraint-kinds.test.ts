// Criterion 1: "Every constraint kind seals as an entry of `constraint@1` and passes the constraint kit: on a fixture
// of each motion kind, seeking to 50 random times equals playing bit for bit and the op count is the same at every
// time, and a two-item cycle through it is refused at check, naming the chain; the seal refuses a planted kind that
// iterates to convergence, its op count varying with its input, and one that reads its own output from the previous
// frame, each naming the kind; and motion's interface digest is the same in a build with the data module as in one
// without"
//
// Three surfaces. `deep-show run` (the full build set): deep://registries (`{"call": "registries"}`, #200) lists
// constraint@1 with each entry's kit result; the startup argument `--planted <name>` (#221's form) gives motion a
// planted solve the seal must refuse; deep://schedule (`{"call": "schedule"}`, #185) names each interface's digest,
// compared between `full` and `full,test-leave-out-data` (a test build without the data module, README: Test
// features). And `deep-motion eval` on this suite's own fixture of each motion kind whose fields the design gives in
// full (child_of, look_at, copy, limit, reach2, distance): 50 random times seeked against played, bit for bit, the
// frame's `constraints.<id>.ops` the same at every time, and a two-item cycle refused, naming both items. No
// upstream test (oracle page: "Registries, kits and the closure rule are ours").
import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, constraintAt, evalAll, evalOk, film, fl, int, keyed, mentions, none, obj, rect, refusal, runShow, scenario, sealRefusal, seekPlayFailures,
  seededTimes, show, startup, str, theRegistry, useEvidence, useMotion, useShow, type JsonObject,
} from './helpers.ts';

const FULL = 'full';
const NO_DATA = 'full,test-leave-out-data';
const shows = useShow([FULL, NO_DATA]);
const motion = useMotion();
const evidence = useEvidence();

/** The issue's ten motion kinds (Scope: "motion fills child_of, follow_path, look_at, copy, limit, reach2, follow_tip, distance, spring_chain and rest_on"). */
const MOTION_KINDS = ['child_of', 'follow_path', 'look_at', 'copy', 'limit', 'reach2', 'follow_tip', 'distance', 'spring_chain', 'rest_on'];
/** This suite's names for the two planted solves given at startup (README: Choices where the issue is open). */
const PLANTED = { iterates: 'constraint_iterates_to_convergence', previous: 'constraint_reads_previous_output' };

// ---- this suite's fixtures: `ping` moves on keyed x and y; `pong` is constrained to it

const moving = (): JsonObject => ({
  px: keyed('items/ping/at/pos/0', { k0: { t: '0s', value: 40, interp: 'linear' }, k1: { t: '1.5s', value: 260, interp: 'linear' }, k2: { t: '3s', value: 120, interp: 'linear' } }),
  py: keyed('items/ping/at/pos/1', { k0: { t: '0s', value: 60, interp: 'linear' }, k1: { t: '2s', value: 220, interp: 'linear' }, k2: { t: '3s', value: 90, interp: 'linear' } }),
});
const pair = (id: string, constraints: JsonObject, extra: JsonObject[] = []): JsonObject =>
  film(id, [rect('ping', [40, 60]), rect('pong', [150, 150]), ...extra], { channels: moving(), constraints }, { span: '3s' });
const FIXTURES: Record<string, { doc: JsonObject; id: string; owner: string }> = {
  child_of: { doc: pair('kind-child-of', { c: { owner: 'pong', kind: 'child_of', parent: 'ping' } }), id: 'c', owner: 'pong' },
  look_at: { doc: pair('kind-look-at', { c: { owner: 'pong', kind: 'look_at', target: 'ping', axis: [1, 0, 0] } }), id: 'c', owner: 'pong' },
  copy: { doc: pair('kind-copy', { c: { owner: 'pong', kind: 'copy', what: 'location', target: 'ping' } }), id: 'c', owner: 'pong' },
  limit: { doc: pair('kind-limit', { c: { owner: 'ping', kind: 'limit', what: 'location', bounds: [[80, 200], null, null] } }), id: 'c', owner: 'ping' },
  reach2: {
    doc: pair('kind-reach2', { c: { owner: 'upper', kind: 'reach2', chain: ['upper', 'lower', 'end'], target: 'ping', bend: 1, stretch: 'cartoon' } },
      [rect('upper', [150, 140]), rect('lower', [60, 0], { parent: 'upper' }), rect('end', [40, 0], { parent: 'lower' })]),
    id: 'c', owner: 'end',
  },
  distance: { doc: pair('kind-distance', { c: { owner: 'pong', kind: 'distance', target: 'ping', min: 20, max: 60 } }), id: 'c', owner: 'pong' },
};
const CYCLES: Record<string, JsonObject> = {
  child_of: { a: { owner: 'pong', kind: 'child_of', parent: 'ping' }, b: { owner: 'ping', kind: 'child_of', parent: 'pong' } },
  look_at: { a: { owner: 'pong', kind: 'look_at', target: 'ping', axis: [1, 0, 0] }, b: { owner: 'ping', kind: 'look_at', target: 'pong', axis: [1, 0, 0] } },
  copy: { a: { owner: 'pong', kind: 'copy', what: 'location', target: 'ping' }, b: { owner: 'ping', kind: 'copy', what: 'location', target: 'pong' } },
  distance: { a: { owner: 'pong', kind: 'distance', target: 'ping', min: 20, max: 60 }, b: { owner: 'ping', kind: 'distance', target: 'pong', min: 20, max: 60 } },
};
const TIMES = seededTimes(489_01, 50, 0, fl(3));

describe('criterion 1: every constraint kind is an entry of constraint@1, passes the constraint kit, and the seal refuses the planted kinds', () => {
  it('criterion 1: constraint@1 holds motion\'s ten kinds, each motion\'s first-party entry passing every rule of the constraint kit, and motion fills no other module\'s kind', () => {
    const bin = shows.bin(FULL);
    expect(startup(bin).status, 'the full build seals').toBe(0);
    const r = theRegistry(runShow(bin, scenario([{ call: 'registries' }], evidence()))[0]!, 'constraint@1');
    expect(r.owner, 'constraint@1 is the core\'s').toBe('core');
    expect(r.fill, 'only canvas modules fill it').toEqual(['module']);
    const failures: string[] = [];
    for (const name of MOTION_KINDS) {
      const e = r.entries.find((x) => x.name === name);
      if (!e) { failures.push(`constraint@1 holds no entry ${name}; it holds ${r.entries.map((x) => x.name).join(', ') || 'none'}`); continue; }
      if (e.module !== 'motion') failures.push(`${name} is filled by ${e.module ?? 'no module'}, not motion`);
      if (e.origin !== 'first_party') failures.push(`${name} isn't first-party: ${show(e.raw)}`);
      if (e.kit.verdict !== 'PASS') failures.push(`${name} fails the constraint kit: ${show(e.kit.raw)}`);
      const ran = new Set(e.kit.rules.map((x) => x.rule));
      for (const rule of r.kit) if (!ran.has(rule.rule)) failures.push(`${name}'s kit result has no result for the rule ${rule.rule}`);
      for (const x of e.kit.rules) if (x.verdict !== 'PASS') failures.push(`${name} fails the kit's rule ${x.rule}: ${x.message}`);
    }
    const stream = r.entries.find((x) => x.name === 'follow_stream');
    if (stream && stream.module === 'motion') failures.push('motion fills follow_stream, the data module\'s kind');
    none(failures, 'motion\'s constraint kinds pass the kit');
  }, TIMEOUT);

  it('criterion 1: the seal refuses a planted kind that iterates to convergence and one that reads its own output from the previous frame, each naming the kind', () => {
    const bin = shows.bin(FULL);
    const failures: string[] = [];
    for (const planted of Object.values(PLANTED)) {
      const r = sealRefusal(startup(bin, planted));
      if (typeof r === 'string') { failures.push(`--planted ${planted}: ${r}`); continue; }
      if (r.registry !== 'constraint@1') failures.push(`--planted ${planted}: the refusal names the registry ${r.registry}, not constraint@1: ${show(r.raw)}`);
      if (!mentions(r.raw, 'motion')) failures.push(`--planted ${planted}: the refusal doesn't name the module motion: ${show(r.raw)}`);
      if (!MOTION_KINDS.some((k) => mentions(r.raw['entries'], k))) failures.push(`--planted ${planted}: the refusal's entries name none of motion's kinds: ${show(r.raw)}`);
    }
    none(failures, 'the seal refuses both planted kinds');
  }, TIMEOUT);

  it('criterion 1: motion\'s interface digest is the same in a build with the data module as in one without', () => {
    const digests: Record<string, string> = {};
    for (const set of [FULL, NO_DATA]) {
      const reply = runShow(shows.bin(set), scenario([{ call: 'schedule' }], evidence()))[0]!;
      const interfaces = obj(reply['interfaces'], `${set}: deep://schedule interfaces`);
      digests[set] = str(obj(interfaces['motion@1'], `${set}: interfaces["motion@1"]`)['digest'], `${set}: motion@1's digest`);
      expect('data@1' in interfaces, `${set}: the data module is ${set === FULL ? 'in' : 'out of'} the build`).toBe(set === FULL);
    }
    expect(digests[NO_DATA], 'motion@1\'s digest without the data module').toBe(digests[FULL]);
  }, TIMEOUT);

  it('criterion 1: on a fixture of each motion kind, seeking to 50 random times equals playing bit for bit, and the op count is the same at every time', () => {
    const bin = motion.bin();
    const failures: string[] = [];
    for (const [kind, f] of Object.entries(FIXTURES)) {
      failures.push(...seekPlayFailures(bin, f.doc, TIMES, kind));
      const a = evalOk(bin, { doc: f.doc, times: TIMES }, `the ${kind} fixture`);
      const ops = new Set(a.frames.map((fr) => int(constraintAt(fr, f.id)['ops'], `${kind}: constraints.${f.id}.ops`)));
      if (ops.size !== 1) failures.push(`${kind}: the op count changes with time: ${[...ops].join(', ')}`);
      const poses = new Set(a.frames.map((fr) => JSON.stringify((fr.items[f.owner] as JsonObject | undefined)?.['at'])));
      if (poses.size < 10) failures.push(`${kind}: ${f.owner}'s pose takes only ${poses.size} values over 50 times; the constraint doesn't follow its target`);
    }
    none(failures, 'each kind\'s fixture');
  }, TIMEOUT);

  it('criterion 1: a two-item cycle through child_of, look_at, copy and distance is refused at check, naming the chain', () => {
    const answers = evalAll(motion.bin(), Object.entries(CYCLES).map(([kind, c]) => ({ doc: pair(`cycle-${kind}`, c), times: [0] })));
    const failures: string[] = [];
    Object.keys(CYCLES).forEach((kind, i) => {
      const a = answers[i]!;
      if (a['ok'] !== false) { failures.push(`${kind}: the cycle ping ↔ pong is accepted`); return; }
      const r = refusal(a, `${kind}'s cycle`);
      if (!/cycle/.test(r.code)) failures.push(`${kind}: refused ${r.code}, not as a cycle: ${show(r.raw)}`);
      if (!mentions(r.raw, 'ping') || !mentions(r.raw, 'pong')) failures.push(`${kind}: the refusal doesn't name both ping and pong: ${show(r.raw)}`);
    });
    none(failures, 'two-item cycles are refused naming the chain');
  }, TIMEOUT);
});
