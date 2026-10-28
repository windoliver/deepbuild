// #761 AC3: budgets, on the reference Mac in the local preflight, compared with the merge base: with the field
// rules, redaction still adds under 10 ms per MB of text.
//
// Two halves, as #16's budgets are split (design: Every task carries its own budgets):
// - The merge-base comparison is the perf lane's (scripts/perf.mjs, benchmarks/budgets.json): #15's
//   `evidence-redact-text` task, 8 MB of output through the text sink, must still be there unchanged and the
//   budgets valid against the merge base's, so the preflight compares this change's p50 with the merge base's.
// - The issue's number is judged here: the time a text put spends scrubbing, over the same bytes stored without
//   a scrub, per MB, on 8 MB of output that carries the issue's header and field shapes with fresh values the
//   hub never injected. Five runs after a warm-up, judged by the repo's judgeLimit (PASS when all five are
//   within the limit, FAIL when all five are over it by more than the margin, else INCONCLUSIVE), counted only
//   on a reference Mac (Mac15,7 or Mac15,12) on mains power, Low Power Mode off, thermal state nominal, with the
//   macOS build recorded. Anywhere else the result is a reading and the test is skipped as INCONCLUSIVE, never
//   passed.
// Before any number counts, the measured text is shown to be scrubbed by the field rules: every field value is
// gone, every field name kept, and the twins stored unchanged. A store without the field rules never times
// "redaction with the field rules", so it fails here on any machine.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, type TestContext } from 'vitest';
import { openEvidenceStore, type Writer } from '../../../packages/evidence/src/index.ts';
import { anyUse, mulberry32, removeRoots, storeText, stored, T0, tempRoot, text, utf8, word, type Rng } from '../15/helpers.ts';

afterEach(removeRoots, 120_000);

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const LIMIT_MS_PER_MB = 10;
const MB = 8;
const CHUNK = 65_536;

interface Benchmark {
  validateBudgets(current: unknown, base: unknown): void;
  fingerprint(): Record<string, unknown>;
  judgeLimit(input: { limit: number; runs: number[]; fingerprint: Record<string, unknown> }): { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; margin?: number; reason?: string };
}
const benchmark = () => import(join(REPO, 'scripts/benchmark.mjs')) as Promise<Benchmark>;

// Every field value starts with `v7_`, which the filler (letters and digits only) never prints, so one regex
// finds any value the scrub kept.
const VALUE = /v7_[A-Za-z0-9]{16}/g;
const value = (rng: Rng) => `v7_${word(rng, 16)}`;

/** The issue's nine shapes, each with fresh values, and the field names a reader must still see. */
const FIELDS: { names: string[]; line: (v: () => string) => string }[] = [
  { names: ['Authorization:'], line: (v) => `Authorization: Bearer ${v()}` },
  { names: ['Proxy-Authorization:'], line: (v) => `Proxy-Authorization: Basic ${v()}` },
  { names: ['Cookie:'], line: (v) => `Cookie: sid=${v()}; theme=${v()}` },
  { names: ['Set-Cookie:'], line: (v) => `Set-Cookie: sid=${v()}; Path=/${v()}` },
  { names: ['access_token='], line: (v) => `access_token=Bearer ${v()}` },
  { names: ['token='], line: (v) => `token=Bot ${v()}.sig_part-2` },
  { names: ['password:'], line: (v) => `password: "${v()} two words"` },
  { names: ['"password"'], line: (v) => `{"password":"${v()}"}` },
  { names: ['\\"client_secret\\"'], line: (v) => `{\\"client_secret\\":\\"${v()}\\"}` },
];
/** The four twins: names with no secret word as a part, and prose. Stored unchanged. */
const TWINS = ['"input_tokens": 1234', '"max_tokens": 4096', 'tokenizer=cl100k', 'Authorization required for this route'];

interface Output { bytes: Uint8Array; values: number; names: Map<string, number> }

/** About 8 MB of build output: #15's filler and held-value lines, a field line every 50 lines, a twin every 50. */
function output(rng: Rng, k: number, held: string[]): Output {
  const lines: string[] = [];
  const names = new Map<string, number>();
  let values = 0;
  const v = () => { values++; return value(rng); };
  let size = 0;
  for (let i = 0; size < MB * 1_048_576; i++) {
    let line: string;
    if (i % 500 === 0) line = `run ${k} step ${i}: token ${held[i % held.length]}`;
    else if (i % 50 === 10) {
      const f = FIELDS[(i / 50 | 0) % FIELDS.length]!;
      line = f.line(v);
      for (const n of f.names) names.set(n, (names.get(n) ?? 0) + 1);
    } else if (i % 50 === 35) { line = TWINS[(i / 50 | 0) % TWINS.length]!; }
    else line = `run ${k} step ${i}: compiled module ${word(rng, 8)} in ${i % 97} ms`;
    lines.push(`${line}\n`);
    size += line.length + 1;
  }
  return { bytes: utf8(lines.join('')), values, names };
}

const chunks = (bytes: Uint8Array) => Array.from({ length: Math.ceil(bytes.length / CHUNK) }, (_, c) => bytes.subarray(c * CHUNK, (c + 1) * CHUNK));
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;
const lineCount = (haystack: string, line: string) => haystack.split('\n').filter((l) => l === line).length;

