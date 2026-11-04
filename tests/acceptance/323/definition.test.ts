// #323 AC5, AC6, AC8: what each definition shows of itself (design: What done means, fixed at the start: Solved or
// not, "Each definition shows one solve line: fully covered, a requirement with no check, two checks covering the
// same thing, or two that can't both pass. A threshold without a unit makes its check BLOCKED"; How runs become one of
// five verdicts: Coverage, claim by claim, "each journey includes at least one negative case, so a check that can't
// fail shows up"; Evidence states, "Each line of a receipt also names its proof (the agent's statement, a static
// check, a test run, a real journey or your decision), and a lower proof is never shown as a higher one").
//
// One hub, four recorded Claude Code sessions, each in its own repo, each handed a definition for its prompt.
import { afterAll, beforeAll, describe, it } from 'vitest';
import {
  AC5, AC6, AC8, CHECK_FILE, FIX, FLAG, R1, begin, claimsOf, cleanup, draft, judgedAfter, lastPos, listed, lockedFor, makeWorld, must, req, reqRow,
  settle, startHub, strings, taskVerdicts, testCheck, type Ev, type Hub, type World,
} from './helpers.ts';

const UNCOVERED = 'add an expiry check to the auth middleware';
const COVERED_ASK = 'add an expiry flag to the auth middleware';
const SPEED = 'make the login answer faster';
const JOURNEYS = 'make the login page reject expired tokens';

/** Two drafted checks that time the login, which answers in 120 ms; one says the unit of its threshold, one doesn't. */
const SPEED_T = testCheck('login-speed', 'a login answers in under 300', "assert.ok(require('../../src/login.js').ms < 300, 'the login is too slow');");
const SPEED_MS_T = testCheck('login-speed-ms', 'a login answers in under 300 ms', "assert.ok(require('../../src/login.js').ms < 300, 'the login is too slow');");
const SPEED_CHECK = SPEED_T.check;
const SPEED_MS_CHECK = SPEED_MS_T.check;
/** A second drafted check for the login page's journey requirement. */
const REDIRECT = testCheck('expired-redirect', 'an expired token is sent back to the login page', "assert.ok(require('../../src/auth.js').rejectsExpired, 'an expired token reaches the page');");
const REDIRECT_CHECK = REDIRECT.check;

const R2_TEXT = 'The e2e test for expired tokens passes';
let w: World;
let hub: Hub;
beforeAll(async () => {
  w = await makeWorld({
    repos: ['uncovered', 'covered', 'speed', 'journeys'],
    files: {
      'src/login.js': 'module.exports = { ms: 120 };\n',
      ...SPEED_T.files, ...SPEED_MS_T.files, ...REDIRECT.files,
    },
    drafts: [
      draft(UNCOVERED, [R1(), req('R2', R2_TEXT, { depth: 'e2e' })]),
      draft(COVERED_ASK, [R1()]),
      draft(SPEED, [
        req('R1', 'A login answers in under 300', { check: SPEED_CHECK, on_base: 'passes', asserts: SPEED_T.asserts }),
        req('R2', 'A login answers in under 300 ms', { check: SPEED_MS_CHECK, on_base: 'passes', asserts: SPEED_MS_T.asserts }),
      ]),
      draft(JOURNEYS, [
        R1({ depth: 'journey', near_misses: ['an expired token reaches the dashboard'] }),
        req('R2', 'An expired token on the login page is sent back to sign in', { check: REDIRECT_CHECK, asserts: REDIRECT.asserts, depth: 'journey', near_misses: [] }),
        req('R3', 'The login page says why the token was refused', { depth: 'unit' }),
      ]),
    ],
  });
  hub = await startHub(w);
}, 180_000);
afterAll(cleanup, 60_000);

/** The solve lines the record holds for a task: each `solve` string of an event naming the task. */
const solveLines = (events: readonly Ev[], ref: string): string[] => events.filter((e) => e.data?.task_ref === ref && typeof e.data.solve === 'string').map((e) => String(e.data.solve));

describe(`${AC5} a definition with an uncovered requirement shows it in its solve line before any claim`, () => {
  it(`${AC5} R2 ("${R2_TEXT}") has no check: the definition's solve line names R2 with no check before the session stops; a definition whose every requirement has a check reads fully covered`, async () => {
    const uncovered = await begin(w, hub, w.repos.uncovered!, UNCOVERED, AC5);
    const covered = await begin(w, hub, w.repos.covered!, COVERED_ASK, AC5);
    const events = await settle(hub, (all) => solveLines(all, uncovered.ref).length > 0 && solveLines(all, covered.ref).length > 0, 15_000);
    must(!claimsOf(events, uncovered.ref).length, `${AC5} no stop was made, so no claim exists yet: ${listed(claimsOf(events, uncovered.ref))}`);
    const lines = solveLines(events, uncovered.ref);
    must(lines.length > 0, `${AC5} the locked definition of ${uncovered.ref} shows its solve line (a \`solve\` string in the record naming the task) before any claim: none; its lock is ${listed(lockedFor(events, uncovered.ref))}`);
    must(lines.length === 1 || new Set(lines).size === 1, `${AC5} the definition shows one solve line: ${JSON.stringify(lines)}`);
    must(/no check/i.test(lines[0]!) && (/\bR2\b/.test(lines[0]!) || lines[0]!.includes(R2_TEXT)), `${AC5} the solve line names the uncovered requirement, R2 or "${R2_TEXT}", as a requirement with no check: ${JSON.stringify(lines[0])}`);
    const control = solveLines(events, covered.ref);
    must(control.length > 0 && /fully covered/i.test(control[0]!) && !/no check/i.test(control[0]!), `${AC5} a definition whose one requirement has its check reads "fully covered", so the solve line reads the definition: ${JSON.stringify(control)}`);
  }, 600_000);
});

