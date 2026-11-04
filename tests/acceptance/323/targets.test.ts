// #323 AC4, AC9: targets a definition names are resolved before each run, and a value checks depend on shows which
// verdicts it would make stale before it changes (design: Stable names for what checks target, "A target that can't
// be resolved makes the check INVALID with the reason, never a silent pass on the wrong thing. Before a value that
// checks depend on changes, such as a budget or a latency floor, DeepBuild shows which verdicts it would make stale";
// Protection, "A write the guard didn't recognize changes no check: the claim is judged on the approved bytes, and
// the difference becomes a proposal naming the files").
//
// One hub. AC4: two sessions, each in its own repo, handed the same definition, whose R1 names its target, the symbol
// `checkToken` in src/auth.js (`targets: ["src/auth.js#checkToken"]`); one session renames it to verifyToken, the
// other doesn't. AC9: three sessions in one repo, one after another: X's and Y's checks read the latency floor,
// `.deepbuild/checks/latency.floor` (300 ms), which their definitions reference; Z's check doesn't read it. X and Z
// pass. Then the floor on disk becomes 100 ms, a write no guard saw, and Y's stop finds it.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  AC4, AC9, FIX, FLAG, R1, begin, cleanup, draft, judgedAfter, lastPos, listed, makeWorld, must, req, settle, startHub, strings, taskVerdicts, testCheck,
  type Ev, type Hub, type World,
} from './helpers.ts';

const RENAMED = 'make the token check reject expired tokens';
const KEPT = 'make the token check refuse expired tokens';
const TARGET = 'src/auth.js#checkToken';

const X = 'make the login answer within the latency floor';
const Z = 'make the auth middleware flag expired tokens';
const Y = 'make the login log its latency';
const FLOOR = '.deepbuild/checks/latency.floor';
const LATENCY = testCheck('latency', 'the login answers within the latency floor', `assert.ok(require('../../src/latency.js').ms <= parseInt(require('node:fs').readFileSync('${FLOOR}', 'utf8'), 10), 'the login is slower than the floor');`);
const latencyReq = () => req('R1', 'The login answers within the latency floor', { check: LATENCY.check, on_base: 'passes', asserts: LATENCY.asserts, references: [FLOOR] });

let w: World;
let hub: Hub;
beforeAll(async () => {
  w = await makeWorld({
    repos: ['renamed', 'kept', 'floor'],
    files: {
      'src/latency.js': 'module.exports = { ms: 120 };\n',
      [FLOOR]: '300 ms\n',
      ...LATENCY.files,
    },
    drafts: [
      draft(RENAMED, [R1({ targets: [TARGET] })]),
      draft(KEPT, [R1({ targets: [TARGET] })]),
      draft(X, [latencyReq()]),
      draft(Z, [R1()]),
      draft(Y, [latencyReq()]),
    ],
  });
  hub = await startHub(w);
}, 180_000);
afterAll(cleanup, 60_000);

/** A session that makes the spec and R1 pass, optionally renaming checkToken first; the task's newest verdict. */
async function tokenSession(prompt: string, cwd: string, rename: boolean): Promise<Ev | undefined> {
  const { s, ref } = await begin(w, hub, cwd, prompt, AC4);
  if (rename) {
    await s.edit('src/auth.js', 'checkToken:', 'verifyToken:');
    await s.edit('tests/unit.test.js', 'auth.checkToken(', 'auth.verifyToken(');
  }
  await s.edit(FIX.file, FIX.from, FIX.to);
  await s.edit(FLAG.file, FLAG.from, FLAG.to);
  const since = await lastPos(hub);
  await s.stop('Expired tokens are rejected now; the unit test and the drafted check pass.');
  return taskVerdicts(await judgedAfter(hub, ref, since), ref, since).at(-1);
}

