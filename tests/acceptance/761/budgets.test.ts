import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, type TestContext } from 'vitest';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import { anyUse, mulberry32, removeRoots, storeText, T0, tempRoot, utf8, word } from '../15/helpers.ts';

afterEach(removeRoots, 120_000);

// The design's rule for timing results, as #15's budgets apply it: five runs after a warm-up, counted only on
// the reference Mac (a 16-inch MacBook Pro, Mac15,7, on mains power, Low Power Mode off, thermal state
// nominal). Anywhere else a result is a reading and the check INCONCLUSIVE, so the test is skipped, never passed.
// Copied from tests/acceptance/15/budgets.test.ts, which doesn't export them.
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
  console.log(`AC3 ${shown}`);
  if (runs.every((r) => r < limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${shown}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${shown}`);
}

const off = referenceMac();

describe('AC3 #761.51e647b5 budgets on the reference Mac', () => {
  it('AC3 with the field rules, redaction still adds under 10 ms per MB of text', async (ctx) => {
    if (off) ctx.skip(`INCONCLUSIVE: not the reference Mac (${off})`);
    const store = await openEvidenceStore({ root: tempRoot(), now: () => T0 });
    const writer = store.connect({ role: 'deepbuild', via: 'job' });
    const rng = mulberry32(0x761_03);
    const held = Array.from({ length: 16 }, () => word(rng, 32));
    const env = { CI: 'true', NODE_ENV: 'test', PORT: '3000', API_TOKEN: word(rng, 24), BUILD_ID: word(rng, 24) };
    // The shapes the field rules match, each with a fresh value no scrub list names.
    const fields = [
      (v: string) => `Authorization: Bearer ${v}`,
      (v: string) => `Proxy-Authorization: Basic ${v}`,
      (v: string) => `Cookie: sid=${v}; theme=dark`,
      (v: string) => `Set-Cookie: sid=${v}; Path=/`,
      (v: string) => `access_token=Bearer ${v}`,
      (v: string) => `token=Bot ${v}.sig_part-2`,
      (v: string) => `password: "${v} two words"`,
      (v: string) => `{"password":"${v}"}`,
      (v: string) => `{\\"client_secret\\":\\"${v}\\"}`,
      (v: string) => `x-api-key: ${v}`,
    ];
    const MB = 8;
    const outputs = Array.from({ length: 6 }, (_, k) => {
      const lines: string[] = [];
      let size = 0;
      for (let i = 0; size < MB * 1_048_576; i++) {
        // One line in 500 a secret-named field or header, one in 500 a held value, one in 50 a near miss
        // (names whose parts hold no secret word); the rest ordinary build output.
        const line = i % 500 === 0 ? `run ${k} step ${i}: ${fields[(i / 500) % fields.length]!(word(rng, 16))}\n`
          : i % 500 === 250 ? `run ${k} step ${i}: token ${held[i % held.length]}\n`
            : i % 50 === 25 ? `run ${k} step ${i}: usage {"input_tokens": ${i % 9973}, "max_tokens": 4096} tokenizer=cl100k\n`
              : `run ${k} step ${i}: compiled module ${word(rng, 8)} in ${i % 97} ms\n`;
        lines.push(line);
        size += line.length;
      }
      return utf8(lines.join(''));
    });
    const runs: number[] = [];
    for (const [k, bytes] of outputs.entries()) {
      const chunks = Array.from({ length: Math.ceil(bytes.length / 65_536) }, (_, c) => bytes.subarray(c * 65_536, (c + 1) * 65_536));
      const t0 = performance.now();
      const result = await storeText(writer, { kind: 'log', source: 'run:budget', redaction: 'complete', license: anyUse, run: { env, held } }, chunks);
      const scrubbed = performance.now() - t0;
      expect(result.status).toBe('stored');
      const plain = new Uint8Array(bytes);
      plain[0] = 0x23; // other bytes than the text put, so nothing is deduplicated
      const t1 = performance.now();
      await writer.put({ bytes: plain, kind: 'log', source: 'run:budget', redaction: 'complete', license: anyUse });
      const unscrubbed = performance.now() - t1;
      if (k) runs.push((scrubbed - unscrubbed) / (bytes.length / 1_048_576)); // the first is the warm-up
    }
    judge(ctx, 'redaction with field rules (ms per MB)', runs, 10);
  }, 120_000);
});
