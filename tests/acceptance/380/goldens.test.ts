// #380.3b28146e: a GPU golden compares only under an equal environment fingerprint (OS, GPU, driver, wgpu
// version), and a missing snapshot is BLOCKED, never FAIL.
// The snapshot is the glow scene's frame 0 (`effectScene('glow')`) as the GPU layer draws it, blessed by your
// decision into a golden store in the test's folder. The `golden` call reports the run's fingerprint; this
// test holds it to this machine (the OS's version, the chip whose GPU it is, a driver string, and the wgpu
// version in Cargo.lock that the binary builds with). `environment` stands in for an OS, GPU, driver or
// wgpu update, as #138's does: under each changed field the golden doesn't compare at all, so neither the
// same frame nor a changed one reads PASS or FAIL; the verdict is BLOCKED or INCONCLUSIVE (the design says
// INCONCLUSIVE, #138's kit BLOCKED; either is "doesn't compare"), `environment_changed`, naming both
// fingerprints' values of the field, with no comparison numbers. Missing snapshots: a fixture with no
// golden, a snapshot file that isn't there, and a frame that can't be drawn because its document is refused.
// Wrong programs: `compares_any_environment` (the golden compares under any fingerprint) and
// `fails_missing_snapshot` (a missing snapshot reads FAIL). At the base `deep-gpu` has no golden call.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  binaryPackage, blessCall, cargoMetadata, chipName, effectScene, drawScene, goldenCall, goldenReply, normalClosure, osVersion, requireGpu, run, shown,
  useBin, useOut, view3d, writeJson, writePng, type Fingerprint, type Golden, type JsonObject, type Startup,
} from './helpers.ts';

const bins = useBin();
const out = useOut();
const FIXTURE = 'glow-380';
const FIELDS = ['os', 'gpu', 'driver', 'wgpu'] as const;
const OTHER: Fingerprint = { os: '99.0 (99Z999)', gpu: 'Apple M1', driver: 'driver 0.0-planted', wgpu: '0.0.0' };

/** The glow frame and a changed copy of it (a 48 × 48 magenta square at its centre), as PNG files. */
function snapshots(): { frame: string; changed: string } {
  const { final } = drawScene(bins.bin(), out(), effectScene('glow'), 'glow', { targets: ['final'] });
  const changed = { ...final, rgba: new Uint8Array(final.rgba) };
  for (let y = 156; y < 204; y++) for (let x = 216; x < 264; x++) changed.rgba.set([255, 0, 255, 255], (y * final.width + x) * 4);
  return { frame: writePng(out(), 'frame', final), changed: writePng(out(), 'changed', changed) };
}
function blessed(store: string, frame: string, startup: Startup = {}): void {
  const [decided] = run(bins.bin(), out(), [blessCall(store, FIXTURE, frame, 'you')], startup);
  expect(decided!['outcome'], `your blessing is decided: ${shown(decided)}`).toBe('decided');
}
/** Under a changed field the golden must not compare; each problem names the field and the frame. */
function environmentProblems(g: Golden, field: string, frame: string): string[] {
  const at = `under another ${field}, the ${frame} frame`;
  const problems: string[] = [];
  if (g.verdict === 'PASS' || g.verdict === 'FAIL') problems.push(`${at} was compared: ${g.verdict}`);
  if (g.reason !== 'environment_changed') problems.push(`${at} reads reason ${g.reason}, not environment_changed`);
  if (g.numbers !== null) problems.push(`${at} carries comparison numbers ${shown(g.numbers)}`);
  const text = JSON.stringify(g.raw);
  if (!g.golden || g.golden.fingerprint[field as keyof Fingerprint] === g.fingerprint[field as keyof Fingerprint]) problems.push(`${at} doesn't name the golden's ${field} beside the run's`);
  else if (!text.includes(g.golden.fingerprint[field as keyof Fingerprint]) || !text.includes(g.fingerprint[field as keyof Fingerprint])) problems.push(`${at} doesn't name both ${field}s`);
  return problems;
}
const missingProblems = (g: Golden, what: string): string[] =>
  g.verdict === 'BLOCKED' && g.numbers === null ? [] : [`${what} reads ${g.verdict} (${g.reason}) ${g.numbers ? 'with numbers' : ''}, not BLOCKED with no comparison numbers`];

