// AC2: deep_show's modes return snapshots by hash with readings as numbers, and none of its results counts as
// evidence for a claim about code.
//
// The mode under test is `bounds`, which draws from the core's bounds array, so every build has it, and whose
// readings have analytic answers: a box that a channel slides from x 0 to x 200 over 2 s sits at x 100 at 1 s. A
// claim about code is one whose deliverable is a source file, not a document. module_missing is read in the r1
// build, which holds no scene3d, through `lights_cameras`, the scene3d module's mode.
import { describe, expect, it } from 'vitest';
import {
  ALPHA, DOC, FULL, IN_ALPHA, R1, type JsonObject, arr, board, brief, claimHandle, num, obj, pngSize, presented, readEvidence, rect, run, scenario, sha256Of, str, useBuilds, useEvidence,
} from './helpers.ts';

const builds = useBuilds([FULL, R1]);
const evidence = useEvidence();

const SIZE = [320, 200];
/** Box a slides along x from 0 to 200 over 2 s; box b stands still. */
const SLIDING = board('Sliding box', [320, 200], [
  rect('a', 'Sliding box', [0, 0, 40, 20], 'a0', { at: { pos: [0, 30, 0] } }),
  rect('b', 'Still box', [0, 0, 60, 30], 'a1', { at: { pos: [200, 120, 0] } }),
], {
  transport: { span: '2s' },
  channels: { slide: { target: 'items/a/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '2s', value: 200, interp: 'linear' } } } },
});
const mode = (t: string, extra: JsonObject = {}): JsonObject =>
  ({ call: 'deep_show', session: ALPHA.id, doc: DOC.a, document: SLIDING, t, size: SIZE, include: ['issues', 'pixels'], mode: 'bounds', ...extra });

/** The row `drawn` gives for an item. */
function drawnRow(reply: JsonObject, id: string): JsonObject {
  const row = arr(reply['drawn'], `the mode's drawn readings (${brief(reply, 1500)})`).find((r) => obj(r, 'a drawn row')['id'] === id);
  return obj(row, `the drawn row for ${id}`);
}
const xyz = (v: JsonObject, k: string, what: string): number[] => arr(v[k], `${what}.${k}`).map((n, i) => num(n, `${what}.${k}[${i}]`));

describe('AC2 deep_show\'s modes return snapshots by hash with readings as numbers, and none of its results counts as evidence for a claim about code', () => {
  it('AC2 the bounds mode at 1 s returns a display-only snapshot by hash and each item\'s bounds at 1 s as numbers', async () => {
    const ev = evidence();
    const [plain, at1, at0] = run(builds.bin(FULL), scenario(ev, { [DOC.a]: null }, [
      { call: 'deep_show', session: ALPHA.id, doc: DOC.a, document: SLIDING, t: '1s', size: SIZE, include: ['issues', 'pixels'] },
      mode('1s'),
      mode('0s'),
    ]));
    presented(plain!, 'the board without a mode');
    presented(at1!, 'the board in the bounds mode at 1 s');
    expect(at1!['mode'], 'the reply names its mode').toBe('bounds');
    expect(at1!['display_only'], 'a mode\'s reply is display only').toBe(true);
    const snaps = arr(at1!['snapshots'], 'the mode\'s snapshots').map((s) => obj(s, 'a snapshot'));
    expect(snaps.length, 'one snapshot').toBe(1);
    const snap = snaps[0]!;
    expect(snap['display_only'], 'the snapshot is display only').toBe(true);
    const bytes = await readEvidence(ev, str(snap['sha256'], 'the snapshot\'s sha256'));
    expect(sha256Of(bytes), 'the snapshot is kept by its hash').toBe(snap['sha256']);
    expect(pngSize(bytes), 'a PNG of the size asked for').toEqual(SIZE);
    const plainSha = obj(arr(plain!['snapshots'], 'the plain snapshots')[0], 'the plain snapshot')['sha256'];
    expect(snap['sha256'], 'the mode draws a view in place of the look: its snapshot isn\'t the plain one').not.toBe(plainSha);

    // Readings as numbers, from the frame at t: box a at x 100 at 1 s and at x 0 at 0 s; box b where it stands.
    const a1 = drawnRow(at1!, 'a');
    expect(xyz(a1, 'min', 'a at 1 s'), `box a's bounds at 1 s (${brief(a1)})`).toEqual([100, 30, 0]);
    expect(xyz(a1, 'max', 'a at 1 s'), 'box a\'s bounds at 1 s').toEqual([140, 50, 0]);
    expect(xyz(a1, 'pos', 'a at 1 s'), 'box a\'s world position at 1 s').toEqual([100, 30, 0]);
    expect(xyz(drawnRow(at0!, 'a'), 'min', 'a at 0 s'), 'box a\'s bounds at 0 s, never from an earlier frame').toEqual([0, 30, 0]);
    const b1 = drawnRow(at1!, 'b');
    expect([...xyz(b1, 'min', 'b'), ...xyz(b1, 'max', 'b')], 'box b\'s bounds').toEqual([200, 120, 0, 260, 150, 0]);
    expect(a1['what'], 'a bounds row draws a box').toBe('box');
  });

  it('AC2 a deep show --check in a mode for a claim about code is never PASS, and what it returns is display only', () => {
    const codeClaim = claimHandle(1);
    const [reply] = run(builds.bin(FULL), scenario(evidence(), { [DOC.a]: null }, [
      { call: 'deep show', peer: IN_ALPHA, doc: DOC.a, document: SLIDING, t: '1s', size: SIZE, include: ['issues', 'pixels'], mode: 'bounds', check: true, claim: codeClaim },
    ], { claims: { [codeClaim]: { session: ALPHA.id, deliverables: ['crates/door/src/lib.rs'] } } }));
    expect(reply!['mode'], `the check ran in the bounds mode: ${brief(reply, 1500)}`).toBe('bounds');
    expect(arr(reply!['drawn'], 'its readings').length, 'it drew what it read').toBeGreaterThan(0);
    expect(reply!['display_only'], 'its reply is display only').toBe(true);
    for (const s of arr(reply!['snapshots'], 'its snapshots')) expect(obj(s, 'a snapshot')['display_only'], 'each snapshot is display only').toBe(true);
    expect(reply!['result'], 'a mode\'s picture and readings never pass a claim about code').not.toBe('PASS');
  });

  it('AC2 a mode whose canvas module the build lacks answers module_missing, naming it, never an empty snapshot', () => {
    const [reply] = run(builds.bin(R1), scenario(evidence(), { [DOC.a]: null }, [
      { call: 'deep_show', session: ALPHA.id, doc: DOC.a, document: SLIDING, t: '1s', size: SIZE, include: ['issues', 'pixels'], mode: 'lights_cameras' },
    ]));
    expect(reply!['code'], `the r1 build has no scene3d: ${brief(reply, 1500)}`).toBe('module_missing');
    expect(JSON.stringify(reply), 'the answer names the missing canvas module').toContain('scene3d');
    expect(reply!['snapshots'] ?? [], 'no snapshot, empty or not').toEqual([]);
    expect(reply!['drawn'] ?? [], 'and no readings').toEqual([]);
  });
});
