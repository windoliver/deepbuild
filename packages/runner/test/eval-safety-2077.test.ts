// #2077: real sandboxed processes, record, budgets and supervisor; only the agent CLI is scripted.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { readFacts } from '@deepbuild/adapters';
import { openRunner, type EvaluationWork } from '../src/index.js';
import { alive, cleanup, coveredVersions, home, install, sleep, tempDir, ulid, waitFor } from '../../../tests/acceptance/159/helpers.ts';
import { card, openWorld, room, type World } from '../../../tests/acceptance/159/world.ts';

afterAll(cleanup);
const spec = { kind: 'eval' as const, agent: 'claude-code' as const, prompt: 'Evaluate removal', deadline_ms: 60_000 };
const result = { type: 'result', subtype: 'success', is_error: false, result: 'done', total_cost_usd: 0.25 };
const shell = (folder: string, command: string) => ({ argv: ['/bin/sh', '-c', command], cwd: folder, env: { PATH: '/usr/bin:/bin' } });
const print = (value: unknown) => `printf '%s\\n' '${JSON.stringify(value)}'`;
async function world(env: Record<string, string> = {}) {
  const bin = tempDir();
  install(bin, { version: coveredVersions().at(-1)! });
  const version = readFacts<{ versions: string[] }>('codex.facts.json').versions.at(-1)!;
  const codex = (v = version, body = print({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } })) => {
    writeFileSync(join(bin, 'codex'), `#!/bin/sh\nif [ "$1" = --version ]; then echo '${v}'; exit; fi\n${body}\n`, { mode: 0o755 });
  };
  codex();
  const w = await openWorld({ loginPath: `${bin}:/usr/bin:/bin`, env });
  await room(w);
  return { w, bin, codex };
}
async function state(w: World, id: string, predicate: (s: Awaited<ReturnType<typeof w.runner.status>>) => boolean) {
  return waitFor(async () => { const s = await w.runner.status(id); return predicate(s) && s; }, 15_000, 'eval state');
}

it('cleans a final result and its descendants without waiting for the process deadline', async () => {
  const { w } = await world();
  let pid = 0;
  const marker = join(tempDir(), 'child');
  try {
    const job = await w.runner.submit(spec, async (c) => {
      const rows = await c.execute(shell(c.folder, `sleep 60 & echo $! > '${marker}'; ${print(result)}; wait`), { write: [dirname(marker)] }, '', Date.now() + 40_000);
      expect(rows).toContainEqual(result);
      return 'compared';
    });
    await waitFor(() => existsSync(marker), 10_000, 'child pid');
    pid = Number(readFileSync(marker, 'utf8'));
    const ended = await Promise.race([w.runner.wait(job.job), sleep(12_000).then(() => undefined)]);
    expect(ended?.state, 'a final result must trigger cleanup, not wait 40 seconds').toBe('finished');
    expect(alive(pid)).toBe(false);
    expect((await w.events('run.cleaned')).some((e) => (e.data as { stopped: number[] }).stopped.includes(pid))).toBe(true);
  } finally { await w.close(); }
}, 90_000);

it('a subprocess deadline cannot turn partial output into a successful evaluation', async () => {
  const { w } = await world();
  try {
    const job = await w.runner.submit(spec, async (c) => {
      await c.execute(shell(c.folder, 'sleep 60'), {}, '', Date.now() + 500);
      return 'must not succeed';
    });
    const ended = await w.runner.wait(job.job);
    expect(ended.state).toBe('refused');
    expect(ended.refused).toMatch(/deadline/i);
    expect(ended.result).toBeUndefined();
  } finally { await w.close(); }
}, 60_000);

it('cancel removes a queued supervisor start before it can receive a prompt', async () => {
  const { w } = await world();
  const holder = `run:${ulid()}`;
  try {
    await w.sup.start({ run: holder, ...shell(tempDir(), 'sleep 60'), leases: [{ kind: 'worktree' }] });
    // An occupied real lease holds start(); Launch's extra property is forwarded to host@1.
    let entering!: () => void;
    const entered = new Promise<void>((r) => { entering = r; });
    const job = await w.runner.submit(spec, async (c) => {
      const launch = { ...shell(c.folder, print(result)), leases: [{ kind: 'worktree' }] };
      entering();
      await c.execute(launch, {}, 'cancelled prompt', Date.now() + 40_000);
      return 'must not succeed';
    });
    await entered;
    await sleep(300);
    const before = (await w.events('process.starting')).length;
    const cancelling = w.runner.cancel(job.job);
    const cancelled = await Promise.race([cancelling, sleep(2000).then(() => undefined)]);
    // Always release our lease, even on the wrong program, so teardown cannot hang.
    await w.sup.cleanup(holder);
    await cancelling;
    expect(cancelled?.state, 'cancel must not wait for the held lease').toBe('stopped');
    expect((await w.events('process.starting')).length).toBe(before);
    expect((await w.runner.wait(job.job)).result).toBeUndefined();
  } finally { await w.sup.cleanup(holder); await w.close(); }
}, 90_000);

