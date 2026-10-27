// AC17: through the conformance runner, the adapter answers a recorded PermissionRequest for `git push origin main`
// with `behavior: deny` and the message "yes but not on main" when the answer is those words with `decision: none`,
// with `behavior: deny` when the chosen option's label reads "Allow" but it declares `deny`, and with
// `behavior: allow` only when `decision` is `allow`; an adapter that reads allow from a label or from "yes" in the
// words fails the run, naming the case.
//
// Two surfaces, both #18's (README, The surface under test): the Claude Code adapter's `permissionReply(answer,
// request)`, which gives the hook output Claude Code reads (`hookSpecificOutput.decision.behavior` and `.message`),
// and the conformance runner, `deep-conformance run --fill <module>`, on a module exporting `shippedFill(...)`.
// The recorded request is fixtures/permission-request.json: Claude Code 2.1.304's recorded Bash PermissionRequest
// from adapters/corpus (tools session), its command `git push origin main` (README, Fixtures).
import { afterAll, describe, expect, it } from 'vitest';
import type { Fill } from '../../../../packages/conformance/src/index.ts';
import {
  AC17, cleanup, permissionReply, REQUEST_LINE, runner, SESSION, shippedFill, shown, type CaseLine, type PermissionAnswer, type Plant,
} from './helpers.ts';

afterAll(cleanup);

const WORDS = 'yes but not on main';
const COMMAND = 'git push origin main';
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const answer = (fields: Partial<PermissionAnswer>): PermissionAnswer => ({
  ask: 'ask:01K74G3A5C7E9G1J3M5P7R9T1V', session: SESSION, option: null, label: null, decision: 'none', words: null, provisional: false, undoes: null, ...fields,
});

/** The criterion's three cases, by the name a failure gives. */
const CASES: { name: string; answer: PermissionAnswer; behavior: 'allow' | 'deny'; message?: string }[] = [
  { name: `words "${WORDS}" with decision none`, answer: answer({ decision: 'none', words: WORDS }), behavior: 'deny', message: WORDS },
  { name: 'option labelled "Allow" that declares deny', answer: answer({ option: 'allow', label: 'Allow', decision: 'deny' }), behavior: 'deny' },
  { name: 'decision allow', answer: answer({ option: 'push', label: 'Push it', decision: 'allow' }), behavior: 'allow' },
];

/** The adapter's reply to the recorded request for each case: deny with the words as message, deny, allow. */
function expectReplies(fill: Fill): void {
  const reply = permissionReply(fill);
  for (const c of CASES) {
    const out = reply(c.answer, REQUEST_LINE);
    const hook = isObj(out) && isObj(out.hookSpecificOutput) ? out.hookSpecificOutput : undefined;
    expect(hook?.hookEventName, `case ${c.name}: the reply is Claude Code's PermissionRequest hook output; it read ${JSON.stringify(out)}`).toBe('PermissionRequest');
    const decision = isObj(hook?.decision) ? hook.decision : undefined;
    expect(decision?.behavior, `case ${c.name}: \`${COMMAND}\` is answered behavior ${c.behavior}; it read ${JSON.stringify(out)}`).toBe(c.behavior);
    if (c.message !== undefined) expect(decision?.message, `case ${c.name}: your words are the deny's message; it read ${JSON.stringify(out)}`).toBe(c.message);
  }
}

describe(`${AC17} the permission reply takes allow or deny only from the answer's decision; through the runner, an adapter that reads allow from a label or "yes" fails, naming the case`, () => {
  it(`${AC17} the Claude Code adapter answers the recorded PermissionRequest for \`${COMMAND}\`: deny with "${WORDS}" for those words with decision none, deny for an "Allow" label declaring deny, allow only for decision allow`, () => {
    expectReplies(shippedFill());
  });

  it(`${AC17} (wrong program) an adapter that reads allow from the label, or from "yes" in the words, fails the reply assertion, naming its case`, () => {
    const label = shippedFill('allow-from-label');
    const yes = shippedFill('allow-from-yes');
    expect(() => expectReplies(label), 'the label twin fails the "Allow" case').toThrow(/case option labelled "Allow" that declares deny/);
    expect(() => expectReplies(yes), 'the yes twin fails the words case').toThrow(new RegExp(`case words "${WORDS}" with decision none`));
  });

  /** The FAIL line of the twin's run that names the case: the recorded request's command and the case's own value. */
  const failingCase = (plant: Plant, names: (c: CaseLine) => boolean, what: string): CaseLine => {
    const run = runner(plant);
    expect(run.status, `deep-conformance run on the twin ${plant} exits 1 (FAIL):\n${shown(run)}`).toBe(1);
    expect(run.verdict, `the run's verdict line reads FAIL:\n${shown(run)}`).toBe('FAIL');
    const line = run.cases.find((c) => c.outcome === 'FAIL' && c.message.includes(COMMAND) && names(c));
    expect(line, `the twin ${plant}'s run fails a case on the recorded PermissionRequest for \`${COMMAND}\`, naming ${what}:\n${shown(run)}`).toBeDefined();
    return line!;
  };
  const passedByAdapter = (id: string): void => {
    const run = runner();
    const own = run.cases.find((c) => c.id === id);
    expect(own?.outcome, `deep-conformance run on the Claude Code adapter passes ${id}:\n${shown(run)}`).toBe('PASS');
    expect(run.cases.filter((c) => c.outcome === 'FAIL' && c.message.includes(COMMAND)).map((c) => c.line), 'no case on the recorded request fails for the adapter').toEqual([]);
  };

  it(`${AC17} through the conformance runner, an adapter that reads allow from an option labelled "Allow" fails the run, naming the case; the Claude Code adapter passes it`, () => {
    const line = failingCase('allow-from-label', (c) => /\bAllow\b/.test(c.message) && !c.message.includes(WORDS), 'the "Allow" label that declares deny');
    passedByAdapter(line.id);
  }, 600_000);

  it(`${AC17} through the conformance runner, an adapter that reads allow from "yes" in the words fails the run, naming the case; the Claude Code adapter passes it`, () => {
    const line = failingCase('allow-from-yes', (c) => c.message.includes(WORDS), `the words "${WORDS}" with decision none`);
    passedByAdapter(line.id);
    const label = failingCase('allow-from-label', (c) => /\bAllow\b/.test(c.message) && !c.message.includes(WORDS), 'the "Allow" label');
    expect(line.id, 'the words case and the label case are two cases, each named by its own failure').not.toBe(label.id);
  }, 600_000);
});