describe('#380.3b28146e a GPU golden compares only under an equal environment fingerprint (OS, GPU, driver, wgpu version), and a missing snapshot is BLOCKED, never FAIL', () => {
  it('#380.3b28146e blessed under this machine\'s fingerprint, the frame passes and a changed frame fails; under another OS, GPU, driver or wgpu version neither is compared, naming both fingerprints', () => {
    requireGpu();
    const store = join(out(), 'goldens');
    const { frame, changed } = snapshots();
    blessed(store, frame);
    const calls: JsonObject[] = [goldenCall(store, FIXTURE, { png: frame }), goldenCall(store, FIXTURE, { png: changed })];
    for (const f of FIELDS) for (const png of [frame, changed]) calls.push(goldenCall(store, FIXTURE, { png }, { [f]: OTHER[f] }));
    const replies = run(bins.bin(), out(), calls).map((r, i) => goldenReply(r, `golden call ${i}`));
    const [same, diff] = replies;
    // The fingerprint is this machine's.
    const meta = cargoMetadata();
    const closure = normalClosure(meta, binaryPackage(meta)!.id);
    const wgpu = meta.packages.filter((p) => p.name === 'wgpu' && closure.has(p.id)).map((p) => p.version);
    expect(same!.fingerprint.os, 'the fingerprint\'s OS is this Mac\'s').toContain(osVersion());
    expect(same!.fingerprint.gpu, 'its GPU is this Mac\'s chip').toContain(chipName());
    expect(same!.fingerprint.driver.length, 'it names a driver').toBeGreaterThan(0);
    expect(wgpu, 'its wgpu is the version the binary builds with').toContain(same!.fingerprint.wgpu);
    expect(same!.golden?.fingerprint, 'the golden was recorded under this run\'s fingerprint').toEqual(same!.fingerprint);
    expect(same!.verdict, `the blessed frame passes under the same fingerprint: ${shown(same!.raw)}`).toBe('PASS');
    expect(diff!.verdict, `a changed frame fails under the same fingerprint (the comparison runs): ${shown(diff!.raw)}`).toBe('FAIL');
    expect(diff!.numbers, 'with its numbers').not.toBeNull();
    FIELDS.forEach((f, k) => {
      expect(environmentProblems(replies[2 + 2 * k]!, f, 'blessed'), `the blessed frame under another ${f}`).toEqual([]);
      expect(environmentProblems(replies[3 + 2 * k]!, f, 'changed'), `the changed frame under another ${f}`).toEqual([]);
    });
  }, 1_800_000);

  it('#380.3b28146e a missing snapshot is BLOCKED, never FAIL: no golden yet, a snapshot file that isn\'t there, and a frame whose document can\'t be drawn', () => {
    requireGpu();
    const store = join(out(), 'goldens');
    const { frame } = snapshots();
    const [none] = run(bins.bin(), out(), [goldenCall(store, FIXTURE, { png: frame })]);
    const g0 = goldenReply(none!, 'with no golden');
    expect(missingProblems(g0, 'a fixture with no golden'), 'no golden').toEqual([]);
    expect(g0.reason, 'named no_golden').toBe('no_golden');
    blessed(store, frame);
    // A document the check refuses (its camera names no item, and the required description is gone), so a
    // fresh session has no revision to draw. (An unknown kind wouldn't do: the design skips it, unknown_kind.)
    const { description: _gone, ...rest } = effectScene('glow').doc;
    const refused = writeJson(out(), 'refused.json', { ...rest, camera: 'no-such-camera' });
    const [gone, undrawn] = run(bins.bin(), out(), [
      goldenCall(store, FIXTURE, { png: join(out(), 'not-there.png') }),
      goldenCall(store, FIXTURE, { view3d: view3d({ doc: refused, look: effectScene('glow').look, size: [480, 360] }) }),
    ]);
    const g1 = goldenReply(gone!, 'a snapshot file that isn\'t there');
    const g2 = goldenReply(undrawn!, 'a frame whose document is refused');
    expect(missingProblems(g1, 'a snapshot file that isn\'t there'), 'the missing file').toEqual([]);
    expect(missingProblems(g2, 'a frame whose document is refused'), 'the frame never drawn').toEqual([]);
    expect([g1.reason, g2.reason], 'each named no_snapshot').toEqual(['no_snapshot', 'no_snapshot']);
  }, 1_800_000);

  it('#380.3b28146e planted wrong programs fail: a golden that compares under any fingerprint (--planted compares_any_environment), and a missing snapshot that reads FAIL (--planted fails_missing_snapshot)', () => {
    requireGpu();
    const store = join(out(), 'goldens');
    const { frame, changed } = snapshots();
    blessed(store, frame, { planted: 'compares_any_environment' });
    const [any] = run(bins.bin(), out(), [goldenCall(store, FIXTURE, { png: changed }, { os: OTHER.os })], { planted: 'compares_any_environment' });
    expect(environmentProblems(goldenReply(any!, 'compares_any_environment'), 'os', 'changed').join('\n'), 'the planted golden compares under another OS and the check fails, naming it').toMatch(/under another os, the changed frame was compared: FAIL/);
    const [miss] = run(bins.bin(), out(), [goldenCall(store, FIXTURE, { png: join(out(), 'not-there.png') })], { planted: 'fails_missing_snapshot' });
    expect(missingProblems(goldenReply(miss!, 'fails_missing_snapshot'), 'a snapshot file that isn\'t there').join('\n'), 'the planted golden reads FAIL for a missing snapshot and the check fails').toMatch(/reads FAIL/);
  }, 1_800_000);
});
