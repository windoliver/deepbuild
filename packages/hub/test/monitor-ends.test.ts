// A session that armed Claude Code's Monitor reads waiting on its monitor until the watch ends (#997), its stop judged
// only then. A watch that ends with no stop after it, by the watched process ending, its timeout passing, the session
// ending or a TaskStop whose hook comes after the stop, makes that stop final: the row reads it again and its claim is
// judged, once. Through deep-hook and a Claude Code stand-in whose hooks are children of this process, as an agent's
// are of it, so the command this test starts is the watch's. Needs `npm run build` and `cargo build -p deep-hook`.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { allEvents, childEnv, cleanup, CLI, control, DEEP_HOOK, makeWorld, NODE, own, QUESTION, run, Session, settle, sleep, startHub, stopHub, type Ev, type Hub, type Line, type Ran } from '../../../tests/acceptance/29/h-d.ts';

afterEach(cleanup);

/** A Claude Code session whose hooks run as children of this process: the agent whose process tree the hub reads. */
class Direct extends Session {
  override async hook(event: string, fields: Line = {}, timeoutMs = 150_000): Promise<Ran> {
    const body: Line = { session_id: this.id, transcript_path: this.transcript, cwd: this.cwd, hook_event_name: event, permission_mode: 'default', ...(this.prompt && event !== 'SessionStart' ? { prompt_id: this.prompt } : {}), ...fields };
    const ran = await run(DEEP_HOOK, ['claude-code', event], { cwd: this.cwd, input: JSON.stringify(body), timeoutMs, env: childEnv(this.w.home, { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_PROJECT_DIR: this.w.repo }) });
    this.hooks.push({ event, ran });
    return ran;
  }
  /** A monitor's event, arriving as a prompt (turnOrigin task_notification), as the corpus's monitor session has it. */
  wake(watch: string, event: string): Promise<Ran> {
    const text = `<task-notification>\n<task-id>${watch}</task-id>\n<summary>Monitor event: "the build log"</summary>\n<event>${event}</event>\n</task-notification>`;
    return (this as unknown as { submit(text: string, entry: Line): Promise<Ran> }).submit(text, { isMeta: true, promptSource: 'system', turnOrigin: 'task_notification' });
  }
}
const WATCH = 'bw997e4k2';
const rowOf = async (hub: Hub, id: string): Promise<Line | undefined> => ((await control(hub, 'status.read', {})).rows as Line[]).find((r) => r.id === id);
const waiting = (row: Line | undefined) => row?.state === 'working' && String(row.why).startsWith('Waiting on its monitor');
const ended = (events: readonly Ev[], why: string) => events.some((e) => e.kind === 'session.reading' && String(e.data.reading).startsWith('Its monitor') && String(e.data.reading).includes(why));
const claims = (events: readonly Ev[], s: Session) => events.filter((e) => e.kind === 'claim.made' && e.session === s.id);

/** A session that arms a monitor on `command` and stops: its row reads waiting on it, and its stop isn't judged yet. */
async function armed(hub: Hub, s: Direct, command: string, timeoutMs: number): Promise<void> {
  await s.start();
  await s.typed(QUESTION);
  await s.call('Monitor', { command, description: 'the build log', timeout_ms: timeoutMs }, { response: { taskId: WATCH, timeoutMs, persistent: false } });
  await s.stop('I armed a monitor on the build log.');
  const events = await settle(hub, (e) => e.some((x) => x.kind === 'session.reading' && String(x.data.reading).startsWith('Waiting on its monitor')), 30_000);
  expect(waiting(await rowOf(hub, s.id)), 'the row reads waiting on its monitor while the watch runs').toBe(true);
  expect(claims(events, s), 'the stop is not judged while the watch runs').toEqual([]);
}
/** Once the watch ended by `why`: the row reads the stop as `state`, and the stop is judged once. */
async function handedBack(hub: Hub, s: Direct, why: string, state: (row: Line | undefined) => boolean): Promise<void> {
  const events = await settle(hub, (e) => ended(e, why) && claims(e, s).length > 0, 30_000);
  expect(ended(events, why), `the record says the watch ended: ${why}`).toBe(true);
  expect(state(await rowOf(hub, s.id)), `once the watch ended (${why}), the row reads its stop again`).toBe(true);
  await sleep(3000);
  expect(claims(await allEvents(hub), s).length, `the stop is judged once the watch ended (${why})`).toBe(1);
}
// A stop that was judged reads by its claim (#2018): says done until its verdict, then the verdict's word.
const finished = (row: Line | undefined) => ['finished', 'says done', 'PASS', 'sent back', 'BLOCKED', 'INVALID', 'INCONCLUSIVE'].includes(String(row?.state));
/** `deep off`, run as you would from your own shell: double-forked out of this process, which plays the agent. Its exit code. */
async function offOutsideTree(w: ReturnType<typeof makeWorld>): Promise<string> {
  const dir = mkdtempSync(join(w.tmp, 'off-'));
  const env = childEnv(w.home);
  spawn('/bin/sh', ['-c', `( sleep 1; '${NODE}' '${CLI}' off >'${dir}/out' 2>&1 </dev/null; echo $? >'${dir}/code.tmp'; mv '${dir}/code.tmp' '${dir}/code' ) </dev/null >/dev/null 2>&1 &`], { cwd: w.repo, env, stdio: 'ignore' });
  for (const deadline = Date.now() + 60_000; Date.now() < deadline; await sleep(200)) if (existsSync(join(dir, 'code'))) return readFileSync(join(dir, 'code'), 'utf8').trim() + (readFileSync(join(dir, 'code'), 'utf8').trim() === '0' ? '' : ` ${readFileSync(join(dir, 'out'), 'utf8')}`);
  return 'timed out';
}