it('read refuses an uncovered judge version rather than merely resolving its binary', async () => {
  const { w, codex } = await world();
  codex('999.0.0');
  try {
    const job = await w.runner.submit(spec, async (c) => { await c.read('codex', 'gpt-reserve', 'judge', Date.now() + 30_000); return 'incorrect'; });
    const end = await w.runner.wait(job.job);
    expect(end.state).toBe('refused');
    expect(end.refused).toMatch(/outside what its facts cover/);
  } finally { await w.close(); }
}, 60_000);

it('the judge needs a matching budget and never exposes billing keys in evaluator env', async () => {
  const { w } = await world({ OPENAI_API_KEY: 'fixture-not-a-key' });
  let passed = false;
  try {
    await w.ledger.approve(card, { scope: { kind: 'issue', ref: 'other' }, cap_usd: 5, ends: w.clock.now() + 86_400_000 });
    const job = await w.runner.submit({ ...spec, issue: '2077' }, async (c) => {
      expect(c.env.OPENAI_API_KEY).toBeUndefined();
      await c.read('codex', 'gpt-reserve', 'judge', Date.now() + 30_000);
      passed = true;
      return 'incorrect';
    });
    const held = await state(w, job.job, (s) => !!s.blocked || ['finished', 'refused'].includes(s.state));
    expect(held.blocked?.cause).toBe('budget');
    expect(passed).toBe(false);
  } finally { await w.close(); }
}, 60_000);

it('aggregates real process cost and keeps an unpriced process reservation held', async () => {
  const { w } = await world({ ANTHROPIC_API_KEY: 'fixture-not-a-key' });
  try {
    await w.ledger.approve(card, { scope: { kind: 'issue', ref: '2077' }, cap_usd: 5, ends: w.clock.now() + 86_400_000 });
    for (const priced of [true, false]) {
      const job = await w.runner.submit({ ...spec, issue: '2077' }, async (c) => {
        expect(c.env.ANTHROPIC_API_KEY, 'API credentials belong only in gated process environments').toBeUndefined();
        await c.execute(shell(c.folder, print(result)), {}, '', Date.now() + 30_000);
        await c.execute(shell(c.folder, print(priced ? { ...result, total_cost_usd: 0.5 } : { type: 'result', result: 'unpriced' })), {}, '', Date.now() + 30_000);
        return 'compared';
      });
      const end = await w.runner.wait(job.job);
      expect(end.state, end.refused).toBe('finished');
      expect(end.cost_usd).toBe(priced ? 0.75 : undefined);
      const charged = (await w.events('spend.charged')).filter((e) => e.subject === job.job);
      expect(charged.map((e) => (e.data as { usd: number }).usd)).toEqual(priced ? [0.75] : []);
    }
  } finally { await w.close(); }
}, 90_000);

it('uses an explicit Claude sign-in home, isolates its hooks, and refuses a token outlived by read', async () => {
  const config = tempDir();
  writeFileSync(join(config, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: 'eval-account' } }));
  const credentials = JSON.stringify({ claudeAiOauth: { accessToken: 'fixture-token', expiresAt: Date.now() + 3_600_000 } });
  writeFileSync(join(config, '.credentials.json'), credentials);
  writeFileSync(join(config, 'settings.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo USER_HOOK' }] }] } }));
  const { w } = await world({ CLAUDE_CONFIG_DIR: config });
  let entered = false;
  try {
    await room(w, 'eval-account');
    const job = await w.runner.submit({ ...spec, deadline_ms: 1000 }, async (c) => {
      entered = true;
      await c.read('claude-code', 'haiku', '@env\n', Date.now() + 7_200_000);
      return 'incorrect';
    });
    expect(job.account).toBe('eval-account');
    const end = await w.runner.wait(job.job);
    expect(entered).toBe(true);
    expect(end.state).toBe('refused');
    expect(end.refused).toMatch(/token expires/);
    expect(readFileSync(join(config, '.credentials.json'), 'utf8')).toBe(credentials);
  } finally { await w.close(); }
}, 60_000);

