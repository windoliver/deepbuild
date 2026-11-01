// AC22: on the reference Mac, hook overhead under 10 ms at p95; setup sets Codex's Stop timeout once, to 45 minutes. Off a
// reference Mac, or under load, a timing is only a reading: the test skips as INCONCLUSIVE, never a pass. The gate is #120's.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import { afterEach, describe, expect, it, type TestContext } from 'vitest';
import { AC, begin, childEnv, cleanup, deep, HOOK, hubWithSetup, makeHome, newThread, payload, run, stopEntry, STOP_TIMEOUT_S } from './helpers.ts';

afterEach(cleanup, 60_000);
const REFERENCE = [{ model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 }, { model: 'Mac15,12', chip: 'Apple M3', gib: 16 }];
const sys = (k: string) => execFileSync('sysctl', ['-n', k], { encoding: 'utf8' }).trim();
function offReference(): string | null {
  if (process.platform !== 'darwin') return process.platform;
  const [model, chip, gib] = [sys('hw.model'), sys('machdep.cpu.brand_string'), Math.round(Number(sys('hw.memsize')) / 2 ** 30)];
  if (!REFERENCE.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
  if (!/'AC Power'/.test(execFileSync('pmset', ['-g', 'batt'], { encoding: 'utf8' }))) return 'not on mains power';
  if (loadavg()[0]! >= availableParallelism()) return `1-minute load ${loadavg()[0]!.toFixed(1)}`;
  return null;
}
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1]!;

describe(`${AC[22]} Budgets, on the reference Mac in the local preflight, compared with the merge base: hook overhead under 10 ms at p95, and setup sets Codex's Stop timeout once, to 45 minutes`, () => {
  it(`${AC[22]} setup writes Codex's Stop timeout at 45 minutes and a second setup doesn't touch it`, async () => {
    const h = makeHome();
    await hubWithSetup(h);
    expect(stopEntry(h)?.hook.timeout, `${AC[22]} the Stop entry's timeout in ${h.hooksFile}`).toBe(STOP_TIMEOUT_S);
    const bytes = readFileSync(h.hooksFile);
    expect((await deep(h, ['setup'])).code).toBe(0);
    expect(readFileSync(h.hooksFile).equals(bytes), `${AC[22]} set once`).toBe(true);
  }, 180_000);
  it(`${AC[22]} hook overhead under 10 ms at p95: a covered PostToolUse's round trip less a bare deep-hook start, five runs of 20 samples after warm-up. A comparison with the merge base is the preflight bench's`, async (ctx: TestContext) => {
    const h = makeHome();
    await hubWithSetup(h);
    expect(stopEntry(h), `${AC[22]} setup wrote Codex's entries`).toBeDefined();
    const t = newThread(h);
    await begin(h, t);
    const input = JSON.stringify(payload(t, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'call_x', tool_response: { stdout: '', exit_code: 0 } }));
    const env = childEnv(h);
    const once = async () => (await run(HOOK, ['codex', 'PostToolUse'], { cwd: t.cwd, env, input })).ms - (await run(HOOK, ['--version'], { env })).ms;
    for (let i = 0; i < 10; i++) await once();
    const runs: number[] = [];
    for (let r = 0; r < 5; r++) { const xs: number[] = []; for (let i = 0; i < 20; i++) xs.push(await once()); runs.push(p95(xs)); }
    const text = `p95s ${runs.map((x) => x.toFixed(2)).join(', ')} ms against 10 ms`;
    const off = offReference();
    if (off) ctx.skip(`INCONCLUSIVE (${off}): ${text}`);
    if (runs.every((x) => x <= 10)) return;
    const margin = Math.max(0.05, (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9));
    expect(runs.every((x) => x > 10 * (1 + margin)), `${AC[22]} FAIL ${text}`).toBe(false);
    ctx.skip(`INCONCLUSIVE ${text}`);
  }, 300_000);
});