describe(`${AC4} a check whose target no longer resolves is INVALID with the reason, never a pass`, () => {
  it(`${AC4} R1 targets ${TARGET}; once the session renames checkToken to verifyToken, the claim is INVALID naming checkToken, though every check passes; with the target in place the same claim is not INVALID`, async () => {
    const renamed = await tokenSession(RENAMED, w.repos.renamed!, true);
    must(renamed !== undefined, `${AC4} the renaming session's claim gets a verdict: none`);
    must(renamed!.data.outcome !== 'PASS', `${AC4} R1's target ${TARGET} no longer resolves after the rename, so the claim never passes, whatever its checks show: ${JSON.stringify(renamed!.data).slice(0, 900)}`);
    must(renamed!.data.outcome === 'INVALID', `${AC4} a target that can't be resolved makes the check INVALID: the verdict is ${String(renamed!.data.outcome)}: ${JSON.stringify(renamed!.data).slice(0, 900)}`);
    const why = strings(renamed!.data.reasons ?? []).concat(strings(renamed!.data.requirements ?? [])).join('\n');
    must(why.includes('checkToken'), `${AC4} the INVALID names the target that no longer resolves, checkToken (${TARGET}): ${why.slice(0, 900)}`);
    const kept = await tokenSession(KEPT, w.repos.kept!, false);
    must(kept !== undefined && kept.data.outcome !== 'INVALID', `${AC4} with checkToken still in src/auth.js the target resolves, so the same definition's claim is not INVALID: ${JSON.stringify(kept?.data ?? 'no verdict').slice(0, 900)}`);
  }, 600_000);
});

/** What a verdict is named by: its verdict handle, its event, and its claim. */
const namesOf = (v: Ev): string[] => [String(v.data.verdict), `verdict:${v.id}`, String(v.data.claim)].filter((n) => n !== 'undefined');

describe(`${AC9} changing a value checks depend on first lists the verdicts it would make stale`, () => {
  it(`${AC9} the latency floor changes on disk from 300 ms to 100 ms: the change to ${FLOOR} that Y's stop finds is proposed listing X's verdict, whose check reads the floor, and not Z's, whose check doesn't`, async () => {
    const cwd = w.repos.floor!;
    const passed = async (prompt: string, work: () => Promise<void>, s: Awaited<ReturnType<typeof begin>>): Promise<Ev> => {
      await work();
      const since = await lastPos(hub);
      await s.s.stop('Done; the checks pass.');
      const v = taskVerdicts(await judgedAfter(hub, s.ref, since), s.ref, since).at(-1);
      must(v?.data.outcome === 'PASS', `BLOCKED: ${AC9} "${prompt}" must pass first, so it has a verdict a floor change could make stale: ${JSON.stringify(v?.data ?? 'no verdict').slice(0, 600)}`);
      return v!;
    };
    const x = await begin(w, hub, cwd, X, AC9);
    const vx = await passed(X, () => x.s.edit(FIX.file, FIX.from, FIX.to), x);
    const z = await begin(w, hub, cwd, Z, AC9);
    const vz = await passed(Z, () => z.s.edit(FLAG.file, FLAG.from, FLAG.to), z);

    const y = await begin(w, hub, cwd, Y, AC9);
    writeFileSync(join(cwd, FLOOR), '100 ms\n');
    await y.s.edit('src/latency.js', 'ms: 120', 'ms: 120, logs: true');
    const since = await lastPos(hub);
    await y.s.stop('The login logs its latency now.');
    await judgedAfter(hub, y.ref, since);
    const events = await settle(hub, () => false, 3000);
    const change = events.filter((e) => e.log_pos > since && (/\.proposed$/.test(e.kind) || e.kind === 'ask.created') && strings(e.data).some((t) => t.includes('latency.floor')));
    must(change.length > 0, `${AC9} the floor's new bytes change no check until approved: the difference is proposed, naming ${FLOOR}; nothing after Y's stop does: ${listed(events.filter((e) => e.log_pos > since && /proposed|ask\./.test(e.kind)))}`);
    const said = change.flatMap((e) => strings(e.data));
    must(namesOf(vx).some((n) => said.some((t) => t.includes(n))), `${AC9} before the floor changes, its proposal (or the ask for it) lists the verdicts it would make stale: X's PASS (${namesOf(vx).join(' or ')}), whose check reads ${FLOOR}; it says ${listed(change)}`);
    must(!namesOf(vz).some((n) => said.some((t) => t.includes(n))), `${AC9} Z's verdict (${namesOf(vz).join(' or ')}) doesn't depend on the floor, so the floor's proposal doesn't list it: ${listed(change)}`);
  }, 600_000);
});
