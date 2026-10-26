// The stubs and the test writer the criteria name are reachable only in the `test-meter` build, and the
// JSON-lines convention holds for the new calls and startup arguments (README: The surface under test).
// Each test carries the ID of the criterion whose stub it fences: the stub meter (#379.1fbf8952), the stub
// battery (#379.2299cd3b), the test writer (#379.20ef578a), the test module's kinds (#379.0806d709) and the
// counting allocator (#379.1e889bee). These run on wgpu's noop backend, everywhere.
import { describe, expect, it } from 'vitest';
import {
  GPU_BIN, REFUSED_EXIT, W, liveCall, liveReply, mesh, one, run, sceneDoc, start, startArgs, useBuilds, useOut, writeDoc, type JsonObject,
} from './helpers.ts';

const builds = useBuilds(['default', 'test-meter']);
const out = useOut();

const plainDoc = (): string => writeDoc(out(), 'plain', sceneDoc({ title: 'Plain', class: 'work_product', size: [64, 64], moving: true }));
const live = (extra: JsonObject): JsonObject => ({ ...liveCall({ frames: 2, sessions: [{ session: 's-alpha', writer: W.alpha, doc: plainDoc() }] }), ...extra });
/** The shipped build answers the plain live call, so a refusal below is the stub field's, not the call's. */
const plainAnswered = (): void => {
  const plain = liveReply(one(builds.bin(), out(), live({}), { backend: 'noop' }), 'the shipped build\'s plain live call');
  expect(plain.frames.length, 'the shipped build draws the plain call\'s two frames').toBe(2);
};
const refusedAsBadInput = (reply: JsonObject, what: string): void => {
  expect(reply['code'], `${what}: the shipped build answers bad_input: ${JSON.stringify(reply).slice(0, 600)}`).toBe('bad_input');
};

describe('#379.1fbf8952 the stub meter is the test build\'s alone', () => {
  it('#379.1fbf8952 the shipped build refuses a live call carrying stub_meter with bad_input; the test build takes it', () => {
    const stub = { stub_meter: { writers: { [W.alpha]: [{ from: 1, gpu_ms: 1 }] } } };
    plainAnswered();
    refusedAsBadInput(one(builds.bin(), out(), live(stub), { backend: 'noop' }), 'stub_meter');
    const ok = liveReply(one(builds.bin('test-meter'), out(), live(stub), { backend: 'noop' }), 'the test build\'s live call with stub_meter');
    expect(ok.frames.length, 'the test build draws both frames').toBe(2);
    expect(ok.frames.every((f) => Math.abs(f.views[0]!.charged_gpu_ms - 1) < 1e-9), 'charged as the stub says').toBe(true);
  }, 600_000);

  it('#379.1fbf8952 the JSON-lines convention: a line that isn\'t a scenario answers bad_input, a live call without frames is refused bad_input, and an unknown planted name or withheld feature ends the run at startup with one bad_input line', () => {
    const s = start(builds.bin(), startArgs({ backend: 'noop' }), ['{not json', { out: out(), calls: [{ call: 'live', look: {}, sessions: [] }] }]);
    expect(s.status, `${GPU_BIN} run exits 0`).toBe(0);
    expect(s.lines.length, 'one line out per line in').toBe(2);
    expect(s.lines[0], 'a line that isn\'t a scenario').toEqual({ ok: false, code: 'bad_input' });
    const replies = (s.lines[1] as JsonObject)['replies'] as JsonObject[];
    expect(replies?.[0]?.['code'], 'a live call without frames is refused bad_input').toBe('bad_input');
    const withheld = start(builds.bin(), ['run', '--backend', 'noop', '--withhold', 'timestamps'], [{ out: out(), calls: [] }]);
    expect(withheld.status, 'run --withhold timestamps starts and exits 0').toBe(0);
    expect(withheld.lines, 'and answers its one scenario').toEqual([{ ok: true, replies: [] }]);
    for (const args of [['run', '--planted', 'no_such_program'], ['run', '--withhold', 'no_such_feature']]) {
      const r = start(builds.bin(), args, [{ out: out(), calls: [] }]);
      expect(r.status, `${args.join(' ')} exits ${REFUSED_EXIT}`).toBe(REFUSED_EXIT);
      expect(r.lines, `${args.join(' ')} answers one bad_input line`).toEqual([{ ok: false, code: 'bad_input' }]);
    }
  }, 600_000);
});

