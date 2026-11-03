// A session that armed Claude Code's Monitor reads waiting on its monitor until the watch ends (#997), its stop judged
// only then. A watch that ends with no stop after it, by the watched process ending, its timeout passing, the session
// ending or a TaskStop whose hook comes after the stop, makes that stop final: the row reads it again and its claim is
// judged, once. Through deep-hook and a Claude Code stand-in whose hooks are children of this process, as an agent's
// are of it, so the command this test starts is the watch's. Needs `npm run build` and `cargo build -p deep-hook`.
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { allEvents, childEnv, cleanup, control, DEEP_HOOK, makeWorld, own, QUESTION, run, Session, settle, sleep, startHub, stopHub, type Ev, type Hub, type Line, type Ran } from '../../../tests/acceptance/29/h-d.ts';

afterEach(cleanup);

/** A Claude Code session whose hooks run as children of this process: the agent whose process tree the hub reads. */
class Direct extends Session {
  override async hook(event: string, fields: Line = {}, timeoutMs = 150_000): Promise<Ran> {
    const body: Line = { session_id: this.id, transcript_path: this.transcript, cwd: this.cwd, hook_event_name: event, permission_mode: 'default', ...(this.prompt && event !== 'SessionStart' ? { prompt_id: this.prompt } : {}), ...fields };
    const ran = await run(DEEP_HOOK, ['claude-code', event], { cwd: this.cwd, input: JSON.stringify(body), timeoutMs, env: childEnv(this.w.home, { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_PROJECT_DIR: this.w.repo }) });
    this.hooks.push({ event, ran });
    return ran;
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
const finished = (row: Line | undefined) => row?.state === 'finished';

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
