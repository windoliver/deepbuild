import { describe, expect, it } from 'vitest';
import {
  ALPHA, DOC, IN_ALPHA, MAGENTA, PANELS, PROCESSES, REPLY_BOUND_MS, SESSIONS, SLACK_MS, board, decodePng, label, near, outcome, pixel, putPng, readEvidence, rect,
  run, snapshots, solidPng, trivialMs, useEvidence, useShowBinary, type JsonObject,
} from './helpers.ts';

useShowBinary();
const evidence = useEvidence();

const SIZE: [number, number] = [320, 200];
const SWATCH_BOX = [200, 80, 32, 32];
/** A still board with a bar, a label and an image: an asset to decode, text to shape, a pipeline to build. */
const settling = (asset: string): JsonObject => board('Swatch', SIZE, [
  rect('back', 'Backdrop', [0, 0, 320, 200], 'a0', 'ground'),
  rect('bar', 'Bar', [16, 140, 200, 16], 'a1'),
  label('caption', 'Caption', 'Swatch ready', [16, 24], 'a2'),
  { id: 'swatch', kind: 'image@1', name: 'Swatch', order: 'a3', params: { asset, box: SWATCH_BOX, fit: 'fill', alt: 'A magenta swatch' } },
], { assets: { swatch: { sha256: asset, license: 'CC0-1.0' } } });

const HOLDS = ['fallback_pipeline', 'rebuild_queue', 'asset_decode'] as const;
type Hold = (typeof HOLDS)[number];

/** One deep_show (or `deep show --check --snap`) of the board at 1 s, with a snapshot asked for. */
function scenario(asset: string, opts: { hold?: Hold; ms?: number; cli?: boolean; panel?: string } = {}): JsonObject {
  const call = opts.cli
    ? { call: 'deep show', peer: IN_ALPHA, check: true }
    : { call: 'deep_show', session: ALPHA.id };
  return {
    evidence: evidence(),
    sessions: SESSIONS,
    processes: PROCESSES,
    panels: PANELS,
    docs: { [DOC.a]: { panel: opts.panel ?? 'main' } },
    ...(opts.hold ? { fault: { holds: opts.hold, ms: opts.ms! } } : {}),
    calls: [{ ...call, doc: DOC.a, document: settling(asset), t: '1s', size: SIZE, include: ['issues', 'pixels'] }],
  };
}

/** The settled snapshot: one PNG of the requested size, read back from the evidence by its hash, showing the decoded swatch. */
async function settledSnapshot(reply: JsonObject, what: string): Promise<string> {
  expect(outcome(reply), `${what}: presented`).toBe('presented');
  const shots = snapshots(reply, what);
  expect(shots.length, `${what}: one snapshot`).toBe(1);
  const shot = shots[0]!;
  expect([shot.w, shot.h], `${what}: the snapshot is the requested size`).toEqual(SIZE);
  const image = decodePng(await readEvidence(evidence(), shot.sha256));
  expect([image.width, image.height], `${what}: the snapshot's PNG, read back by its hash, is ${SIZE.join(' × ')}`).toEqual(SIZE);
  const center = pixel(image, SWATCH_BOX[0]! + 16, SWATCH_BOX[1]! + 16);
  expect(near(center, MAGENTA, 3), `${what}: the swatch is drawn decoded, magenta at its center (got ${center.join(', ')})`).toBe(true);
  return shot.sha256;
}

describe('AC1 a deep_show snapshot at a declared time is taken only once the frame is settled; a frame that can\'t settle within 2 s returns not presented with the reason, and a check that needed it is BLOCKED', () => {
  it('AC1 a frame that settles 1.5 s late is waited for: the reply comes after it settles, with the same snapshot as a frame settled at once', async () => {
    const asset = await putPng(evidence(), solidPng(32, 32, MAGENTA));
    const control = await settledSnapshot(run(scenario(asset)).replies[0]!, 'settled at once');
    for (const hold of HOLDS) {
      const late = run(scenario(asset, { hold, ms: 1_500 }));
      // While the fault holds the frame isn't settled, so no snapshot can be taken before 1.5 s.
      expect(late.ms, `${hold} held for 1.5 s: the reply waits for the frame to settle`).toBeGreaterThanOrEqual(1_500);
      expect(await settledSnapshot(late.replies[0]!, `${hold} held for 1.5 s`), `${hold}: the snapshot is the settled frame's, byte for byte`).toBe(control);
    }
  }, 120_000);

  it('AC1 a frame that can\'t settle within 2 s returns not presented with the reason timeout, within 2 s, and no snapshot', async () => {
    const asset = await putPng(evidence(), solidPng(32, 32, MAGENTA));
    const base = trivialMs(evidence());
    for (const hold of HOLDS) {
      const stuck = run(scenario(asset, { hold, ms: 10_000 }));
      const reply = stuck.replies[0]!;
      expect(outcome(reply), `${hold} held for 10 s: not presented`).toBe('not_presented');
      expect(reply['reason'], `${hold}: with the reason`).toBe('timeout');
      expect(snapshots(reply), `${hold}: and no snapshot of an unsettled frame`).toEqual([]);
      expect(stuck.ms - base, `${hold}: the reply comes within 2 s (run ${Math.round(stuck.ms)} ms, start-up ${Math.round(base)} ms)`).toBeLessThanOrEqual(REPLY_BOUND_MS + SLACK_MS);
    }
  }, 120_000);

  it('AC1 `deep show --check --snap` whose snapshot can\'t settle within 2 s is BLOCKED; the same check on a frame that settles passes', async () => {
    const asset = await putPng(evidence(), solidPng(32, 32, MAGENTA));
    const settled = run(scenario(asset, { cli: true })).replies[0]!;
    expect(outcome(settled), 'the check\'s frame settles: presented').toBe('presented');
    expect(settled['result'], 'and the check passes').toBe('PASS');
    for (const hold of HOLDS) {
      const blocked = run(scenario(asset, { cli: true, hold, ms: 10_000 })).replies[0]!;
      expect(outcome(blocked), `${hold} held for 10 s: not presented`).toBe('not_presented');
      expect(blocked['result'], `${hold}: the check that needed the snapshot is BLOCKED, never a pass`).toBe('BLOCKED');
    }
  }, 120_000);
});

describe('AC2 deep_show on a hidden panel returns "not presented" within 2 s', () => {
  it('AC2 deep_show on a hidden panel returns not presented with the reason hidden within 2 s; on a shown panel it is presented', async () => {
    const asset = await putPng(evidence(), solidPng(32, 32, MAGENTA));
    const shown = run(scenario(asset)).replies[0]!;
    expect(outcome(shown), 'on the shown panel: presented').toBe('presented');
    const base = trivialMs(evidence());
    const hidden = run(scenario(asset, { panel: 'tucked' }));
    expect(outcome(hidden.replies[0]!), 'on the hidden panel: not presented').toBe('not_presented');
    expect(hidden.replies[0]!['reason'], 'because it is hidden').toBe('hidden');
    expect(hidden.ms - base, `within 2 s (run ${Math.round(hidden.ms)} ms, start-up ${Math.round(base)} ms)`).toBeLessThanOrEqual(REPLY_BOUND_MS + SLACK_MS);
  }, 120_000);
});
