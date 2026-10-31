// #857.1: a 10,000-item board's frame with every item changed gives the same keys, writes and pixel hash at
// 1, 2, 4 and 8 threads; a planted merge in finish order differs at some count and fails, naming the first
// node whose write differs. Each thread count runs in a fresh process (the scenario's `threads`), so no
// content-key cache carries a result from one count to another: the board is shown in variant 0, framed,
// shown in variant 1 (every item changed) and framed again with its pixels. The frame at one thread is the
// reference; "writes" are the nodes' `result` digests (what each node wrote), and the frames' issues are
// compared too (the issue's scope: "every write, issue, key and digest is the same at any thread count").
// The wrong programs: the base (no `threads`, no node `thread`), a scheduler that never uses its pool (a
// frame on one thread at every count), and the planted finish-order merge.
import { describe, expect, it } from 'vitest';
import {
  BIG_ITEMS, DOC, THREAD_COUNTS, bigBoard, bigId, evalCall, frameFailures, presented, run, scenario, show, snapshotOf, threaded, useBuilds,
  useEvidence, withExtra, type Build, type Threaded,
} from './helpers.ts';

const FULL: Build = { set: 'full' };
const builds = useBuilds([FULL]);
const evidence = useEvidence();
const FRAME_PHASES = new Set(['latch', 'time', 'inputs', 'simulate', 'items', 'views', 'sources', 'extract', 'render', 'compose', 'feedback']);

interface Changed { frame: Threaded; snapshot: string }

/** The frame of the 10,000-item board after a revision that changed every item, in a fresh process with a pool of `threads`. */
function changedFrame(threads: number, planted?: string): Changed {
  const calls = [show(bigBoard(0)), evalCall(DOC.a), show(bigBoard(1)), evalCall(DOC.a, { pixels: true })];
  const replies = run(builds.bin(FULL), withExtra(scenario(evidence(), calls), { threads, planted }));
  presented(replies[0]!, 'the board in variant 0');
  presented(replies[2]!, 'the board in variant 1, every item changed');
  const what = `the frame with every item changed at ${threads} thread(s)${planted ? ` under ${planted}` : ''}`;
  return { frame: threaded(replies[3]!, what), snapshot: snapshotOf(replies[3]!, what) };
}

describe('#857.1 a 10,000-item board\'s frame with every item changed gives the same keys, writes and pixel hash at 1, 2, 4 and 8 threads; a planted merge in finish order differs at some count and fails, naming the first node whose write differs', () => {
  const shipped = new Map<number, Changed>();
  const at = (threads: number): Changed => {
    if (!shipped.has(threads)) shipped.set(threads, changedFrame(threads));
    return shipped.get(threads)!;
  };

  it('#857.1 at each count the frame runs on a pool of that many threads, runs a node for every one of the 10,000 changed items, and from 2 threads up spreads its nodes over more than one thread', () => {
    for (const n of THREAD_COUNTS) {
      const { frame } = at(n);
      expect(frame.threads, `the frame given ${n} thread(s) reports a pool of ${n}`).toBe(n);
      const ranItems = new Set(frame.nodes.filter((x) => x.run === 'ran' && FRAME_PHASES.has(x.phase) && x.item !== null).map((x) => x.item));
      const missing = Array.from({ length: BIG_ITEMS }, (_, i) => bigId(i)).filter((id) => !ranItems.has(id));
      expect(missing.slice(0, 10), `at ${n} thread(s), every changed item has a frame-phase node that ran (${missing.length} have none)`).toEqual([]);
      const used = new Set(frame.nodes.filter((x) => x.run === 'ran').map((x) => x.thread));
      if (n >= 2) expect(used.size, `at ${n} threads the frame's nodes ran on more than one thread: ${JSON.stringify([...used])}`).toBeGreaterThan(1);
    }
  }, 3_600_000);

  it('#857.1 at 2, 4 and 8 threads every node has the key and the write it has at 1 thread, the frame raises the same issues, and the pixel hash is the same', () => {
    const one = at(1);
    for (const n of THREAD_COUNTS.slice(1)) {
      const other = at(n);
      expect(frameFailures(one.frame.e, other.frame.e, `${n} threads`), `${n} threads: the same keys, writes and issues as at 1 thread`).toEqual([]);
      expect(other.snapshot, `${n} threads: the same pixel hash as at 1 thread`).toBe(one.snapshot);
    }
  }, 3_600_000);

  it('#857.1 a planted scheduler that merges a phase\'s results in the order its workers finished differs from the frame at 1 thread at some count, and the failure names the first node whose write differs', () => {
    const one = at(1);
    const failures: string[] = [];
    for (const n of THREAD_COUNTS.slice(1)) {
      const planted = changedFrame(n, 'merges_in_finish_order');
      expect(planted.frame.threads, `the planted frame given ${n} threads reports a pool of ${n}`).toBe(n);
      failures.push(...frameFailures(one.frame.e, planted.frame.e, `${n} threads, merged in finish order`));
    }
    expect(failures.length, 'the finish-order merge differs from the frame at 1 thread at some count').toBeGreaterThan(0);
    const named = failures.map((f) => /the first node whose write differs is (\S+)/.exec(f)?.[1]).filter((x): x is string => x !== undefined);
    expect(named.length, `the failure names the first node whose write differs: ${failures.slice(0, 5).join('\n')}`).toBeGreaterThan(0);
    const ids = new Set(one.frame.nodes.map((x) => `${x.operator}@${x.item ?? '(document)'}`));
    for (const id of named) expect(ids, `the named node ${id} is a node of the frame`).toContain(id);
    console.log(`#857.1 planted finish-order merge, first failures:\n${failures.slice(0, 6).join('\n')}`);
  }, 3_600_000);
});