describe('#997 a monitor\'s watch that ends with no stop after it makes the last stop final', () => {
  it('the watched process ending', async () => {
    const w = makeWorld();
    const hub = await startHub(w);
    const command = 'sleep 300; : tail the build log 997';
    const watched = spawn('/bin/sh', ['-c', command], { detached: true, stdio: 'ignore' });
    own(watched.pid);
    try {
      const s = new Direct(w);
      await armed(hub, s, command, 1_800_000);
      // The hub finds the watch's process group off the hook's path, as it does a background command's (#907).
      await sleep(4000);
      process.kill(-watched.pid!, 'SIGTERM');
      await handedBack(hub, s, 'its process ended', finished);
    } finally {
      try { process.kill(-watched.pid!, 'SIGKILL'); } catch { /* gone */ }
      await stopHub(hub);
    }
  }, 120_000);

  it('its timeout passing', async () => {
    const w = makeWorld();
    const hub = await startHub(w);
    try {
      const s = new Direct(w);
      await armed(hub, s, 'tail -F build.log', 6000);
      await handedBack(hub, s, 'its timeout passed', finished);
    } finally {
      await stopHub(hub);
    }
  }, 120_000);

  it('the session ending', async () => {
    const w = makeWorld();
    const hub = await startHub(w);
    try {
      const s = new Direct(w);
      await armed(hub, s, 'tail -F build.log', 1_800_000);
      await s.end();
      await handedBack(hub, s, 'its session ended', (row) => !waiting(row));
    } finally {
      await stopHub(hub);
    }
  }, 120_000);

  it('a TaskStop whose hook comes after the stop', async () => {
    const w = makeWorld();
    const hub = await startHub(w);
    try {
      const s = new Direct(w);
      await armed(hub, s, 'tail -F build.log', 1_800_000);
      await s.hook('PostToolUse', { tool_name: 'TaskStop', tool_input: { task_id: WATCH }, tool_use_id: 'toolu_997latetaskstop', tool_response: { message: `Successfully stopped task: ${WATCH}`, task_id: WATCH, task_type: 'local_bash' }, duration_ms: 40 });
      await handedBack(hub, s, 'a stop call named it', finished);
    } finally {
      await stopHub(hub);
    }
  }, 120_000);
});

describe('#997 a monitor\'s watch keeps the row waiting through its wakes, and its stop is judged once', () => {
  it('with deep off, a wake\'s stop is never held, and the row still reads waiting on its monitor after it', async () => {
    const w = makeWorld();
    const hub = await startHub(w);
    try {
      const s = new Direct(w);
      await armed(hub, s, 'tail -F build.log', 1_800_000);
      expect(await offOutsideTree(w), '`deep off`, run from outside the session\'s process tree, exits 0').toBe('0');
      for (const tick of ['tick-1', 'tick-2']) {
        await s.wake(WATCH, tick);
        await s.stop(tick);
        await sleep(3000);
        expect(waiting(await rowOf(hub, s.id)), `after the ${tick} wake's stop, the row reads waiting on its monitor`).toBe(true);
      }
      expect(claims(await allEvents(hub), s), 'no stop is judged while the watch runs').toEqual([]);
    } finally {
      await stopHub(hub);
    }
  }, 120_000);

  it('two watches: one\'s timeout passing leaves the row waiting on the other, its stop not yet judged', async () => {
    const w = makeWorld();
    const hub = await startHub(w);
    try {
      const s = new Direct(w);
      await s.start();
      await s.typed(QUESTION);
      await s.call('Monitor', { command: 'tail -F build.log', description: 'the build log', timeout_ms: 6000 }, { response: { taskId: WATCH, timeoutMs: 6000, persistent: false } });
      await s.call('Monitor', { command: 'tail -F deploy.log', description: 'the deploy log', timeout_ms: 1_800_000 }, { response: { taskId: 'bw997d3p1', timeoutMs: 1_800_000, persistent: false } });
      await s.stop('I armed two monitors.');
      const events = await settle(hub, (e) => ended(e, 'its timeout passed'), 30_000);
      await sleep(3000);
      const row = await rowOf(hub, s.id);
      expect(waiting(row) && String(row!.why).includes('the deploy log') && !String(row!.why).includes('the build log'), `the row reads waiting on the watch still running: ${JSON.stringify(row)}`).toBe(true);
      expect(claims(await allEvents(hub), s), 'the stop is not judged while a watch still runs').toEqual([]);
      expect(ended(events, 'its timeout passed')).toBe(true);
    } finally {
      await stopHub(hub);
    }
  }, 120_000);

  it('a wake after its watch ended, with no work in its turn, doesn\'t judge the stop again', async () => {
    const w = makeWorld();
    const hub = await startHub(w);
    try {
      const s = new Direct(w);
      await armed(hub, s, 'tail -F build.log', 6000);
      await handedBack(hub, s, 'its timeout passed', finished);
      await s.wake(WATCH, 'tick-last');
      const late = await s.stop('tick-last');
      expect(late.stdout, 'the late wake\'s stop, with no work in its turn, is not judged again: its reply carries no verdict line').not.toMatch(/systemMessage|"decision"/);
      await sleep(3000);
      expect(claims(await allEvents(hub), s).length, 'the stop its watch\'s end judged is judged once').toBe(1);
    } finally {
      await stopHub(hub);
    }
  }, 120_000);
});
