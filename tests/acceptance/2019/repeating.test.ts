// AC6 #2019.ea7b05b6: a fixture Claude Code turn runs `pnpm test --filter api` three times, each failing with the same
// exit code and error signature: the row reads repeating with the command and 3, the agent gets one notice at the
// third failure, and a fourth identical failure brings none; the same command failing with two different signatures,
// or passing on its second run, never reads repeating. A detector keyed on the command alone, or one that notifies at
// every repeat or raises an ask, fails, naming the call.
//
// Claude Code sessions played on the Proof's fixture's hub, each call through the hub's hook route as Claude Code fires
// it (PreToolUse, then PostToolUse or PostToolUseFailure with its error), the row read in `deep status --json` after
// each call, the notices read from the record (`notice.delivered`) and from the replies the agent got, and the asks
// from the record (helpers.ts, `repeatFailures`). Each failure names its call.
import { afterAll, describe, expect, test } from 'vitest';
import {
  allEvents, cleanup, COMMAND, control, drawn, drawnFlagFailures, ERROR_A, ERROR_B, FIXTURE_REPO, flagOf, ID, Live, mainWorld, MIN, none, PLANT, playCalls, prompted, repeatFailures,
  restartWith, type Call, type Ev, type Main,
} from './helpers.ts';

afterAll(cleanup, 120_000);
let made: Promise<Main> | undefined;
const world = (): Promise<Main> => (made ??= mainWorld());
const A = { command: COMMAND, error: ERROR_A };
const B = { command: COMMAND, error: ERROR_B };
const PASS = { command: COMMAND };
/** Three identical failures, a fourth, then a call that differs and succeeds. */
const REPEATS = [A, A, A, A, { command: 'git status' }];
const records = async (w: Main): Promise<Ev[]> => { const conn = await control(w.hub); return allEvents(conn).finally(() => conn.close()); };
const signatures = (calls: readonly Call[], events: readonly Ev[]): unknown[] => calls.map((c) => events.find((e) => e.kind === 'tool.after' && e.data.call === c.id)?.data.signature);

/** A planted hub, a fresh turn on it, and what the judge says of it. */
async function planted(w: Main, plant: string, key: string, steps: readonly { command: string; error?: string }[]): Promise<{ calls: Call[]; failures: string[] }> {
  await restartWith(w, plant);
  const p = new Live(w.hub, w);
  const s = await prompted(p, key, 'search', 'make the api tests pass');
  const calls = await playCalls(w, p, key, steps, { plant });
  return { calls, failures: repeatFailures(s.id, calls, await records(w)) };
}

describe(ID.repeating, () => {
  test(`${ID.repeating}: three identical failures of \`${COMMAND}\` read repeating with the command and 3, with one notice at the third and none at a fourth; two signatures, or a pass on the second run, never read repeating`, async () => {
    const w = await world();
    const p = new Live(w.hub, w);
    const rep = await prompted(p, 'repeats', FIXTURE_REPO, 'make the api tests pass');
    const out: string[] = [];
    // The app's row at the third failure, when the record already reads it repeating.
    const calls = await playCalls(w, p, 'repeats', REPEATS, { after: async (c) => { if (c.n === 3 && flagOf(c.row)?.code === 'repeating') out.push(...drawnFlagFailures((await drawn(w)).snapshot, rep.id, /repeating/)); } });
    const sigs = await prompted(p, 'two-signatures', 'docs', 'make the api tests pass again');
    const twoSigs = await playCalls(w, p, 'two-signatures', [A, B, A]);
    const passes = await prompted(p, 'passes-second', 'search', 'make the api tests pass once more');
    const passing = await playCalls(w, p, 'passes-second', [A, PASS, A]);
    const events = await records(w);
    expect(new Set(signatures(calls.slice(0, 4), events)).size, 'the fixture\'s four failures share one error signature in the record').toBe(1);
    expect(new Set(signatures(twoSigs, events)).size, 'the twin\'s three failures carry two error signatures in the record').toBe(2);
    out.push(...repeatFailures(rep.id, calls, events), ...repeatFailures(sigs.id, twoSigs, events), ...repeatFailures(passes.id, passing, events));
    none(out, `the turns that run ${COMMAND}`);
  }, 30 * MIN);

  test(`${ID.repeating}: a planted detector keyed on the command alone fails, naming the call`, async () => {
    const w = await world();
    const { calls, failures } = await planted(w, PLANT.repeatByCommand, 'by-command', [A, B, A]);
    expect(failures.some((f) => f.startsWith(`call 3 (${calls[2]!.id},`) && /reads repeating/.test(f)), `DEEP_HUB_PLANT=${PLANT.repeatByCommand} must fail naming the third call: ${JSON.stringify(failures)}`).toBe(true);
  }, 30 * MIN);

  test(`${ID.repeating}: a planted detector that notifies at every repeat fails, naming the call`, async () => {
    const w = await world();
    const { calls, failures } = await planted(w, PLANT.repeatNotifiesEach, 'notifies-each', REPEATS);
    expect(failures.some((f) => f.startsWith(`call 4 (${calls[3]!.id},`) && /notice/.test(f)), `DEEP_HUB_PLANT=${PLANT.repeatNotifiesEach} must fail naming the fourth call: ${JSON.stringify(failures)}`).toBe(true);
  }, 30 * MIN);

  test(`${ID.repeating}: a planted detector that raises an ask fails, naming the call`, async () => {
    const w = await world();
    const { calls, failures } = await planted(w, PLANT.repeatRaisesAsk, 'raises-ask', REPEATS);
    expect(failures.some((f) => calls.slice(2).some((c) => f.startsWith(`call ${c.n} (${c.id},`)) && /raised an ask/.test(f)), `DEEP_HUB_PLANT=${PLANT.repeatRaisesAsk} must fail naming the call that raised it: ${JSON.stringify(failures)}`).toBe(true);
  }, 30 * MIN);
});
