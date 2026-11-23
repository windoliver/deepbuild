// #2651 AC3 (#2651.1de95500): "A hook from a running job's own session is still that job's. One from its folder before
// its session ID is read still waits. One that only resumes a job's session ID, or only works in its folder, still gets
// its reading. A planted hub that looks only at the sessions of running jobs misses the folder case and fails, naming
// the hook"
//   node --test tests/acceptance/2651/whose.test.mjs     # about 2 minutes; macOS, the checkout built, perl
// A hub of this checkout (`deep hub run`, HOME a temp folder with a made-up Claude Code sign-in) runs read jobs on the
// stand-in `claude` (fixtures/fake-claude.pl, #159's), past the plan window with a reading of room. Every hook is carried
// to the hub's socket by the test as deep-hook sends it (the job's stand-in runs in the sandbox and can't reach it). Four
// hooks, each a PreToolUse, are judged (judgeWhose):
//   own      from a running job's session, the runner having read that ID: recorded as the job's job.event, never as
//            the session's own event
//   folder   from a running job's folder, with the session ID the job will print, sent while the runner hasn't read it
//            (the stand-in waits 5 s before its init line): it waits, recorded as the job's job.event no earlier than the
//            last moment the test saw that ID unread, and never as the session's own event
//   resumed  from a session that resumes a finished job's session ID, in another folder: the session's own, with a
//            session.reading naming the job
//   visitor  from a session of yours working in that finished job's folder: the session's own, with a session.reading
//            naming the job
// One test: it passes when no hook is judged wrong on this checkout's hub, and the same scenario on the hub with
// DEEP_HUB_PLANT=whose-running-sessions-only makes the judgment name the folder hook. A hub that refuses the plant
// fails the test at that assertion.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { AC, CHANGE, client, events, installClaude, machine, payloadOf, removeDir, room, sendHook, signIn, startHub, stopHub, stopLeftovers, tempDir, unbuilt, until, uuid } from './lib.mjs';

const PLANT = 'whose-running-sessions-only';
const ENDED = ['finished', 'stopped', 'refused', 'lost'];
const job = (prompt) => ({ kind: 'read', agent: 'claude-code', prompt, deadline_ms: 120_000 });

/** The four hooks on a hub of this checkout (`env` its extra environment): what the record and the replies showed. */
async function scenario(env = {}) {
  const home = tempDir('ac3');
  const bin = join(home, 'bin');
  installClaude(bin);
  signIn(home);
  mkdirSync(join(home, '.deepbuild'), { recursive: true });
  writeFileSync(join(home, '.deepbuild', 'config.json'), JSON.stringify({ runner: { login_path: `${bin}:/usr/bin:/bin` }, plan: { reserve_pct: 10 } }));
  const hub = await startHub(CHANGE, home, env);
  const c = await client(hub);
  const status = (id) => c.call('job.status', { job: id });
  const submit = (prompt) => c.call('job.submit', { spec: job(prompt) });
  const hooks = {};
  try {
    await room(c);
    // own: a running job whose session ID the runner has read.
    const ownSession = uuid();
    const own = await submit(`Read.\n@session ${ownSession}\n@sleep 8000`);
    await until(async () => (await status(own.job)).session === ownSession, 60_000, `BLOCKED: the runner never read ${own.job}'s session ID (${JSON.stringify(await status(own.job))})`);
    const sent = await sendHook(hub.socket, 'PreToolUse', payloadOf(home, ownSession, own.folder, { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'toolu_dh2651own' }));
    hooks.own = { id: sent.id, job: own.job, session: ownSession, what: `the PreToolUse ${sent.id} from job ${own.job}'s own session ${ownSession}` };

    // folder: a running job whose session ID the runner hasn't read yet.
    const folderSession = uuid();
    const early = await submit(`Read.\n@session ${folderSession}\n@delay-init 5000\n@sleep 1000`);
    await until(async () => (await status(early.job)).pid, 60_000, `BLOCKED: ${early.job} never started`);
    if ((await status(early.job)).session !== undefined) assert.fail(`BLOCKED: the scenario didn't form: the runner had read ${early.job}'s session ID before its hook`);
    const held = await sendHook(hub.socket, 'PreToolUse', payloadOf(home, folderSession, early.folder, { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'toolu_dh2651folder' }), { ms: 60_000 });
    // When the runner read the session ID: after `unreadAt`, the last time the test saw it unread.
    let unreadAt = Date.now();
    await until(async () => {
      const s = await status(early.job);
      if (s.session === folderSession || ENDED.includes(s.state)) return true;
      unreadAt = Date.now();
      return false;
    }, 60_000, `BLOCKED: the runner never read ${early.job}'s session ID`);
    hooks.folder = {
      id: held.id, job: early.job, session: folderSession, folder: early.folder, unreadAt,
      what: `the PreToolUse ${held.id} from job ${early.job}'s folder ${early.folder}, sent before its session ID was read`,
    };

    // A finished job, with a session ID and a folder of its own.
    const doneSession = uuid();
    const done = await submit(`Read.\n@session ${doneSession}`);
    const ended = await until(async () => { const s = await status(done.job); return ENDED.includes(s.state) && s; }, 60_000, `BLOCKED: ${done.job} never ended`);
    if (ended.state !== 'finished' || ended.session !== doneSession) assert.fail(`BLOCKED: ${done.job} ended ${JSON.stringify(ended)}, not finished with its session ID`);
    // resumed: a session that resumes that job's session ID, working elsewhere.
    const elsewhere = join(home, 'elsewhere');
    mkdirSync(elsewhere, { recursive: true });
    await sendHook(hub.socket, 'SessionStart', payloadOf(home, doneSession, elsewhere, { source: 'resume', model: 'claude-haiku-4-5' }));
    const resumed = await sendHook(hub.socket, 'PreToolUse', payloadOf(home, doneSession, elsewhere, { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'toolu_dh2651resumed' }));
    hooks.resumed = { id: resumed.id, job: done.job, session: doneSession, what: `the PreToolUse ${resumed.id} of session ${doneSession}, which resumes finished job ${done.job}'s session ID in ${elsewhere}` };
    // visitor: a session of yours working in that job's folder.
    const visitor = uuid();
    await sendHook(hub.socket, 'SessionStart', payloadOf(home, visitor, done.folder, { source: 'startup', model: 'claude-haiku-4-5' }));
    const visited = await sendHook(hub.socket, 'PreToolUse', payloadOf(home, visitor, done.folder, { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'toolu_dh2651visitor' }));
    hooks.visitor = { id: visited.id, job: done.job, session: visitor, what: `the PreToolUse ${visited.id} of session ${visitor}, working in finished job ${done.job}'s folder ${done.folder}` };

    // What the record holds of them, once the jobs have ended and what they held is written.
    await until(async () => ENDED.includes((await status(own.job)).state) && ENDED.includes((await status(early.job)).state), 60_000, 'BLOCKED: the jobs never ended');
    let all = [];
    await until(async () => {
      all = await events(c);
      return all.some((e) => e.kind === 'job.event' && e.data?.job === early.job) && all.some((e) => e.kind === 'session.reading' && e.session === visitor);
    }, 15_000, () => 'the record never showed the folder hook as a job event or the visitor\'s reading').catch(() => undefined);
    return { hooks, events: all };
  } finally {
    c.close();
    await stopHub(hub);
    stopLeftovers(home);
    removeDir(home);
  }
}