describe(`${AC6} a threshold without a unit makes its check BLOCKED`, () => {
  it(`${AC6} R1 "A login answers in under 300" is BLOCKED naming the threshold and its missing unit, while R2 "… under 300 ms", with the same check passing, is not`, async () => {
    const { s, ref } = await begin(w, hub, w.repos.speed!, SPEED, AC6);
    await s.edit(FIX.file, FIX.from, FIX.to);
    const since = await lastPos(hub);
    await s.stop('The login answers in 120 ms now.');
    const events = await judgedAfter(hub, ref, since);
    const v = taskVerdicts(events, ref, since).at(-1);
    must(v !== undefined, `${AC6} the stop's claim gets a verdict: none for ${ref}`);
    must(v!.data.outcome !== 'PASS', `${AC6} R1's threshold, "under 300", carries no unit, so the claim can't pass: ${JSON.stringify(v!.data).slice(0, 900)}`);
    const r1 = reqRow(v, 'R1');
    must(r1?.outcome === 'BLOCKED', `${AC6} R1's check is BLOCKED by its threshold without a unit (${SPEED_CHECK} itself passes): R1's row is ${JSON.stringify(r1)}; the verdict ${JSON.stringify(v!.data).slice(0, 700)}`);
    const why = strings(v!.data).join('\n');
    must(/\b300\b/.test(why) && /\bunit\b/i.test(why), `${AC6} the verdict names the threshold, 300, and its missing unit: ${why.slice(0, 900)}`);
    must(reqRow(v, 'R2')?.outcome !== 'BLOCKED', `${AC6} R2's threshold, "under 300 ms", carries its unit, so its passing check isn't BLOCKED: ${JSON.stringify(reqRow(v, 'R2'))}`);
  }, 600_000);
});

/** Requirement records' own fields, which are the definition's words, never a flag. */
const OWN = new Set(['id', 'text', 'source_line', 'refuted_by', 'check', 'on_base', 'asserts', 'depth', 'oracle', 'near_misses', 'references', 'targets', 'criterion', 'author']);
/** The events after the task's creation that flag a requirement as a journey with no negative case. */
function flags(events: readonly Ev[], ref: string, id: string, text: string): Ev[] {
  const created = events.find((e) => e.kind === 'task.created' && e.data.task_ref === ref)?.log_pos ?? Infinity;
  return events.filter((e) => e.log_pos > created && e.kind !== 'user.ask' && e.kind !== 'task.created').filter((e) => {
    const said = strings(e.data, OWN);
    return said.some((t) => /negative case/i.test(t)) && said.some((t) => new RegExp(`\\b${id}\\b`).test(t) || t.includes(text));
  });
}

describe(`${AC8} a journey with no negative case is flagged, and no receipt line shows a weaker proof as a stronger one`, () => {
  it(`${AC8} R2, a journey with no near miss, is flagged as having no negative case (R1, which has one, isn't); the verdict's receipt labels the two shell checks no higher than a test run and R3, with no check, as the agent's statement`, async () => {
    const { s, ref } = await begin(w, hub, w.repos.journeys!, JOURNEYS, AC8);
    await s.edit(FIX.file, FIX.from, FIX.to);
    await s.edit(FLAG.file, FLAG.from, FLAG.to);
    const since = await lastPos(hub);
    await s.stop('Expired tokens are sent back to the login page. I checked the refusal message by hand.');
    const events = await judgedAfter(hub, ref, since);
    const r2 = 'An expired token on the login page is sent back to sign in';
    must(flags(events, ref, 'R2', r2).length > 0, `${AC8} R2 is a journey with no negative case (no near miss), so the record flags it, naming R2 and "negative case": nothing does`);
    must(flags(events, ref, 'R1', 'An expired token is rejected with 401').length === 0, `${AC8} R1's journey has a negative case ("an expired token reaches the dashboard"), so it isn't flagged: ${listed(flags(events, ref, 'R1', 'An expired token is rejected with 401'))}`);
    const v = taskVerdicts(events, ref, since).at(-1);
    must(v !== undefined, `${AC8} the stop's claim gets a verdict: none for ${ref}`);
    for (const [id, check] of [['R1', CHECK_FILE], ['R2', REDIRECT_CHECK]] as const) {
      const row = reqRow(v, id);
      must(row !== undefined && typeof row.proof === 'string', `${AC8} the receipt line for ${id} names its proof: ${JSON.stringify(row)}`);
      must(['statement', 'static_check', 'test_run'].includes(row!.proof), `${AC8} ${id} is covered by ${check}, a shell command run, not a real journey or your decision, so its receipt line never shows ${row!.proof}: ${JSON.stringify(row)}`);
    }
    const r3 = reqRow(v, 'R3');
    must(r3?.proof === 'statement', `${AC8} R3 has no check; all that stands for it is the agent's "I checked the refusal message by hand", so its receipt line shows the agent's statement: ${JSON.stringify(r3)}`);
  }, 600_000);
});
