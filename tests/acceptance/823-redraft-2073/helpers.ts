// What #2073's Scope changes in the world #823's deep_run tests play in, and nothing else (REDRAFT.md): the fixture
// repo is trusted by the core's decision before the hub starts, and its spec's two checks are lines a claim's checks
// count, running a script the claim's commit holds. Everything else is the frozen ../823/helpers.ts, imported
// unchanged; `trustedWorld` follows its `agentWorld` step for step. Processes are stopped by PID only, by its `cleanup`.

import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openRecord, openTrust } from '../../../packages/record/src/index.ts';
import { Agent, alive, rootOf, sleep, startHub, tempDir, ulid, type World } from '../823/helpers.ts';

/**
 * checks/wait.mjs, as the claim's commit holds it: one Node process that waits and exits 0. Given two times in
 * seconds it waits between them, the time drawn by the process itself for each run; given one, that long. It reads no
 * file and starts no program.
 */
const WAIT_SCRIPT = `const [least, most = least] = process.argv.slice(2).map(Number);
setTimeout(() => {}, 1000 * (least + Math.random() * (most - least)));
`;
/**
 * The repo's spec, #823's with its two commands rewritten as ones a claim's checks count (design: Traced programs):
 * `pause` waits 200 to 300 ms, drawn by its own process, so a run ends at no fixed phase; `long` waits a minute.
 */
function doneYaml(): string {
  return [
    'claims:',
    '  done:',
    '    checks: [pause]',
    'checks:',
    '  pause: { type: command, run: "node checks/wait.mjs 0.2 0.3" }',
    '  long: { type: command, run: "node checks/wait.mjs 60" }',
    'asks:',
    '  deadline: { taste: 3d, authority: 1d, unblock: 2d, exception: 2d, choice: 2d, definition: 4h }',
    '  default: { taste: recommended, authority: "no", unblock: stay-blocked, exception: no-change, choice: recommended, definition: leave-out }',
    '  fallback: [change-owner]',
    '',
  ].join('\n');
}
const GIT_ENV = { GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
/** A worktree at `dir`: a fresh git repo of its own (never this checkout) whose one commit holds the spec and the script its checks run. */
function makeWorktree(dir: string): { path: string; commit: string } {
  mkdirSync(join(dir, '.deepbuild'), { recursive: true });
  mkdirSync(join(dir, 'checks'));
  writeFileSync(join(dir, '.deepbuild', 'done.yaml'), doneYaml());
  writeFileSync(join(dir, 'checks', 'wait.mjs'), WAIT_SCRIPT);
  const env = { ...process.env, ...GIT_ENV, HOME: dir };
  const git = (...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, env, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');
  return { path: realpathSync(dir), commit: git('rev-parse', 'HEAD') };
}

/**
 * Seeds <home>/.deepbuild/ledger.db with the hub stopped: the session's start in `worktree`, as #823's seed appends
 * it, and the project's trust decision, your answer on the trusted path, as #2073's suite records it (`openTrust` of
 * the record's public entry, with the app's connection).
 */
async function seed(home: string, session: string, worktree: string): Promise<void> {
  mkdirSync(rootOf(home), { recursive: true, mode: 0o700 });
  const now = Date.now();
  const record = await openRecord({ path: join(rootOf(home), 'ledger.db'), now: () => now });
  try {
    await record.append({ writer: 'hook', actor: 'you', scope: 'you', session, project: 'shop', agent: 'claude-code' }, { v: 1, id: ulid(now), kind: 'session.start', ts: now, data: { agent: 'claude-code', worktree, branch: 'main', thread: session } });
    await (await openTrust({ record, now: () => now })).answer({ writer: 'app', actor: 'you', scope: 'you' }, worktree, true);
  } finally {
    await record.close();
  }
}

/**
 * #823's `agentWorld()` with no asks, in a repo the core's decision marks trusted: a home, the worktree, an agent
 * stand-in working there, the hub, the session established through its hooks, and the agent's deep mcp initialized.
 * The home holds no ~/.claude.json and no ~/.codex/config.toml, so nothing else trusts the folder. A hub that doesn't
 * start throws BLOCKED, naming why.
 */
export async function trustedWorld(): Promise<World> {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  mkdirSync(home);
  const wt = makeWorktree(join(tmp, 'work'));
  const agent = Agent.start(home, wt.path);
  const session = agent.session(wt.path);
  await seed(home, session.id, wt.path);
  const started = await startHub(home);
  if (!started.hub) throw Error(`BLOCKED: ${started.why}`);
  const hub = started.hub;
  await agent.establish(hub, session);
  const { reply } = await agent.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-823', version: '0' } });
  if (!reply.result) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(reply)}`);
  await agent.notify('notifications/initialized');
  // deep mcp connects to the hub at its first call and gives up after 1 s; on a loaded machine that first connect can
  // miss, so one deep_status is called, up to ten times a second apart, as an `unavailable` refusal's remediation says.
  for (let i = 1; ; i++) {
    const status = await agent.call('deep_status', {});
    if (!status.isError) break;
    if (i === 10 || status.value?.code !== 'unavailable') throw Error(`BLOCKED: deep_status through the agent's deep mcp failed ${i} times: ${JSON.stringify(status.reply).slice(0, 1500)}; the hub ${alive(hub.pid) ? 'runs' : 'exited'}: ${hub.output().slice(-2000)}`);
    await sleep(1000);
  }
  return { tmp, home, wt, agent, session, hub, asks: [] };
}