function workload() {
  const rng = mulberry32(0x761_03);
  const held = Array.from({ length: 16 }, () => word(rng, 32));
  const env = { CI: 'true', NODE_ENV: 'test', PORT: '3000', API_TOKEN: word(rng, 24), BUILD_ID: word(rng, 24) };
  return { rng, held, env };
}

async function scrubbed(writer: Writer, bytes: Uint8Array, held: string[], env: Record<string, string>) {
  return storeText(writer, { kind: 'log', source: 'run:budget-761', redaction: 'complete', license: anyUse, run: { env, held } }, chunks(bytes));
}

describe('AC3 #761.51e647b5 budgets on the reference Mac in the local preflight, compared with the merge base', () => {
  it('AC3 the perf lane still has #15\'s evidence-redact-text task, unchanged, and the budgets are valid against the merge base\'s', async () => {
    const { validateBudgets } = await benchmark();
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: { id: string; command: string[] }[] };
    let base: string;
    let baseBudgets: unknown;
    try {
      base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      baseBudgets = JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    } catch (e) {
      throw Error(`BLOCKED: no merge base to compare with (git merge-base HEAD origin/main in ${REPO}): ${(e as Error).message.split('\n')[0]}`);
    }
    validateBudgets(current, baseBudgets);
    const task = current.tasks.find((t) => t.id === 'evidence-redact-text');
    expect(task, 'budgets.json still has the evidence-redact-text task the perf lane compares with the merge base').toBeDefined();
    expect(task!.command, 'evidence-redact-text runs 8 MB of output through the text sink').toEqual(['node', 'benchmarks/evidence.mjs', 'redact-8mb']);
  });

  it('AC3 with the field rules, redaction adds under 10 ms per MB of text (five runs after a warm-up)', async (ctx: TestContext) => {
    const store = await openEvidenceStore({ root: tempRoot(), now: () => T0 });
    const writer = store.connect({ role: 'deepbuild', via: 'job' });
    const { rng, held, env } = workload();
    const outputs = Array.from({ length: 6 }, (_, k) => output(rng, k, held));

    // The proof, on the warm-up's text: the field rules ran over what is timed.
    const first = outputs[0]!;
    expect(first.values, 'the measured text carries field values').toBeGreaterThan(1000);
    const printed = text(first.bytes);
    expect(printed.match(VALUE)?.length, 'every field value is printed in the text').toBe(first.values);
    const kept = text(await store.read(stored(await scrubbed(writer, first.bytes, held, env))));
    const leaked = kept.match(VALUE) ?? [];
    const leakedLine = leaked.length ? kept.split('\n').find((l) => l.includes(leaked[0]!)) : undefined;
    expect(leaked.length, `field values kept in the stored text: ${leaked.length} of ${first.values}, first in the line ${JSON.stringify(leakedLine)}; the field rules didn't run, so the time measured isn't redaction with the field rules`).toBe(0);
    for (const [name, n] of first.names) expect(count(kept, name), `the field name ${name} is kept on each of its ${n} lines`).toBeGreaterThanOrEqual(n);
    for (const twin of TWINS) expect(lineCount(kept, twin), `the twin ${JSON.stringify(twin)} is stored unchanged`).toBe(lineCount(printed, twin));

    // The machine gate: a result off the reference Macs is a reading.
    const { fingerprint, judgeLimit } = await benchmark();
    const machine = fingerprint();
    const offReference = judgeLimit({ limit: LIMIT_MS_PER_MB, runs: [0, 0, 0, 0, 0], fingerprint: machine });
    if (offReference.status === 'INCONCLUSIVE') { ctx.skip(`INCONCLUSIVE: ${offReference.reason}`); return; }

    const raw: number[] = [];
    for (const [k, out] of outputs.entries()) {
      const t0 = performance.now();
      stored(await scrubbed(writer, out.bytes, held, env));
      const withScrub = performance.now() - t0;
      const plain = new Uint8Array(out.bytes);
      plain[0] = 0x23; // other bytes than the text put, so nothing is deduplicated
      const t1 = performance.now();
      stored(await writer.put({ bytes: plain, kind: 'log', source: 'run:budget-761', redaction: 'complete', license: anyUse }));
      const withoutScrub = performance.now() - t1;
      if (k) raw.push((withScrub - withoutScrub) / (out.bytes.length / 1_048_576)); // the first is the warm-up
    }
    // Redaction can't add less than nothing; a negative reading is noise and counts as 0 ms added.
    const runs = raw.map((r) => Math.max(0, r));
    const result = judgeLimit({ limit: LIMIT_MS_PER_MB, runs, fingerprint: machine });
    const shown = `redaction with the field rules (ms per MB): ${raw.map((r) => r.toFixed(2)).join(', ')} against ${LIMIT_MS_PER_MB} on ${String(machine.model)} macOS ${String(machine.macosBuild)}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`;
    console.log(`AC3 ${shown}`);
    if (result.status === 'BLOCKED') throw Error(`BLOCKED ${shown}`);
    expect(result.status, `FAIL ${shown}`).not.toBe('FAIL');
    if (result.status === 'INCONCLUSIVE') ctx.skip(`INCONCLUSIVE ${shown}`);
  }, 300_000);
});
