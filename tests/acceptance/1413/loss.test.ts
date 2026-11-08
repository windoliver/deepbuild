// #1413.667c4a0a and #1413.da13fc6f: errors on a lost device. Alpha's view draws a moving scene; at frame 20 the
// device is lost just as a resource of alpha's next revision starts to build (`lose_device: {during: label}`,
// README), and no reopen is planted to fail. A buffer that fails to allocate there is the loss's symptom, not an
// out-of-memory: the app takes the reopen path and the view returns. A pipeline whose build the loss interrupts is
// named in the writer's error. At the base there is no `test-faults` feature, so the binary doesn't build.
import { describe, expect, it } from 'vitest';
import { FPS, MIB, W, alloc, liveCall, liveReply, pipeline, run, sceneDoc, sessionOf, useBuild, useDir, viewOf, writeDoc, type JsonObject, type Live } from './helpers.ts';

const bin = useBuild();
const dir = useDir();
const LOSS = 20;
const FRAMES = 240;
const LAST = FPS;

function lossRun(name: string, item: JsonObject, label: string): Live {
  const d = dir();
  const plain = writeDoc(d, `${name}-plain`, sceneDoc('Plain'));
  const next = writeDoc(d, `${name}-next`, sceneDoc(`Built as the device is lost: ${label}`, { [item['id'] as string]: item }));
  const { replies } = run(bin(), d, [liveCall({
    frames: FRAMES,
    sessions: [{ session: 'alpha', writer: W.alpha, doc: plain }],
    events: [{ frame: LOSS, lose_device: { during: label } }, { frame: LOSS, revise: { session: 'alpha', doc: next } }],
    report: ['hashes'],
  })]);
  return liveReply(replies[0]!, `the live call losing the device during ${label}'s build`);
}

describe('#1413.667c4a0a a failed allocation on a lost device still takes the reopen path', () => {
  it('#1413.667c4a0a a 1 MiB buffer whose allocation the loss fails is reopened, not told as out_of_memory, and the view returns at its base rung', () => {
    const live = lossRun('alloc', alloc('late', 'after-loss', MIB), 'after-loss');
    expect(live.device_losses, 'the device was lost once').toBe(1);
    expect(live.reopens.length, 'the app reopens the device').toBeGreaterThan(0);
    expect(live.reopens[0]!.ok, 'and the first reopen succeeds').toBe(true);
    expect(live.writer_errors.filter((e) => e.code === 'out_of_memory').map((e) => `${e.writer}: ${e.label}`), 'the failed allocation isn\'t told as out_of_memory').toEqual([]);
    expect(live.changes.filter((c) => c.session === 'alpha' && c.to === 'placeholder').map((c) => `frame ${c.frame}: ${c.reason}`), 'the view never takes the placeholder rung').toEqual([]);
    const tail = live.frames.slice(-LAST).map((f) => [f.frame, viewOf(f, 'alpha')] as const).filter(([, v]) => !v.drawn || v.rung !== 'base' || v.pixel_hash === null);
    expect(tail.map(([f, v]) => `frame ${f}: drawn ${v.drawn} at ${v.rung}`), `the view draws at its base rung in the last ${LAST} frames`).toEqual([]);
    expect(sessionOf(live, 'alpha').revisions.find((r) => r.rev === 2)?.outcome, 'the revision built on the reopened device is current').toBe('current');
  }, 3_600_000);
});

describe('#1413.da13fc6f a forced device loss during a labeled pipeline build names that pipeline', () => {
  it('#1413.da13fc6f the device lost while "probe-pipeline" builds: the writer\'s error is device_lost, naming probe-pipeline', () => {
    const live = lossRun('pipeline', pipeline('probe', 'probe-pipeline'), 'probe-pipeline');
    expect(live.device_losses, 'the device was lost once').toBe(1);
    const mine = live.writer_errors.filter((e) => e.session === 'alpha');
    expect(mine.map((e) => ({ writer: e.writer, code: e.code, label: e.label })), 'alpha\'s writer is told the loss, naming the pipeline that was building').toEqual([{ writer: W.alpha, code: 'device_lost', label: 'probe-pipeline' }]);
  }, 3_600_000);
});
