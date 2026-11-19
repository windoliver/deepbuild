// A world for #2650's job tests (AC4): a real record on SQLite in a temp folder, the real asks core and budget ledger
// on it, the real supervisor, and the runner opened on all of them through its public entry, `@deepbuild/runner`. The
// agent is the stand-in `claude` (fixtures/claude.pl), first on the login shell's PATH that setup would record, at the
// newest version the adapter facts cover. The account it signs in to is the one `~/.claude.json` names, and the world
// reports one window reading with room for it, so a job gets past the runner's wait for its account's first reading
// (`runner.window`). Nothing here stands in for the runner, the supervisor or the sandbox.
//
// Safety: every folder is under /tmp/dh2650-*; HOME is a temp folder for this process and every job; the agent's own
// CLAUDE*, DEEP_* and ANTHROPIC_* variables are removed first, so no job bills an API key; no `claude` here is real, no
// job calls a model, and the sign-in files hold made-up values. Each job's processes are the supervisor's, which the
// runner stops by its run; nothing is stopped by name or port.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll } from 'vitest';
import type { JobRecord, JobSpec, Plant, Runner } from '../../../packages/runner/src/index.ts';
import { openAsks } from '../../../packages/asks/src/index.ts';
import { openLedger } from '../../../packages/budget/src/index.ts';
import { openRecord, type RecordStore } from '../../../packages/record/src/index.ts';
import { openSupervisor, type Supervisor } from '../../../packages/supervisor/src/index.ts';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const STAND_IN = fileURLToPath(new URL('./fixtures/claude.pl', import.meta.url));
const RUNNER_ENTRY = '../../../packages/runner/src/index.ts';
const DAY = 86_400_000;
/** The account Claude Code keeps beside the made-up sign-in (`oauthAccount.accountUuid` in ~/.claude.json). */
export const ACCOUNT = '0a0a0a0a-2650-4222-8333-444444444444';

for (const key of Object.keys(process.env)) if (key.startsWith('CLAUDE') || key.startsWith('DEEP_') || key.startsWith('ANTHROPIC_') || key === 'AI_AGENT') delete process.env[key];

const made: string[] = [];
const opened: { close(): Promise<void> }[] = [];
afterAll(async () => {
  for (const w of opened.splice(0)) await w.close().catch(() => undefined);
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

export interface RunnerWorld { dir: string; home: string; record: RecordStore; sup: Supervisor; runner: Runner; close(): Promise<void> }

/** The world, its runner opened with the plant given, and one window reading with room reported for the account. */
export async function openRunnerWorld(o: { plant?: Plant } = {}): Promise<RunnerWorld> {
  const dir = realpathSync(mkdtempSync('/tmp/dh2650-run-'));
  made.push(dir);
  const home = join(dir, 'h');
  const bin = join(dir, 'bin');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(bin);
  process.env.HOME = home;
  writeFileSync(join(home, '.claude.json'), `${JSON.stringify({ oauthAccount: { accountUuid: ACCOUNT, emailAddress: 'dh2650@example.invalid' }, mcpServers: {}, projects: {} })}\n`);
  writeFileSync(join(home, '.claude', '.credentials.json'), `${JSON.stringify({ claudeAiOauth: { accessToken: 'made-up', refreshToken: 'made-up', expiresAt: 4102444800000, scopes: ['user:inference'], subscriptionType: 'max' } })}\n`, { mode: 0o600 });
  writeFileSync(join(home, '.claude', 'settings.json'), '{}\n');
  const versions = (JSON.parse(readFileSync(join(REPO, 'adapters/claude-code.facts.json'), 'utf8')) as { versions: string[] }).versions;
  writeFileSync(join(bin, 'claude'), readFileSync(STAND_IN, 'utf8').replace('__VERSION__', versions.at(-1)!), { mode: 0o755 });
  chmodSync(join(bin, 'claude'), 0o755);

  const now = Date.now;
  const record = await openRecord({ path: join(dir, 'ledger.db'), now });
  const asks = await openAsks({ record, now, deliver: () => undefined });
  const ledger = await openLedger({ record, asks, now, price: async () => 0.5 });
  const sup = await openSupervisor({ record, asks, now, settings: { asks: { unblock: { deadline_ms: 2 * DAY } } } });
  const { openRunner } = (await import(new URL(RUNNER_ENTRY, import.meta.url).href)) as typeof import('../../../packages/runner/src/index.ts');
  const runner = await openRunner({
    record, asks, supervisor: sup, ledger, now, root: join(home, '.deepbuild'), loginPath: `${bin}:/usr/bin:/bin`,
    env: { HOME: home, PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' },
    settings: { plan: { reserve_pct: 10 }, asks: { unblock: { deadline_ms: 2 * DAY } } },
    ...(o.plant ? { plant: o.plant } : {}),
  });
  // One window reading with room: 5% of the 5-hour window used, as Claude Code's status line reports it.
  const s = Math.floor(Date.now() / 1000);
  await runner.report({ agent: 'claude-code', account: ACCOUNT, rate_limits: { five_hour: { used_percentage: 5, resets_at: s + 3 * 3600 }, seven_day: { used_percentage: 20, resets_at: s + 5 * 86_400 } } });
  let closed = false;
  const w: RunnerWorld = {
    dir, home, record, sup, runner,
    close: async () => {
      if (closed) return;
      closed = true;
      await runner.close();
      await sup.close();
      await record.close();
    },
  };
  opened.push(w);
  return w;
}

/** A read job on the stand-in, its prompt naming the result it ends with (fixtures/claude.pl). */
export const job = (result: string): JobSpec => ({ kind: 'read', agent: 'claude-code', prompt: `@result ${result}\n` });
export type { JobRecord };
