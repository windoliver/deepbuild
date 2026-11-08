// AC14: a delivery whose hub is killed after its request reads, after restart, sent when the issue holds a comment
// with its send-key marker, and not sent otherwise, in which case it goes out once; a hub that leaves it unknown when
// the provider can answer fails this test. The record runs on its test VFS; the tracker cuts the power the moment the
// delivery's comment reaches it and never answers. In one case the tracker kept the comment, in the other it didn't.
// The plug-in's process is killed and the hub's objects dropped; the hub starts on what the storage kept.
import { describe, expect, it } from 'vitest';
import { testStorage } from '../../../packages/record/src/index.ts';
import { AC14, at, deliveryOf, killPlugin, MINUTE, result, sleep, startHub, step, stopHub, taskFor, waitUntil } from './helpers.ts';
import { judgeSettled } from './judges.ts';
import { markerIn, REPO_WEB } from './providers.ts';
import { leavesUnknown } from './twins.ts';
import { trackerWorld } from './worlds.ts';

const T0 = at('2026-11-02T09:00');

async function killedAfterRequest(kept: boolean) {
  const storage = testStorage();
  const t = await trackerWorld(T0, { rule: true, storage });
  const issue = t.tr.add({ n: 46, created: T0 + MINUTE, updated: T0 + MINUTE });
  await step(t.h, t.c, T0 + MINUTE, T0 + 10 * MINUTE);
  const task = await taskFor(t.h, `${REPO_WEB}#46`);
  expect(task, 'issue 46 is a task').toBeTruthy();
  await t.w.record.sync();
  issue.hold = 'hang';
  issue.keep = kept;
  let cut = false;
  issue.onPost = () => { if (!cut) { cut = true; storage.cutPower(); } };
  const key = await t.h.deliverResult(task!.task_ref, result('PASS', 2, 'https://receipts.example/r/46'));
  t.c.set(T0 + 11 * MINUTE);
  void t.h.tick().catch(() => undefined);
  await waitUntil(() => cut, 60_000, 'the delivery\'s request reaching the tracker');
  await killPlugin(t.w, t.h, 'test/tracker');
  t.tr.p.drop();
  await Promise.race([stopHub(t.h, t.w).catch(() => undefined), sleep(20_000)]);
  delete issue.hold;
  delete issue.onPost;
  issue.keep = true;
  const { h } = await startHub(t.w, t.seams, storage);
  await step(h, t.c, T0 + 12 * MINUTE, T0 + 30 * MINUTE);
  const requests = t.tr.posts(46).filter((s) => markerIn(s.body) === key).length;
  const marked = issue.comments.filter((x) => markerIn(x.body) === key).length;
  return { key, row: await deliveryOf(h, key), requests, marked };
}

describe(`${AC14} A delivery whose hub is killed after its request reads, after restart, sent when the issue holds a comment with its send-key marker, and not sent otherwise, in which case it goes out once; a hub that leaves it unknown when the provider can answer fails this test`, () => {
  it('AC14 the tracker kept the comment: after the restart the delivery reads sent and no second request goes', async () => {
    const { key, row, requests, marked } = await killedAfterRequest(true);
    expect(judgeSettled(row, key, marked)).toEqual([]);
    expect(row?.outcome).toBe('sent');
    expect(requests, 'no second request').toBe(1);
    expect(judgeSettled(leavesUnknown(row!), key, marked).join('\n'), 'the wrong hub fails, naming the key').toContain(key);
  }, 300_000);

  it('AC14 the tracker never kept it: after the restart it reads not sent and goes out once', async () => {
    const { key, row, requests, marked } = await killedAfterRequest(false);
    expect(judgeSettled(row, key, marked)).toEqual([]);
    expect(row?.outcome, 'it went out once after the restart').toBe('sent');
    expect(requests, 'the lost request and the one after the restart').toBe(2);
    expect(judgeSettled(leavesUnknown(row!), key, marked).join('\n'), 'the wrong hub fails, naming the key').toContain(key);
  }, 300_000);
});