describe('#379.2299cd3b the stub battery is the test build\'s alone', () => {
  it('#379.2299cd3b the shipped build refuses a live call carrying stub_battery with bad_input; the test build takes it', () => {
    plainAnswered();
    const battery = { stub_battery: [{ frame: 1, percent: 25, state: 'discharging' }] };
    liveReply(one(builds.bin('test-meter'), out(), live(battery), { backend: 'noop' }), 'the test build\'s live call with stub_battery');
    refusedAsBadInput(one(builds.bin(), out(), live(battery), { backend: 'noop' }), 'stub_battery');
  }, 600_000);
});

describe('#379.20ef578a the test writer is the test build\'s alone', () => {
  it('#379.20ef578a the shipped build refuses allocate and release with bad_input; the test build takes them', () => {
    const [ta, tr] = run(builds.bin('test-meter'), out(), [
      { call: 'allocate', writer: W.test, limit_bytes: 1_000_000, resources: [{ name: 'x', kind: 'texture', size: [64, 64], format: 'rgba8unorm', mips: 1 }] },
      { call: 'release', writer: W.test },
    ], { backend: 'noop' });
    expect(ta!['code'], `the test build answers allocate: ${JSON.stringify(ta).slice(0, 600)}`).toBeUndefined();
    expect(tr!['code'], `the test build answers release: ${JSON.stringify(tr).slice(0, 600)}`).toBeUndefined();
    const [a, r] = run(builds.bin(), out(), [
      { call: 'allocate', writer: W.test, limit_bytes: 1_000_000, resources: [{ name: 'x', kind: 'texture', size: [64, 64], format: 'rgba8unorm', mips: 1 }] },
      { call: 'release', writer: W.test },
    ], { backend: 'noop' });
    refusedAsBadInput(a!, 'allocate');
    refusedAsBadInput(r!, 'release');
  }, 600_000);
});

describe('#379.0806d709 the test module\'s kinds are the test build\'s alone', () => {
  it('#379.0806d709 in the shipped build a document of test.mesh@1 is refused with module_missing naming test.gpu, and never draws', () => {
    const doc = writeDoc(out(), 'meshy', sceneDoc({ title: 'Meshy', class: 'work_product', size: [64, 64], items: { shape: mesh('shape', 100, 'x') } }));
    const r = liveReply(one(builds.bin(), out(), liveCall({ frames: 2, sessions: [{ session: 's-alpha', writer: W.alpha, doc }] }), { backend: 'noop' }));
    const row = r.sessions.find((s) => s.session === 's-alpha');
    expect(row?.state, 'refused').toBe('refused');
    expect(row!.issues.some((i) => i['code'] === 'module_missing' && JSON.stringify(i).includes('test.gpu')), `module_missing names test.gpu: ${JSON.stringify(row!.issues).slice(0, 600)}`).toBe(true);
    expect(r.frames.every((f) => !f.views.some((v) => v.session === 's-alpha' && v.drawn)), 'and never draws').toBe(true);
  }, 600_000);
});

describe('#379.1e889bee the counting allocator is the test build\'s alone', () => {
  it('#379.1e889bee the shipped build refuses a live call reporting allocs with bad_input; the test build counts them', () => {
    plainAnswered();
    const counted = liveReply(one(builds.bin('test-meter'), out(), live({ report: ['allocs'] }), { backend: 'noop' }), 'the test build\'s live call with allocs');
    expect(counted.frames.every((f) => typeof f.allocs === 'number'), 'each frame reports its allocations').toBe(true);
    refusedAsBadInput(one(builds.bin(), out(), live({ report: ['allocs'] }), { backend: 'noop' }), 'report: allocs');
  }, 600_000);
});
