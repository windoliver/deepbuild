// #2652 AC1 #2652.8e8af2a5: after a command check that prints 8 MB, the hub's retained heap is under 64 KB above its
// value before the run (drafted); on the merge base it is over 8 MB above, and the test fails naming the growth.
//
// Through the hub's socket: `run.start` with a `command`, which the command check kind runs and the gate runner records,
// as it records a claim's check. Read through the hub's inspector, every thread summed, after full collections
// (README: The readings). Five such checks, each after a 100-byte one, so a hub that keeps only its newest output still
// grows by it at each; their median growth is the reading.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AC1, cleanup, commandCheck, inspect, makeHome, settledHeap, sha256, shownBytes, startHub, stopHub, type HeapReading, type Hub } from './helpers.ts';

afterEach(cleanup, 120_000);

const EIGHT_MB = 8_000_000;
const LIMIT = 64_000;
/**
 * What the check prints: `n` bytes of a test runner's report on standard output, 100-byte lines each starting with a
 * check mark, then exit 0. The same lines are written here, so the test knows every byte the run printed.
 */
const PRINT = [
  "const n = Number(process.argv[2]);",
  "const line = (i) => `\\u2713 ok test ${String(i).padStart(8, '0')} ${'x'.repeat(78)}\\n`;",
  "const out = [];",
  "for (let i = 0; i < n / 100; i++) out.push(line(i));",
  "process.stdout.write(out.join(''));",
  '',
].join('\n');
const printedText = (n: number): string => Array.from({ length: n / 100 }, (_, i) => `✓ ok test ${String(i).padStart(8, '0')} ${'x'.repeat(78)}\n`).join('');

/** One command check that prints `n` bytes; BLOCKED unless it passed and the hub stored exactly what it printed. */
async function printed(hub: Hub, work: string, n: number): Promise<string> {
  const { run, finished } = await commandCheck(hub, work, `node print.mjs ${n}`);
  const text = printedText(n);
  if (Buffer.byteLength(text) !== n) throw Error(`BLOCKED: the test's own text is ${Buffer.byteLength(text)} bytes, not ${n}`);
  if (finished.data.outcome !== 'passed' || (finished.data.evidence as string[])[0] !== sha256(text)) {
    throw Error(`BLOCKED: ${run} (\`node print.mjs ${n}\`) must pass with its ${n} printed bytes as its standard output's evidence: ${JSON.stringify(finished.data).slice(0, 800)}`);
  }
  return run;
}
const perThread = (r: HeapReading): string => Object.entries(r.threads).map(([t, m]) => `${t}: heap ${shownBytes(m.heapUsed)}, external ${shownBytes(m.external)}, of it array buffers ${shownBytes(m.arrayBuffers)}`).join('; ');

describe(`${AC1} after a command check that prints 8 MB, the hub's retained heap is under 64 KB above its value before the run; on the merge base it is over 8 MB above, and the test fails, naming the growth`, () => {
  it(`${AC1} five command checks that each print 8 MB, each after one that prints 100 bytes: the hub's retained heap grows by a median under 64 KB a check`, async () => {
    const h = makeHome();
    const work = join(h.tmp, 'work');
    mkdirSync(work);
    writeFileSync(join(work, 'print.mjs'), PRINT);
    const hub = await startHub(h, { inspect: true });
    const ins = await inspect(hub.inspector!);
    try {
      // Every path a check's run takes is taken once before any reading.
      for (const n of [EIGHT_MB, EIGHT_MB, 100]) await printed(hub, work, n);
      const growths: { run: string; bytes: number; before: HeapReading; after: HeapReading }[] = [];
      for (let i = 0; i < 5; i++) {
        await printed(hub, work, 100);
        const before = await settledHeap(ins);
        const run = await printed(hub, work, EIGHT_MB);
        const after = await settledHeap(ins);
        growths.push({ run, bytes: after.bytes - before.bytes, before, after });
      }
      const median = [...growths].sort((a, b) => a.bytes - b.bytes)[2]!;
      const shown = growths.map((g) => `${g.run}: ${shownBytes(g.bytes)}`).join(', ');
      console.log(`AC1 the hub's retained heap after each command check that printed 8 MB, against its value before it: ${shown}; median ${shownBytes(median.bytes)}`);
      expect(median.bytes, `After a command check that prints 8 MB the hub's retained heap must be under 64 KB above its value before the run; it grew ${shownBytes(median.bytes)} (the median of five such checks: ${shown}). Before ${median.run}: ${perThread(median.before)}. After it: ${perThread(median.after)}`).toBeLessThan(LIMIT);
    } finally {
      ins.close();
      await stopHub(hub);
    }
  }, 1_800_000);
});
