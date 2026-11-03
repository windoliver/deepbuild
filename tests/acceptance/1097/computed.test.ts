// #1097 AC1: a fail_closed push entry, shaped as the first-party entries are (block, fail_closed, `effect:push`), is
// installed through `deep guard add` beside the shipped defaults. Then, with the hub up and again with it stopped (its
// process ended), the two computed pushes are each denied by that entry, naming the program the line computes, and
// `"$CC" -o app main.c` is allowed. deep-hook built from the pinned merge base reads `$(printf git)` as no program,
// allows that push and fails this test, naming the call. The base reader already reads `G=git; "$G"` as git (it keeps
// the variables a line sets), so that push is held to a denial by the push entry and names no unreadable program
// (README, The calls). No call here is ever executed: each is a PreToolUse payload.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  AC1, bashCall, buildBase, buildDeepHook, cleanup, decision, failureOf, guardAdd, guardFile, hook, makeHome, must,
  newSession, preToolUse, seedDefaults, shown, startHub, stopHub, testEntry, told, type Ran,
} from './helpers.ts';

let BIN: string;
beforeAll(async () => { BIN = await buildDeepHook(); }, 900_000);
afterEach(cleanup, 60_000);

const NAME = 't-push';
/** Each computed push, with the program as the line writes it where the reader can't know it: what the denial must name. */
const PUSHES: { line: string; program?: string }[] = [
  { line: '"$(printf git)" push origin main', program: '$(printf git)' },
  // The base reader reads this program as git, since the line sets G: denied by the push entry, no unreadable program.
  { line: 'G=git; "$G" push origin main' },
];
const CC = '"$CC" -o app main.c';
const PHASES = ['up', 'stopped'] as const;
type Phase = (typeof PHASES)[number];

interface Seen { added: Ran; runs: Record<Phase, { pushes: Ran[]; cc: Ran }> }

async function observe(binary: string): Promise<Seen> {
  const home = makeHome();
  seedDefaults(home);
  const s = newSession(home);
  const guard = testEntry(NAME, { match: 'effect:push', mode: 'block', fail_closed: true });
  const hub = await startHub(home);
  const runs = {} as Seen['runs'];
  const pass = async () => {
    const pushes: Ran[] = [];
    for (const p of PUSHES) pushes.push(await hook(home, preToolUse(s, bashCall(p.line)), binary));
    return { pushes, cc: await hook(home, preToolUse(s, bashCall(CC)), binary) };
  };
  let added: Ran;
  try {
    added = await guardAdd(home, guardFile({ [NAME]: { guard, planted: bashCall('git push origin main'), twin: bashCall("echo 'git push origin main'") } }));
    must(added.code === 0, `BLOCKED: \`deep guard add\` must install ${NAME} (effect:push, block, fail_closed) before the calls: ${shown(added)}`);
    runs.up = await pass();
  } finally {
    await stopHub(hub);
  }
  runs.stopped = await pass();
  return { added, runs };
}

function judgeAC1(o: Seen): void {
  for (const phase of PHASES) {
    const r = o.runs[phase];
    PUSHES.forEach((p, i) => {
      const got = r.pushes[i]!;
      must(decision(got) === 'deny', `\`${p.line}\` must be denied with the hub ${phase}: ${shown(got)}`);
      must(told(got).includes(NAME), `\`${p.line}\`: the denial with the hub ${phase} must be the push entry ${NAME}'s: ${shown(got)}`);
      if (p.program) must(told(got).includes(p.program), `\`${p.line}\`: the denial with the hub ${phase} must name the unreadable program ${p.program}: ${shown(got)}`);
    });
    must(decision(r.cc) === 'allow', `\`${CC}\` meets no push entry and must run, allowed, with the hub ${phase}: ${shown(r.cc)}`);
  }
}

describe(`AC1 ${AC1} computed pushes are denied by the fail_closed push entry, naming the unreadable program; "$CC" runs`, () => {
  it(`AC1 with ${NAME} installed, ${PUSHES.map((p) => p.line).join(' and ')} are each denied by it, $(printf git) named, hub up and stopped, and ${CC} is allowed`, async () => {
    judgeAC1(await observe(BIN));
  }, 900_000);

  it('AC1 (wrong program) deep-hook on the merge base reads the program as empty, allows the push and fails this test, naming the call', async () => {
    const seen = await observe(await buildBase());
    const failure = await failureOf(() => judgeAC1(seen));
    expect(failure, 'deep-hook on the merge base must fail the criterion').not.toBeNull();
    expect(failure, 'the failure names the call').toContain(PUSHES[0]!.line);
    for (const phase of PHASES) {
      const r = seen.runs[phase].pushes[0]!;
      expect(decision(r), `the merge base allows \`${PUSHES[0]!.line}\` with the hub ${phase}: ${shown(r)}`).toBe('allow');
    }
  }, 900_000);
});
