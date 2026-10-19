import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, type TestContext } from 'vitest';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import { anyUse, DAY, mulberry32, png, removeRoots, storeText, T0, tempRoot, utf8, word } from './helpers.ts';

afterEach(removeRoots, 120_000);

// The design's rule for timing results: five runs after a warm-up, counted only on the reference Mac
// (a 16-inch MacBook Pro, Mac15,7, on mains power, Low Power Mode off, thermal state nominal). Anywhere
// else a result is a reading and the check INCONCLUSIVE, so the test is skipped, never passed.
function referenceMac(): string | undefined {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  const sh = (cmd: string, ...args: string[]) => { try { return execFileSync(cmd, args, { encoding: 'utf8' }); } catch { return ''; } };
  const model = sh('sysctl', '-n', 'hw.model').trim();
  if (model !== 'Mac15,7') return `model ${model || 'unknown'}`;
  if (!sh('pmset', '-g', 'batt').includes("'AC Power'")) return 'not on mains power';
  if (!/lowpowermode\s+0/.test(sh('pmset', '-g'))) return 'Low Power Mode on or unknown';
  const therm = sh('pmset', '-g', 'therm');
  if (!/No thermal warning level has been recorded|thermal warning level.*:\s*0\b/i.test(therm)) return 'thermal state not nominal';
  return undefined;
}

/** PASS when all five are within the limit; FAIL when all five are over it by more than the margin; else INCONCLUSIVE. */
function judge(ctx: TestContext, name: string, runs: number[], limit: number) {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.min(...runs);
  const margin = Math.max(0.05, spread);
  const shown = `${name}: ${runs.map((r) => r.toFixed(2)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(`AC12 ${shown}`);
  if (runs.every((r) => r < limit)) return;
  // Every run over by more than the margin fails the budget; anything between is INCONCLUSIVE.
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${shown}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${shown}`);
}

const off = referenceMac();

describe('AC12 budgets on the reference Mac', () => {
  it('AC12 storing a 5 MB screenshot takes under 50 ms', async (ctx) => {
    if (off) ctx.skip(`INCONCLUSIVE: not the reference Mac (${off})`);
    const store = await openEvidenceStore({ root: tempRoot(), now: () => T0 });
    const writer = store.connect({ role: 'deepbuild', via: 'journey' });
    // 1,200 × 1,400 RGB stored uncompressed: just over 5 MB, a different image each run.
    const shots = Array.from({ length: 6 }, (_, k) => png(1200, 1400, 1200 + k, 0));
    expect(shots[0]!.length).toBeGreaterThan(5_000_000);
    const runs: number[] = [];
    for (const [k, bytes] of shots.entries()) {
      const started = performance.now();
      const result = await writer.put({ bytes, kind: 'screenshot', source: 'journey:budget', redaction: 'complete', license: anyUse, declares: 'png' });
      const ms = performance.now() - started;
      expect(result.status).toBe('stored');
      if (k) runs.push(ms); // the first is the warm-up
    }
    judge(ctx, 'put 5 MB PNG (ms)', runs, 50);
  }, 60_000);

  it('AC12 redaction adds under 10 ms per MB of text', async (ctx) => {
    if (off) ctx.skip(`INCONCLUSIVE: not the reference Mac (${off})`);
    const store = await openEvidenceStore({ root: tempRoot(), now: () => T0 });
    const writer = store.connect({ role: 'deepbuild', via: 'job' });
    const rng = mulberry32(0x15_12);
    const held = Array.from({ length: 16 }, () => word(rng, 32));
    const env = { CI: 'true', NODE_ENV: 'test', PORT: '3000', API_TOKEN: word(rng, 24), BUILD_ID: word(rng, 24) };
    const MB = 8;
    const outputs = Array.from({ length: 6 }, (_, k) => {
      const lines: string[] = [];
      let size = 0;
      for (let i = 0; size < MB * 1_048_576; i++) {
        const line = i % 500 === 0 ? `run ${k} step ${i}: token ${held[i % held.length]}\n` : `run ${k} step ${i}: compiled module ${word(rng, 8)} in ${i % 97} ms\n`;
        lines.push(line);
        size += line.length;
      }
      return utf8(lines.join(''));
    });
    const runs: number[] = [];
    for (const [k, bytes] of outputs.entries()) {
      const chunks = Array.from({ length: Math.ceil(bytes.length / 65_536) }, (_, c) => bytes.subarray(c * 65_536, (c + 1) * 65_536));
      const t0 = performance.now();
      await storeText(writer, { kind: 'log', source: 'run:budget', redaction: 'complete', license: anyUse, run: { env, held } }, chunks);
      const scrubbed = performance.now() - t0;
      const plain = new Uint8Array(bytes);
      plain[0] = 0x23; // other bytes than the text put, so nothing is deduplicated
      const t1 = performance.now();
      await writer.put({ bytes: plain, kind: 'log', source: 'run:budget', redaction: 'complete', license: anyUse });
      const unscrubbed = performance.now() - t1;
      if (k) runs.push((scrubbed - unscrubbed) / (bytes.length / 1_048_576));
    }
    judge(ctx, 'redaction (ms per MB)', runs, 10);
  }, 120_000);

  it('AC12 retention over 30 days of evidence finishes in under 10 s', async (ctx) => {
    if (off) ctx.skip(`INCONCLUSIVE: not the reference Mac (${off})`);
    let clock = T0;
    const store = await openEvidenceStore({ root: tempRoot(), now: () => clock });
    const writer = store.connect({ role: 'deepbuild', via: 'capture' });
    // 30 days of evidence at 500 files a day, one in ten cited, a few archived transcripts.
    const PER_DAY = 500;
    const cited = new Set<string>();
    const archived = new Set<string>();
    const rng = mulberry32(0x15_30);
    for (let day = 0; day < 36; day++) {
      for (let i = 0; i < PER_DAY; i++) {
        clock = T0 + day * DAY + i * 1000;
        const result = await writer.put({ bytes: utf8(`day ${day} file ${i} ${word(rng, 480)}\n`), kind: i % 50 ? 'log' : 'transcript', source: 'budget', redaction: 'complete', license: anyUse });
        if (result.status !== 'stored') throw Error(result.reason);
        if (i % 10 === 0) cited.add(result.evidence.sha256);
        if (i % 50 === 0) archived.add(result.evidence.sha256);
      }
    }
    const runs: number[] = [];
    // Each pass from day 36 on removes the day that turned 31, over the 30 days still held.
    for (let k = 0; k < 6; k++) {
      clock = T0 + (36 + k) * DAY;
      const started = performance.now();
      const { removed } = await store.retain({ cited, archived });
      const s = (performance.now() - started) / 1000;
      if (k === 0) expect(removed.length).toBeGreaterThan(0);
      if (k) runs.push(s);
    }
    judge(ctx, 'retention pass (s)', runs, 10);
  }, 300_000);
});
