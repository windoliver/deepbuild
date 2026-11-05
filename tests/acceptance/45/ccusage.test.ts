// #45 AC10: token cost matches ccusage on the same transcripts within 1%. ccusage is pinned (README) and run on the committed
// fixture alone, in a temporary CLAUDE_CONFIG_DIR. When it can't be fetched or run, or prints what the test can't read, the
// test is BLOCKED, never a pass. ccusage's fixed prices come with it (--offline), so the comparison doesn't move by the day.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, type TestContext } from 'vitest';
import { countUsage } from '../../../packages/readings/src/index.ts';
import { FIXTURE } from './events.ts';

const CCUSAGE = 'ccusage@20.0.45';
const CLAUDE = fileURLToPath(new URL('./fixtures/claude/', import.meta.url));
interface Totals { totalCost: number; inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number }

function ccusage(ctx: TestContext): Totals {
  const config = realpathSync(mkdtempSync('/tmp/dh45-'));
  try {
    cpSync(CLAUDE, config, { recursive: true });
    const r = spawnSync('npx', ['--yes', CCUSAGE, 'claude', 'daily', '--json', '--offline'], { encoding: 'utf8', timeout: 240_000, env: { ...process.env, CLAUDE_CONFIG_DIR: config } });
    if (r.status !== 0) ctx.skip(`BLOCKED: ${CCUSAGE} did not run (status ${r.status}): ${String(r.stderr).slice(0, 300)}`);
    let totals: Partial<Totals> | undefined;
    try { totals = (JSON.parse(r.stdout) as { totals?: Partial<Totals> }).totals; } catch { totals = undefined; }
    if (typeof totals?.totalCost !== 'number') ctx.skip(`BLOCKED: ${CCUSAGE} printed no totals this test can read: ${String(r.stdout).slice(0, 300)}`);
    return totals as Totals;
  } finally {
    rmSync(config, { recursive: true, force: true });
  }
}

describe('AC10 token cost against ccusage', () => {
  it('#45.6e4d330a AC10 on the committed fixture, the estimated cost is within 1% of ccusage\'s and the tokens equal its', (ctx) => {
    const theirs = ccusage(ctx);
    const { cost, totals } = countUsage(FIXTURE);
    expect(cost.basis, 'the shipped rate card prices the fixture\'s model').toBe('estimated');
    if (cost.basis !== 'estimated') return;
    console.log(`ours $${cost.usd} on ${cost.rate_card}; ${CCUSAGE} $${theirs.totalCost}`);
    expect(Math.abs(cost.usd - theirs.totalCost) / theirs.totalCost, `ours $${cost.usd}, ccusage $${theirs.totalCost}`).toBeLessThan(0.01);
    expect({ input: totals.input, output: totals.output, cache_write: totals.cache_write, cache_read: totals.cache_read }).toEqual({ input: theirs.inputTokens, output: theirs.outputTokens, cache_write: theirs.cacheCreationTokens, cache_read: theirs.cacheReadTokens });
  }, 300_000);
});
