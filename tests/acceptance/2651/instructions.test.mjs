// #2651 AC2 (#2651.306dda20): "With 10,000 ended jobs in the record and none running, the hub's own instructions
// retired for a PreToolUse are within 2% of the same hook with no job in the record, over 15 alternated rounds. On the
// merge base the count rises with the jobs, and the test fails, naming both counts"
//   node --test tests/acceptance/2651/instructions.test.mjs     # about 5 minutes; macOS (cc), the checkout built
// Two hubs of this checkout, each `deep hub run` on a home of its own: one whose record holds 10,000 ended jobs, written
// before its start as the runner writes them (job.recorded@1 and job.ended@2, finished, each with a session ID, a
// process and a run; probe.mjs seed-jobs), none running, and one whose record holds no job. The test reads each job back
// through job.list first. Each hub gets the same session's SessionStart and five PreToolUses to warm up. Then 15 rounds,
// alternating which hub goes first: in a round each hub gets 10 PreToolUses of the same Bash call, each carried to its
// socket as deep-hook sends it, and the hub's own instructions retired (proc_pid_rusage of the hub's process, rusage.c)
// are read just before the request is written and again as its reply arrives; the round's count for a hub is the
// median of its 10 hooks, so one hook that met the hub's own timers or a collection doesn't move the round.
// Judged as the perf lane judges a count (scripts/benchmark.mjs judgeInstructions: the pairs' log ratios less 2%, two
// seeded sign-flip tests at p under 0.01): only PASS passes. The failure names both counts, per PreToolUse.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { AC, CHANGE, HERE, cBuild, client, instructionsOf, machine, median, payloadOf, perfJudge, removeDir, sendHook, startHub, stopHub, tempDir, unbuilt, uuid } from './lib.mjs';

const JOBS = 10_000;
const ROUNDS = 15;
const PER_ROUND = 10;
const ENDED = ['finished', 'stopped', 'refused', 'lost'];

function seed(ledger, folders) {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [join(HERE, 'probe.mjs'), 'seed-jobs', CHANGE, JSON.stringify({ ledger, count: JOBS, folders })], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.setEncoding('utf8').on('data', (t) => (out += t));
    child.stderr.setEncoding('utf8').on('data', (t) => (err = (err + t).slice(-3000)));
    child.on('close', (code) => (code === 0 ? done(JSON.parse(out.trim().split('\n').at(-1))) : fail(Error(`BLOCKED: seeding ${JOBS} ended jobs failed (exit ${code}): ${err}`))));
  });
}

describe(`${AC[2]} the hub's instructions for a PreToolUse don't grow with the jobs the record holds`, () => {
  it(`${AC[2]} with 10,000 ended jobs and none running, a PreToolUse retires within 2% of the hub's instructions with no job, over 15 alternated rounds`, { timeout: 1_800_000 }, async () => {
    const blocked = unbuilt(CHANGE, ['packages/cli/dist/main.js', 'packages/hub/dist/index.js', 'packages/record/dist/index.js', 'target/debug/deep-hook']);
    if (blocked) assert.fail(blocked);
    const counter = cBuild('rusage');
    if (counter.blocked) assert.fail(counter.blocked);
    const sides = { jobs: { home: tempDir('ac2-jobs') }, none: { home: tempDir('ac2-none') } };
    try {
      // A first start makes each home's root and record; the jobs go into one record while its hub is down.
      for (const side of Object.values(sides)) await stopHub(await startHub(CHANGE, side.home));
      const ledger = join(sides.jobs.home, '.deepbuild', 'ledger.db');
      if (!existsSync(ledger)) assert.fail(`BLOCKED: the hub keeps no record at ${ledger}`);
      await seed(ledger, join(sides.jobs.home, '.deepbuild', 'jobs'));
      for (const side of Object.values(sides)) {
        side.hub = await startHub(CHANGE, side.home);
        side.client = await client(side.hub);
      }
      const listed = (await sides.jobs.client.call('job.list')).jobs;
      const ended = listed.filter((j) => ENDED.includes(j.state)).length;
      if (listed.length !== JOBS || ended !== JOBS) assert.fail(`BLOCKED: the hub with jobs lists ${listed.length} jobs, ${ended} of them ended; ${JOBS} ended and none running are required`);
      const none = (await sides.none.client.call('job.list')).jobs;
      if (none.length) assert.fail(`BLOCKED: the hub with no job lists ${none.length}`);

      const session = uuid();
      let n = 0;
      const pre = (side) => {
        const cwd = join(side.home, 'work');
        return { cwd, payload: (call) => payloadOf(side.home, session, cwd, { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: call }) };
      };
      for (const side of Object.values(sides)) {
        const { cwd, payload } = pre(side);
        await sendHook(side.hub.socket, 'SessionStart', payloadOf(side.home, session, cwd, { source: 'startup', model: 'claude-haiku-4-5' }));
        for (let i = 0; i < 5; i++) await sendHook(side.hub.socket, 'PreToolUse', payload(`toolu_dh2651w${++n}`));
      }
      /** One PreToolUse to `side`'s hub: the instructions its process retired from just before the request to its reply. */
      const one = async (side) => {
        const { payload } = pre(side);
        let before = 0;
        const { reply } = await sendHook(side.hub.socket, 'PreToolUse', payload(`toolu_dh2651m${++n}`), { onSend: () => { before = instructionsOf(side.hub.pid); } });
        const after = instructionsOf(side.hub.pid);
        if (reply.exit !== 0) assert.fail(`BLOCKED: the hub answered a PreToolUse of ls with exit ${reply.exit}: ${JSON.stringify(reply).slice(0, 300)}`);
        return after - before;
      };
      const rounds = [];
      for (let round = 0; round < ROUNDS; round++) {
        const order = round % 2 ? ['none', 'jobs'] : ['jobs', 'none'];
        const counts = {};
        for (const name of order) {
          const each = [];
          for (let i = 0; i < PER_ROUND; i++) each.push(await one(sides[name]));
          counts[name] = Math.round(median(each));
        }
        rounds.push(counts);
      }
      const { judgeInstructions } = await perfJudge();
      const judged = judgeInstructions(rounds.map((r) => ({ current: r.jobs, base: r.none })));
      // The perf lane's words compare a change with its merge base; here the pairs are the hub with jobs and the one with none.
      const verdict = { ...judged, reason: judged.reason?.replace('over the merge base', 'with the jobs over the hub with none') };
      const per = (name) => Math.round(median(rounds.map((r) => r[name])));
      const counts = `${per('jobs').toLocaleString('en-US')} instructions per PreToolUse with ${JOBS.toLocaleString('en-US')} ended jobs in the record and ${per('none').toLocaleString('en-US')} with none (the median over ${ROUNDS} alternated rounds of each round's median of ${PER_ROUND} hooks)`;
      console.log(`AC2 ${counts}; ${verdict.status}${verdict.reason ? `: ${verdict.reason}` : ''}; rounds ${JSON.stringify(rounds)} (${machine()})`);
      assert.equal(verdict.status, 'PASS', `${verdict.status}: the hub retired ${counts}; within 2% is required. ${verdict.reason ?? ''}`);
    } finally {
      for (const side of Object.values(sides)) {
        side.client?.close();
        if (side.hub) await stopHub(side.hub);
        removeDir(side.home);
      }
    }
  });
});