/** Each hook the hub took for the wrong owner, named; empty when all four are as AC3 states. */
function judgeWhose({ hooks, events: all }) {
  const problems = [];
  const jobEvents = (h) => all.filter((e) => e.kind === 'job.event' && e.data?.job === h.job && e.data?.event === 'PreToolUse');
  const jobEvent = (h) => jobEvents(h).length > 0;
  const asSession = (h) => all.filter((e) => e.session === h.session && e.kind === 'tool.before').length;
  const reading = (h) => all.some((e) => e.kind === 'session.reading' && e.session === h.session && String(e.data?.reading ?? '').includes(h.job));
  const { own, folder, resumed, visitor } = hooks;
  if (!jobEvent(own) || asSession(own)) problems.push(`${own.what} is not that job's: ${jobEvent(own) ? '' : 'no job.event of the job records it; '}${asSession(own)} tool.before recorded as the session's own`);
  // Waited: its job.event was written no earlier than the last moment the test saw the job's session ID unread.
  const early = jobEvents(folder).filter((e) => e.ts < folder.unreadAt);
  if (early.length) problems.push(`${folder.what} did not wait: it was recorded as the job's at ${early[0].ts}, ${folder.unreadAt - early[0].ts} ms before the runner had read the job's session ID`);
  if (!jobEvent(folder) || asSession(folder)) problems.push(`${folder.what} is not that job's: ${jobEvent(folder) ? '' : 'no job.event of the job records it; '}${asSession(folder)} tool.before recorded as session ${folder.session}'s own`);
  for (const h of [resumed, visitor]) {
    if (!reading(h)) problems.push(`${h.what} got no session.reading naming ${h.job}`);
    if (!asSession(h)) problems.push(`${h.what} was not recorded as the session's own tool.before`);
  }
  return problems;
}

describe(`${AC[3]} whose a hook is: a job's, held for one, or the session's with a reading`, () => {
  it(`${AC[3]} a running job's own session's hook is the job's, one from its folder before its session ID is read waits, and one that only resumes its session ID or only works in its folder gets its reading; the planted hub fails naming the folder hook`, { timeout: 900_000 }, async () => {
    const blocked = unbuilt(CHANGE, ['packages/cli/dist/main.js', 'packages/hub/dist/index.js', 'target/debug/deep-hook']);
    if (blocked) assert.fail(blocked);
    const seen = await scenario();
    const problems = judgeWhose(seen);
    console.log(`AC3 hooks: ${JSON.stringify(seen.hooks)}; ${problems.length ? problems.join('; ') : 'each as AC3 states'} (${machine()})`);
    assert.deepEqual(problems, [], problems.join('\n'));
    // The criterion's wrong program, in the same test: the judgment must fail on it, naming the folder hook.
    let planted;
    try {
      planted = await scenario({ DEEP_HUB_PLANT: PLANT });
    } catch (error) {
      assert.fail(`the planted hub ${PLANT} (DEEP_HUB_PLANT) could not be run, so the judgment is not shown to fail on it: ${String(error.message).slice(0, 600)}`);
    }
    const missed = judgeWhose(planted);
    console.log(`AC3 the planted hub ${PLANT}: ${missed.length ? missed.join('; ') : 'the judgment passed'}`);
    assert.ok(missed.some((p) => p.startsWith(planted.hooks.folder.what)), `the planted hub ${PLANT} passed the judgment of the folder hook (${planted.hooks.folder.what}): ${missed.join('; ') || 'no hook named'}`);
  });
});
