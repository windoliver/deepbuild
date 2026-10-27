// AC6 #19.3cfcabc5 Right after install, no stop is held and no verdict blocks until the user approves a repo's
// checks, while the fast safety rules apply from the start.
//
// `deep setup` runs in a repo whose `.deepbuild/done.yaml` was drafted (its one check fails) and that you never
// approved. Straight after it, an agent's session there claims its task done and runs that check, which fails, then
// stops: the hub must not hold the stop (its acknowledgement's `hold_until_ms` is null, read off a forwarded socket
// at the address setting) and DeepBuild's Stop entry answers at once with no `decision`; the session's next Edit and
// `ls` go through. Meanwhile the agent's `pkill -f vite` is denied, by the hub and, with the hub down, by deep-hook
// from the rules setup installed. The stop probed has no open ask: a stop the answer route holds for the session's own
// `deep_ask` is #18's (README: Disputes).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  Claude, alive, answers, callId, cleanup, denied, firedShown, forwarder, gitRepo, hubJobs, installedHub, jsonLines, makeHome, newSession, onMac,
  ours, payload, setAddress, setup, sleep, socketOf, toolCall, typedPrompt, waitFor, type Fired, type Forwarder, type Line, type Session,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const PLANT = 'gates-before-approval';

interface World { home: string; repo: string; commit: string; fwd: Forwarder; claude: Claude; s: Session }
/** A repo with a drafted, unapproved spec whose one check fails; `deep setup` run there; a session in it. */
async function world(plant?: string): Promise<World> {
  onMac();
  const { tmp, home } = makeHome();
  const repo = join(tmp, 'shop');
  mkdirSync(join(repo, '.deepbuild'), { recursive: true });
  writeFileSync(join(repo, '.deepbuild', 'done.yaml'), '# Drafted for you; not approved yet.\nchecks:\n  unit:\n    run: exit 1\n');
  writeFileSync(join(repo, 'app.js'), 'export const header = "blue";\n');
  const commit = gitRepo(home, repo);
  const env = plant ? { DEEP_HUB_PLANT: plant } : {};
  await setup(home, { env, cwd: repo });
  await installedHub(home);
  const fwd = await forwarder(tmp, socketOf(home));
  setAddress(home, fwd.path);
  return { home, repo, commit, fwd, claude: Claude.start(home, env), s: newSession(home, repo) };
}

/** The tool call's text, from its MCP reply. */
const replyText = (reply: Line) => JSON.stringify(reply.result ?? reply.error ?? reply);

/** The session claims its task done and runs the drafted check, which fails: a verdict an enforcing gate would act on. */
async function claimAndFail(w: World): Promise<void> {
  const { claude, s } = w;
  await claude.hook('SessionStart', payload(s, 'SessionStart'));
  typedPrompt(s, 'Make the header green, then claim it done.');
  await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: 'Make the header green, then claim it done.' }));
  await claude.initialize();
  const claim = await claude.deepTool(s, 'deep_claim', { task_ref: 'task:header1', attempt: 1, commit: w.commit, scope: 'session', predictions: [{ check: 'unit', expects: 'passed' }] });
  if (!/claim:/.test(replyText(claim)) || claim.result?.isError) throw Error(`BLOCKED: deep_claim wasn't recorded, so there is no verdict to probe: ${replyText(claim)}`);
  const ran = await claude.deepTool(s, 'deep_run', { check: 'unit', claim: null }, 180_000);
  if (!/fail/i.test(replyText(ran)) || ran.result?.isError) throw Error(`BLOCKED: the drafted check's run didn't come back failed, so there is no failed verdict to probe: ${replyText(ran)}`);
}

/** The hub's acknowledgement of the n-th Stop of `session` deep-hook sent through the forwarder, once it is there. */
function stopAck(fwd: Forwarder, session: string, nth: number): Line | undefined {
  const request = jsonLines(fwd.upText()).filter((l) => l.event === 'Stop' && l.payload?.session_id === session)[nth - 1];
  return request ? jsonLines(fwd.downText()).find((l) => l.ack === request.id) : undefined;
}