it('weekly output readings block the next turn, including when a judge had no first reading', async () => {
  const codexHome = tempDir();
  writeFileSync(join(codexHome, 'auth.json'), JSON.stringify({ tokens: { account_id: 'judge-account' } }));
  const { w } = await world({ CODEX_HOME: codexHome });
  try {
    const job = await w.runner.submit(spec, async (c) => {
      await c.checkpoint('codex');
      await c.execute(shell(c.folder, `${print({ type: 'rate_limit_event', rate_limit_info: { rateLimitType: 'seven_day', utilization: 0.99, resetsAt: Math.floor(w.clock.now() / 1000) + 86_400_000 } })}; ${print(result)}`), {}, '', Date.now() + 30_000);
      await c.checkpoint('claude-code');
      return 'incorrect';
    });
    expect((await state(w, job.job, (s) => s.blocked?.cause === 'first reading')).blocked?.account).toBe('judge-account');
    await w.runner.report({ agent: 'codex', account: 'judge-account', rate_limits: { primary: { used_percent: 5, resets_at: Math.floor(w.clock.now() / 1000) + 3600 } } });
    expect((await state(w, job.job, (s) => s.blocked?.cause === 'plan window')).blocked?.why).toMatch(/seven-day/);
    expect((await w.events('job.recorded')).length).toBe(1);
  } finally { await w.close(); }
}, 90_000);

it('counts judge first-reading exemptions once per composite job, not once per checkpoint', async () => {
  const codexHome = tempDir();
  writeFileSync(join(codexHome, 'auth.json'), JSON.stringify({ tokens: { account_id: 'unread-judge' } }));
  const { w } = await world({ CODEX_HOME: codexHome });
  const work: EvaluationWork = async (c) => { await c.checkpoint('codex'); await c.checkpoint('codex'); return 'checked'; };
  try {
    const first = await w.runner.submit(spec, work);
    await state(w, first.job, (s) => s.blocked?.cause === 'first reading');
    w.clock.advance(31 * 60_000);
    const ask = await waitFor(async () => (await w.events('ask.created')).find((e) => String((e.data as { question: string }).question).includes('unread-judge')), 5000, 'judge reading ask');
    await w.asks.answer(card, `ask:${ask.id}`, { option: 'run' });
    await w.runner.tick();
    expect((await w.runner.wait(first.job)).state).toBe('finished');
    for (let i = 1; i < 10; i++) expect((await w.runner.wait((await w.runner.submit(spec, work)).job)).state).toBe('finished');
    const last = await w.runner.submit(spec, work);
    const held = await state(w, last.job, (s) => !!s.blocked || s.state === 'finished');
    expect(held.blocked?.why).toMatch(/10 jobs/);
    expect((await w.events('ask.created')).filter((e) => String((e.data as { question: string }).question).includes('unread-judge'))).toHaveLength(1);
  } finally { await w.close(); }
}, 90_000);

it('close reaps an active eval and reopening the runner never reruns or succeeds it', async () => {
  const { w, bin } = await world();
  const marker = join(tempDir(), 'child');
  try {
    const job = await w.runner.submit(spec, async (c) => { await c.execute(shell(c.folder, `sleep 60 & echo $! > '${marker}'; wait`), { write: [dirname(marker)] }, '', Date.now() + 40_000); return 'incorrect'; });
    await waitFor(() => existsSync(marker), 10_000, 'active eval');
    await w.runner.close();
    expect(alive(Number(readFileSync(marker, 'utf8')))).toBe(false);
    const reopened = await openRunner({ record: w.record, asks: w.asks, ledger: w.ledger, supervisor: w.sup, now: w.clock.now, root: w.root, loginPath: `${bin}:/usr/bin:/bin`, env: { HOME: home() }, settings: { plan: { reserve_pct: 10 }, asks: { unblock: { deadline_ms: 60_000 } } } });
    try {
      expect((await reopened.wait(job.job)).state).toBe('stopped');
      expect((await reopened.list())).toHaveLength(1);
      expect((await w.events('job.ended')).filter((e) => e.subject === job.job)).toHaveLength(1);
    } finally { await reopened.close(); }
  } finally { await w.close(); }
}, 90_000);
