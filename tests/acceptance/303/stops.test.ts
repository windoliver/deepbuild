// #303 AC10: on recorded turns, the stop rule reads a stop right after startup, one right after a resume, one right
// after `/clear`, and one whose turn began with your typed question that opened no task and only read two files, each
// as no claim, and the same question's turn with one edit in it as a claim; a planted rule that reads every stop with
// tool calls as a claim (DEEP_HUB_PLANT=claim-on-tool-calls) fails on the question, naming the stop.
//
// The turns, through deep-hook into `deep hub run`:
//   A  session 1 starts (startup); the agent reads a file, with no prompt since the start; Stop
//   B  session 1 resumes (resume); it reads a file; Stop
//   C  /clear: session 1 ends (reason clear) and session 2 starts (clear); it reads a file; Stop
//   D  in session 2 you type "explain how the auth middleware checks expiry"; it reads two files; Stop
//   E  session 3 starts; you type the same question; it reads two files and makes one Edit; Stop
// A, B and C each did work (a Read), so a rule that reads only "did work" can't pass them. The rule's reading is on each
// stop's agent.stop: `claim: false` for no claim, `claim: true` for a claim (README, The stop rule's reading).
import { afterEach, describe, it } from 'vitest';
import {
  AC10, QUESTION, cleanup, expectNoTask, failureOf, makeWorld, must, said, Session, settle, startHub, stopsOf, type Ev,
} from './helpers.ts';

afterEach(cleanup, 60_000);

interface Turns { events: Ev[]; s2: Session; s3: Session; stops: Record<'A' | 'B' | 'C' | 'D' | 'E', Ev | undefined> }

async function recordedTurns(plant?: string): Promise<Turns> {
  const w = makeWorld();
  const hub = await startHub(w, { plant });
  const s1 = new Session(w);
  await s1.start('startup');
  await s1.read('src/auth.ts');
  await s1.stop('I have read the auth middleware.');
  await s1.start('resume');
  await s1.read('src/users.ts');
  await s1.stop('Picked up where we left off.');
  await s1.end('clear');
  const s2 = new Session(w);
  await s2.start('clear');
  await s2.read('src/auth.ts');
  await s2.stop('Starting fresh.');
  await s2.typed(QUESTION);
  await s2.read('src/auth.ts');
  await s2.read('src/users.ts');
  await s2.stop('checkToken compares the token\'s exp with the clock.');
  const s3 = new Session(w);
  await s3.start();
  await s3.typed(QUESTION);
  await s3.read('src/auth.ts');
  await s3.read('src/users.ts');
  await s3.edit('src/auth.ts', 'token.exp > 0', 'token.exp > Date.now() / 1000');
  await s3.stop('checkToken compares exp with the clock; I tightened the comparison.');
  const all = (events: Ev[]) => [...stopsOf(events, s1), ...stopsOf(events, s2), ...stopsOf(events, s3)];
  const events = await settle(hub, (e) => all(e).length === 5 && all(e).every((stop) => typeof stop.data.claim === 'boolean'), 30_000);
  const [A, B] = stopsOf(events, s1);
  const [C, D] = stopsOf(events, s2);
  const [E] = stopsOf(events, s3);
  return { events, s2, s3, stops: { A, B, C, D, E } };
}

/** One stop's reading, its assertion naming the stop: its letter, what turn it ended, and its event. */
function reads(stop: Ev | undefined, label: string, claim: boolean): void {
  must(stop !== undefined, `${AC10} stop ${label} must be recorded as an agent.stop`);
  must(stop!.data.claim === claim, `${AC10} stop ${label} (agent.stop ${stop!.id}) must read as ${claim ? 'a claim (claim: true)' : 'no claim (claim: false)'}: ${said(stop)}`);
}
const ANSWER = `D, the answer to your typed question "${QUESTION}", which opened no task and only read two files`;
const answerIsNoClaim = (t: Turns) => reads(t.stops.D, ANSWER, false);

describe(`${AC10} the stop rule on recorded turns`, () => {
  it(`${AC10} stops right after startup, a resume and /clear, and the answer to a typed question that read two files, are no claim; the same question's turn with an edit is a claim`, async () => {
    const t = await recordedTurns();
    expectNoTask(t.events, t.s2, QUESTION, `${AC10} [turn D]`);
    expectNoTask(t.events, t.s3, QUESTION, `${AC10} [turn E]`);
    reads(t.stops.A, 'A, right after startup', false);
    reads(t.stops.B, 'B, right after a resume', false);
    reads(t.stops.C, 'C, right after /clear', false);
    answerIsNoClaim(t);
    reads(t.stops.E, `E, the same question's turn with one edit in it`, true);
  }, 240_000);

  it(`${AC10} (wrong program) a rule that reads every stop with tool calls as a claim (DEEP_HUB_PLANT=claim-on-tool-calls) fails on the question, naming the stop`, async () => {
    const t = await recordedTurns('claim-on-tool-calls');
    reads(t.stops.E, `E, the same question's turn with one edit in it`, true);
    const failure = await failureOf(() => answerIsNoClaim(t));
    must(failure !== null, `${AC10} the planted rule must fail this test on stop D, the answer to "${QUESTION}": it passed`);
    must(t.stops.D?.data.claim === true, `${AC10} the planted rule reads stop D, which had tool calls, as a claim: ${said(t.stops.D)}`);
    must(failure.includes(t.stops.D!.id), `${AC10} the failure must name the stop, agent.stop ${t.stops.D!.id}; it said: ${failure}`);
  }, 240_000);
});
