// A real hub holds a green stop's slow checks while the session's background command runs, and starts them once the
// command's process group ends (#907): the session's row says what they wait for. Through deep-hook and a Claude Code
// stand-in whose hooks are children of this process, as an agent's are of it, so the command this test starts in the
// background is the agent's. Needs `npm run build` and `cargo build -p deep-hook`.
import { spawn } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  allEvents, askNamed, BEHAVIOR, childEnv, cleanup, DEEP_HOOK, draftFor, lockedFor, makeWorld, own, req, run, Session, settle, sleep, startHub, stopHub, taskOf,
  type Ev, type Line, type Ran,
} from '../../../tests/acceptance/29/h-d.ts';

afterEach(cleanup);
const CHECK = '.deepbuild/checks/journey.sh';
/** The background command: its process's arguments hold its text, as a shell running it does. */
const COMMAND = 'sleep 300; : npm run e2e';

/** A Claude Code session whose hooks run as children of this process: the agent whose process tree the hub reads. */
class Direct extends Session {
  override async hook(event: string, fields: Line = {}, timeoutMs = 150_000): Promise<Ran> {
    const body: Line = { session_id: this.id, transcript_path: this.transcript, cwd: this.cwd, hook_event_name: event, permission_mode: 'default', ...(this.prompt && event !== 'SessionStart' ? { prompt_id: this.prompt } : {}), ...fields };
    const ran = await run(DEEP_HOOK, ['claude-code', event], { cwd: this.cwd, input: JSON.stringify(body), timeoutMs, env: childEnv(this.w.home, { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_PROJECT_DIR: this.w.repo }) });
    this.hooks.push({ event, ran });
    return ran;
  }
}
const runsOf = (events: readonly Ev[], claim: Ev) => events.filter((e) => e.kind === 'run.started' && e.data.claim === `claim:${claim.id}`);
const claimsOf = (events: readonly Ev[], ref: string) => events.filter((e) => e.kind === 'claim.made' && e.data.task_ref === ref);

describe('#907 a background command holds a stop\'s slow checks in a real hub until its process group ends', () => {
  it('the journey waits while the command runs, the row names it, and the journey starts once its process group ends', async () => {
    // The journey takes 11 s: its first run, in the fast lane, records that, so the 10 s budget leaves it to the slow lane after.
    const w = makeWorld({ drafts: [draftFor(BEHAVIOR, { requirements: [req('R1', 'an expired token is rejected', { check: CHECK })], deliverables: ['src/auth.ts'] })] });
    writeFileSync(join(w.repo, CHECK), '#!/bin/sh\nsleep 11\n');
    chmodSync(join(w.repo, CHECK), 0o755);
    const { execFileSync } = await import('node:child_process');
    execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'add', '-A'], { cwd: w.repo });
    execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'the check'], { cwd: w.repo });
    const hub = await startHub(w);
    const background = spawn('/bin/sh', ['-c', COMMAND], { detached: true, stdio: 'ignore' });
    own(background.pid);
    try {
      const s = new Direct(w);
      await s.start();
      await s.typed(BEHAVIOR);
      const opened = await settle(hub, (e) => { const r = taskOf(askNamed(e, s, BEHAVIOR)); return r !== undefined && lockedFor(e, r).length > 0; });
      const ref = taskOf(askNamed(opened, s, BEHAVIOR))!;
      // Turn 1: the journey's first run, in the fast lane.
      await s.edit('src/auth.ts', 'token.exp > 0', 'token.exp > Date.now()');
      await s.stop('checkToken now compares `src/auth.ts:2` with the clock.');
      await settle(hub, (e) => e.some((x) => x.kind === 'run.finished' && x.data.outcome === 'passed'), 90_000);
      // Turn 2, a /loop wake-up's: another change, the command started in the background, and a green stop.
      await s.scheduled('/loop keep the auth checks green');
      await s.edit('src/auth.ts', 'token.exp > Date.now()', 'token.exp >= Date.now()');
      const call = await s.call('Bash', { command: COMMAND, description: 'Run the e2e suite', run_in_background: true }, { response: { stdout: '', stderr: '', interrupted: false, isImage: false, backgroundTaskId: 'bq7x2k9m4' } });
      expect(call.allowed, 'the background command is allowed').toBe(true);
      await s.stop('The e2e suite runs in the background.');
      const held = await settle(hub, (e) => claimsOf(e, ref).length >= 2 && e.some((x) => x.kind === 'session.reading' && String(x.data.reading).includes('in the background')), 150_000);
      const second = claimsOf(held, ref)[1]!;
      await sleep(4000);
      expect(runsOf(await allEvents(hub), second), `the journey must wait while \`${COMMAND}\` runs in the background; it started at the stop`).toEqual([]);
      const reading = held.find((x) => x.kind === 'session.reading' && String(x.data.reading).includes('in the background'));
      expect(String(reading?.data.reading), 'the session\'s row names the check and the command it waits for').toContain(COMMAND);
      // The command's process group ends: the journey starts, with the session idle.
      process.kill(-background.pid!, 'SIGTERM');
      const started = await settle(hub, (e) => runsOf(e, second).length > 0, 20_000);
      expect(runsOf(started, second).map((r) => r.data.lane), 'once its process group ends, the journey starts in the slow lane').toEqual(['slow']);
    } finally {
      try { process.kill(-background.pid!, 'SIGKILL'); } catch { /* gone */ }
      await stopHub(hub);
    }
  }, 240_000);
});
