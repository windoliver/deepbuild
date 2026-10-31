// #40 AC3: the runner (#159) starts a pi job from its facts, real pi in its sandbox, and records the job's usage and
// stop cause. The agent on the login PATH is a `pi` script running real pi with the scripted provider added.
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LIFECYCLE, NODE, REPO, SCRIPTED, VERSION, cleanup, childEnv, piCli, readFacts, tempDir, type Line, type Step } from './helpers.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import { openAsks } from '../../../packages/asks/src/index.ts';
import { openLedger } from '../../../packages/budget/src/index.ts';
import { openSupervisor } from '../../../packages/supervisor/src/index.ts';
import { openRunner, type JobRecord } from '../../../packages/runner/src/index.ts';

afterEach(cleanup, 60_000);
const DAY = 86_400_000;
const closers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of closers.splice(0)) await close(); }, 30_000);

async function piJob(steps: Step[], prompt: string): Promise<{ rec: JobRecord; stdout: string; bin: string }> {
  const cli = piCli();
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const bin = join(tmp, 'bin');
  mkdirSync(home);
  mkdirSync(bin);
  const script = join(tmp, 'script.json');
  writeFileSync(script, JSON.stringify(steps));
  // The facts' launch, with the local provider added; only the model API is stood in for.
  const wrapper = join(bin, 'pi');
  writeFileSync(wrapper, `#!/bin/sh\nexport PI_OFFLINE=1 PI_TELEMETRY=0 DEEP_PI_SCRIPT='${script}'\nexec '${NODE}' '${cli}' "$@" --extension '${SCRIPTED}' --provider scripted --model scripted-1\n`);
  chmodSync(wrapper, 0o755);
  const record = await openRecord({ path: join(tmp, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const ledger = await openLedger({ record, asks, now: Date.now, price: async () => 0.5 });
  const supervisor = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 2 * DAY } } }, resources: [] });
  const env = childEnv(home);
  const runner = await openRunner({
    record, asks, supervisor, ledger, now: Date.now, root: join(home, '.deepbuild'), loginPath: `${bin}:/usr/bin:/bin`, env: env as Record<string, string>,
    settings: { plan: { reserve_pct: 10 }, asks: { unblock: { deadline_ms: 2 * DAY } } },
  });
  closers.push(async () => { await runner.close(); await supervisor.close(); await record.close(); });
  const rec = await runner.run({
    kind: 'read', agent: 'pi' as never, prompt, deadline_ms: 90_000,
    grant: { read: [dirname(NODE), dirname(dirname(cli)), dirname(cli), tmp, dirname(SCRIPTED), dirname(LIFECYCLE), REPO] },
  });
  return { rec, stdout: await runner.output(rec.job), bin: wrapper };
}

describe('AC3 #40.8dc59e9e The runner starts a pi job from its facts, and the job\'s usage and stop cause are recorded', () => {
  it('AC3 pi\'s facts hold the headless launch: pi --mode json -p with a read-only tool list, no bypass, the versions it covers', () => {
    const facts = readFacts();
    expect(facts.agent, 'the binary the runner looks for on the login PATH').toBe('pi');
    expect(facts.versions).toContain(VERSION);
    const job = facts.launch?.readOnlyJob as Line | undefined;
    expect(job?.prompt, 'a job takes its prompt on stdin').toBe('stdin');
    const args = job?.args as string[];
    expect(args.join(' '), 'the issue\'s headless launch').toMatch(/--mode json\b/);
    expect(args.includes('-p') || args.includes('--print'), 'print mode').toBe(true);
    const tools = args[args.findIndex((a) => a === '--tools' || a === '-t') + 1] ?? '';
    expect(args.some((a) => a === '--tools' || a === '-t'), 'a tool list').toBe(true);
    expect(tools.split(',').filter((t) => !['read', 'grep', 'find', 'ls'].includes(t)), 'only pi\'s read-only tools').toEqual([]);
    expect(args.includes('--no-extensions') || args.includes('-ne'), 'none of the folder\'s or the user\'s own extensions').toBe(true);
    expect(args.includes('--no-approve') || args.includes('-na'), 'a folder\'s project files are ignored without a trust step').toBe(true);
  });

  it('AC3 a job runs on real pi: its session, model, prompt, summed usage and final result are recorded', async () => {
    const { rec } = await piJob([
      { tools: [{ name: 'read', arguments: { path: 'none.txt' } }], usage: { input: 100, output: 10, cacheRead: 5 } },
      { echo: true, usage: { input: 200, output: 20, cacheRead: 7 } },
    ], 'prompt-on-stdin-40');
    expect({ state: rec.state, refused: rec.refused, blocked: rec.blocked }, 'it ran to its end').toEqual({ state: 'finished', refused: undefined, blocked: undefined });
    expect(rec.binary?.version).toBe(VERSION);
    expect(rec.session, 'the session ID from its own output').toMatch(/^[0-9a-f-]{20,}$/);
    expect(rec.model, 'the model that answered, from its output').toBe('scripted-1');
    expect(rec.usage, 'every message once: the sum of the two the scripted model reported').toEqual({ input: 300, cached: 12, output: 30 });
    expect(rec.result, 'its final text; the prompt reached it on stdin').toBe('prompt-on-stdin-40');
    expect(rec.folder.startsWith(join(dirname(rec.folder), ''))).toBe(true);
  }, 150_000);

  it('AC3 a run that ends on an error records the cause its facts name, not a result', async () => {
    const { rec } = await piJob([{ error: '401 Unauthorized: invalid api key', usage: { input: 0, output: 0 } }], 'hi');
    expect(rec.state, `it stopped: ${JSON.stringify(rec)}`).toBe('stopped');
    expect(rec.stop?.cause, 'the facts\' error texts name a 401 as a sign-in to do').toBe('sign_in_required');
    expect(rec.result ?? '', 'an error is no answer').not.toMatch(/\S/);
  }, 150_000);

  it('AC3 an error its facts don\'t name is unknown, never a pass', async () => {
    const { rec } = await piJob([{ error: 'the scripted model has nothing to say', usage: { input: 0, output: 0 } }], 'hi');
    expect(rec.state).toBe('stopped');
    expect(rec.stop?.cause).toBe('unknown');
  }, 150_000);

  it('AC3 a read-only job\'s write is refused by its tool list: no file, and the job still ends', async () => {
    const { rec } = await piJob([{ tools: [{ name: 'write', arguments: { path: 'probe.txt', content: 'no' } }] }, { text: 'tried' }], 'write the probe');
    expect(rec.state).toBe('finished');
    expect(existsSync(join(rec.folder, 'probe.txt')), 'the write never happened').toBe(false);
  }, 150_000);
});