/** The session stops: not held, and no verdict in DeepBuild's reply. Throws naming the stop otherwise. */
async function stopGoesThrough(w: World): Promise<void> {
  const { claude, s } = w;
  const stopping = claude.hook('Stop', payload(s, 'Stop'));
  const ack = await waitFor(() => stopAck(w.fwd, s.id, 1), 30_000, `the hub's acknowledgement of session ${s.id}'s Stop`);
  if (ack.hold_until_ms !== null) {
    expect.fail(`AC6 right after install the hub held the Stop of session ${s.id} (hold_until_ms ${ack.hold_until_ms}) in a repo whose checks you haven't approved: the hooks start watch-only, so no stop is held until you approve something`);
  }
  const fired = await stopping;
  const foreground = ours(fired).filter((r) => !r.async);
  if (!foreground.length) expect.fail(`deep setup must install a foreground Stop entry of DeepBuild's in ~/.claude/settings.json: ${firedShown(fired)}`);
  for (const r of foreground) {
    if (/"decision"\s*:/.test(r.stdout) || r.code === 2) {
      expect.fail(`AC6 right after install a verdict blocked the Stop of session ${s.id}, in a repo whose checks you haven't approved: DeepBuild's Stop entry answered exit ${r.code}, ${JSON.stringify(r.stdout.slice(0, 400))} ${JSON.stringify(r.stderr.slice(0, 400))}`);
    }
    expect({ code: r.code, timedOut: r.timedOut }, `AC6 DeepBuild's Stop entry must answer at once, exit 0: ${firedShown(fired)}`).toEqual({ code: 0, timedOut: false });
  }
}

/** One Bash call of the session, as Claude Code fires its PreToolUse. */
async function bash(w: World, command: string): Promise<Fired> {
  const id = callId();
  toolCall(w.s, id, 'Bash', { command, description: command });
  return w.claude.hook('PreToolUse', payload(w.s, 'PreToolUse', { tool_name: 'Bash', tool_input: { command, description: command }, tool_use_id: id }));
}
const denialText = (f: Fired) => ours(f).map((r) => `${r.stdout}\n${r.stderr}`).join('\n');

describe('AC6 #19.3cfcabc5 Right after install, no stop is held and no verdict blocks until the user approves a repo\'s checks, while the fast safety rules apply from the start', () => {
  it('AC6 #19.3cfcabc5 straight after deep setup, a session that claims done and fails the drafted check stops unheld and unblocked, its next calls go through, and its pkill -f vite is denied with the hub up and down', async () => {
    const w = await world();
    await claimAndFail(w);
    await stopGoesThrough(w);

    // The next turn: the failed verdict blocks nothing.
    typedPrompt(w.s, 'Now tidy up.');
    await w.claude.hook('UserPromptSubmit', payload(w.s, 'UserPromptSubmit', { prompt: 'Now tidy up.' }));
    const editId = callId();
    const edit = { file_path: join(w.repo, 'app.js'), old_string: '"blue"', new_string: '"green"', replace_all: false };
    toolCall(w.s, editId, 'Edit', edit);
    const edited = await w.claude.hook('PreToolUse', payload(w.s, 'PreToolUse', { tool_name: 'Edit', tool_input: edit, tool_use_id: editId }));
    expect(denied(edited), `AC6 right after install no verdict blocks: the session's next Edit must go through: ${firedShown(edited)}`).toBe(false);
    const listed = await bash(w, 'ls');
    expect(denied(listed), `AC6 right after install the session's ls must go through: ${firedShown(listed)}`).toBe(false);

    // The fast safety rules apply from the start: with the hub up...
    const killed = await bash(w, 'pkill -f vite');
    expect(denied(killed), `AC6 the fast safety rules must apply from the start: right after install DeepBuild let the agent's pkill -f vite through: ${firedShown(killed)}`).toBe(true);
    expect(denialText(killed), `AC6 the denial must say why (no killing by name or port): ${firedShown(killed)}`).toMatch(/name or port/i);

    // ...and with it down, from the rules setup installed for deep-hook.
    const jobs = hubJobs(w.home);
    const pid = jobs[0]?.pid;
    if (!pid) throw Error(`BLOCKED: no running hub job to stop: ${JSON.stringify(jobs)}`);
    process.kill(pid, 'SIGTERM');
    await waitFor(async () => !alive(pid) && !(await answers(socketOf(w.home), 500)), 20_000, `the hub (pid ${pid}) to stop`);
    await sleep(200);
    const downKill = await bash(w, 'pkill -f vite');
    expect(denied(downKill), `AC6 the fast safety rules must hold with the hub down too: deep-hook let the agent's pkill -f vite through: ${firedShown(downKill)}`).toBe(true);
    expect(denialText(downKill), `AC6 the denial with the hub down must say why: ${firedShown(downKill)}`).toMatch(/name or port/i);
  }, 600_000);

  it(`AC6 #19.3cfcabc5 (wrong program) a hub that gates a repo's drafted checks before you approve them (${PLANT}) fails this test, naming the stop`, async () => {
    const w = await world(PLANT);
    await claimAndFail(w);
    let failure = '';
    try { await stopGoesThrough(w); } catch (error) { failure = (error as Error).message; }
    expect(failure, `the watch-only stop check must fail on ${PLANT}`).toMatch(/^AC6 right after install (the hub held|a verdict blocked) the Stop of session /);
    expect(failure).toContain(w.s.id);
  }, 600_000);
});
