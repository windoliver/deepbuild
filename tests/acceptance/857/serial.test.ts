// #857.3: an operator that declares itself not thread-safe runs only on the scheduler's thread, and a planted
// operator that touches shared state without declaring it is caught by the shuffle test at 8 threads, naming
// it. With it, the issue's scope line "the scheduler's shuffle test gains thread counts: 1, 2, 4 and 8 give
// equal keys, writes and pixel hashes", run here on the shipped build: #387's shuffle (the scenario's
// `shuffle`, seeds 1 to 8) at each thread count, every frame against the unshuffled frame at 1 thread. Each
// frame is a fresh process. The test canvas modules are this suite's `test-threads` feature (README: The test
// canvas modules): `test.serial`, whose operator declares itself not thread-safe, and `test.racy`, the planted
// operator that reads and bumps a process-wide counter it never declares. The wrong programs: the base (no
// `thread_safe`, no node `thread`, no `test-threads`), a scheduler that puts a not-thread-safe operator on its
// pool, and the planted operator.
import { describe, expect, it } from 'vitest';
import {
  DOC, REGISTRY, SCHEDULER_THREAD, THREAD_COUNTS, differingOperators, evalCall, frameFailures, movingBoard, obj, presented, run, scenario, show,
  snapshotOf, threaded, useBuilds, useEvidence, withExtra, withTestItems, type Build, type JsonObject, type Threaded,
} from './helpers.ts';

const FULL: Build = { set: 'full' };
const THREADS: Build = { set: 'full', with: ['test-threads'] };
const builds = useBuilds([FULL, THREADS]);
const evidence = useEvidence();

/** The shuffle test's board: moving and still rects and labels, framed at 1 s. */
const SHUFFLED = movingBoard('Shuffled at thread counts', null, 60, 400, 40);
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

interface Frame { frame: Threaded; snapshot: string }
/** The frame at 1 s of `document` in a fresh process with a pool of `threads`, under `shuffle` when given. */
function frameOf(build: Build, document: JsonObject, threads: number, shuffle?: number): Frame {
  const replies = run(builds.bin(build), withExtra(scenario(evidence(), [show(document), evalCall(DOC.a, { t: '1s', pixels: true })]), { threads, shuffle }));
  presented(replies[0]!, `${String(document['title'])}`);
  const what = `the frame at ${threads} thread(s)${shuffle === undefined ? '' : ` under shuffle ${shuffle}`}`;
  return { frame: threaded(replies[1]!, what), snapshot: snapshotOf(replies[1]!, what) };
}

describe('#857.3 an operator that declares itself not thread-safe runs only on the scheduler\'s thread, and a planted operator that touches shared state without declaring it is caught by the shuffle test at 8 threads, naming it', () => {
  it('#857.3 the registry says of every operator whether it is thread-safe: test.serial.out declares itself not thread-safe, test.racy.out declares nothing and so is thread-safe', () => {
    const reply = run(builds.bin(THREADS), scenario(evidence(), [REGISTRY]))[0]!;
    const operators = obj(reply['operators'], 'registry: operators');
    for (const [name, o] of Object.entries(operators)) {
      expect(typeof obj(o, `operators.${name}`)['thread_safe'], `operators.${name}.thread_safe is a boolean`).toBe('boolean');
    }
    expect(obj(operators['test.serial.out'], 'operators.test.serial.out')['thread_safe'], 'test.serial.out declares itself not thread-safe').toBe(false);
    expect(obj(operators['test.racy.out'], 'operators.test.racy.out')['thread_safe'], 'test.racy.out declares nothing: thread-safe').toBe(true);
  }, 1_800_000);

  it('#857.3 at 8 threads every test.serial.out node runs on the scheduler\'s own thread, while the frame\'s other nodes run on the pool', () => {
    const document = withTestItems(movingBoard('Serial items', null, 0, 1_000, 0), 'test.serial', 200);
    const replies = run(builds.bin(THREADS), withExtra(scenario(evidence(), [show(document), evalCall(DOC.a)]), { threads: 8 }));
    presented(replies[0]!, 'the board with 200 test.serial items');
    const frame = threaded(replies[1]!, 'the first frame at 8 threads');
    expect(frame.threads, 'the frame given 8 threads reports a pool of 8').toBe(8);
    const serial = frame.nodes.filter((n) => n.operator === 'test.serial.out' && n.run === 'ran');
    expect(serial.length, 'every test.serial item\'s node ran in the session\'s first frame').toBe(200);
    const off = serial.filter((n) => n.thread !== SCHEDULER_THREAD).map((n) => `${n.item} on thread ${n.thread}`);
    expect(off, 'test.serial.out ran only on the scheduler\'s thread (0)').toEqual([]);
    const pooled = new Set(frame.nodes.filter((n) => n.run === 'ran' && n.operator !== 'test.serial.out').map((n) => n.thread));
    expect([...pooled].some((t) => t !== null && t !== SCHEDULER_THREAD), `the frame's other nodes ran on the pool's workers too: ${JSON.stringify([...pooled])}`).toBe(true);
  }, 1_800_000);

  it('#857.3 the shuffle test with thread counts on the shipped build: under shuffle seeds 1 to 8 at 1, 2, 4 and 8 threads, and unshuffled at each count, every node\'s key and write, the issues and the pixel hash equal the unshuffled frame at 1 thread', () => {
    const base = frameOf(FULL, SHUFFLED, 1);
    for (const n of THREAD_COUNTS) {
      for (const seed of [undefined, ...SEEDS]) {
        if (n === 1 && seed === undefined) continue;
        const what = `${n} thread(s)${seed === undefined ? '' : `, shuffle ${seed}`}`;
        const other = frameOf(FULL, SHUFFLED, n, seed);
        expect(other.frame.threads, `${what}: the pool has ${n}`).toBe(n);
        expect(frameFailures(base.frame.e, other.frame.e, what), `${what}: the same keys, writes and issues`).toEqual([]);
        expect(other.snapshot, `${what}: the same pixel hash`).toBe(base.snapshot);
      }
    }
  }, 3_600_000);

  it('#857.3 a planted operator that reads and bumps a process-wide counter without declaring it is caught by the shuffle test at 8 threads, and the failure names test.racy.out alone', () => {
    const document = withTestItems(SHUFFLED, 'test.racy', 200);
    const base = frameOf(THREADS, document, 1);
    const failures: string[] = [];
    const named = new Set<string>();
    for (const seed of [undefined, ...SEEDS]) {
      const what = `8 threads${seed === undefined ? '' : `, shuffle ${seed}`}`;
      const other = frameOf(THREADS, document, 8, seed);
      expect(other.frame.threads, `${what}: the pool has 8`).toBe(8);
      const found = frameFailures(base.frame.e, other.frame.e, what);
      failures.push(...found);
      if (found.length) for (const op of differingOperators(base.frame.e, other.frame.e)) named.add(op);
    }
    expect(failures.length, 'the shuffle test at 8 threads catches the undeclared shared state').toBeGreaterThan(0);
    expect([...named].sort(), `the failures name the operator, and only it:\n${failures.slice(0, 6).join('\n')}`).toEqual(['test.racy.out']);
    console.log(`#857.3 planted test.racy, first failures:\n${failures.slice(0, 6).join('\n')}`);
  }, 3_600_000);
});
