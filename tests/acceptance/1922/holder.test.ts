// AC4: "A second registration of the kind test.upper by another plug-in is refused at install, naming the kind and the
// plug-in that holds it, unless its manifest says it replaces the first; and a job whose output fails test.upper_only
// returns that failure, naming the check, and leaves no output an item can name"
//
// asserts: with test/upper-kind installed, `deep install` of test/upper-rival (fixtures/rival: deep.registerJob of
// test.upper, with a check of its own) is refused, its words naming test.upper (as a whole name, not test.upper_only)
// and test/upper-kind, and deep_job still lists test.upper held by test/upper-kind; test/upper-heir, the same code
// with `replaces: ["test.upper"]` in its manifest, installs, and deep_job lists test.upper held by it. Then, in a new
// world, upper-a@1.0.0 on "ABC" with {"case": "lower"} writes "abc", which fails test.upper_only: the reply isn't done,
// names test.upper_only, carries no output, and the evidence store holds no "abc" by hash, twice over (the rerun
// serves no cached output either); the same input in upper case passes the check.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { brief, CHECK, done, HOLDER, input, install, KIND, kindWorld, listKinds, outputOf, proof, rivalPlugin, runJob, said, sha256, shown, stored, TOOL_A } from './helpers.ts';

/** The kind's name as a whole name: test.upper, not test.upper_only or test.upper_rival. */
const NAMES_KIND = /test\.upper(?![\w-])/;

describe('#1922.a5d4640f A second registration of the kind test.upper by another plug-in is refused at install, naming the kind and the plug-in that holds it, unless its manifest says it replaces the first; and a job whose output fails test.upper_only returns that failure, naming the check, and leaves no output an item can name', () => {
  it('a second registration of test.upper is refused at install naming the kind and its holder, and one whose manifest replaces it installs', async () => {
    const w = await kindWorld();
    const rival = await install(w, rivalPlugin(join(w.tmp, 'rival'), false));
    const after = await listKinds(w);
    proof('ac4-rival.json', { install: rival, kinds: after });
    expect(rival.code, `the second registration of ${KIND} is refused at install: ${shown(rival)}`).not.toBe(0);
    expect(NAMES_KIND.test(said(rival)) && said(rival).includes(HOLDER), `the refusal names the kind ${KIND} and the plug-in that holds it, ${HOLDER}: ${shown(rival)}`).toBe(true);
    expect(after.find((k) => k.kind === KIND)?.plugin, `${KIND} is still held by ${HOLDER}`).toBe(HOLDER);

    const heir = await install(w, rivalPlugin(join(w.tmp, 'heir'), true));
    const now = await listKinds(w);
    proof('ac4-heir.json', { install: heir, kinds: now });
    expect(heir.code, `a plug-in whose manifest says it replaces ${KIND} installs: ${shown(heir)}`).toBe(0);
    expect(now.find((k) => k.kind === KIND)?.plugin, `${KIND} is held by test/upper-heir now`).toBe('test/upper-heir');
  }, 900_000);

  it('a job whose output fails test.upper_only returns that failure, naming the check, and leaves no output an item can name', async () => {
    const w = await kindWorld();
    const file = input(w, 'in.txt', 'ABC');
    const runs = [];
    for (const attempt of ['first', 'again']) {
      const r = await runJob(w, TOOL_A, '{"case":"lower"}', file);
      runs.push({ attempt, started: r.started, reply: r.outcome.value });
      expect(done(r.outcome), `the run whose output "abc" fails ${CHECK} isn't done (${attempt}): ${brief(r)}`).toBe(false);
      expect(r.outcome.text.includes(CHECK), `the reply names the check ${CHECK} (${attempt}): ${brief(r)}`).toBe(true);
      expect(outputOf(r.outcome), `the reply carries no output (${attempt})`).toBeUndefined();
      expect(JSON.stringify(r.outcome.value).includes(sha256('abc')), `the reply names no hash of the failed output (${attempt})`).toBe(false);
      if (attempt === 'first') expect(r.started, 'the tool ran: one process started').toBeGreaterThanOrEqual(1);
    }
    const kept = await stored(w, sha256('abc'));
    const passing = await runJob(w, TOOL_A, '{"case":"upper"}', file);
    proof('ac4-check.json', { runs, stored: kept ?? null, passing: passing.outcome.value });
    expect(kept, 'the evidence store holds no "abc" an item could name').toBeUndefined();
    expect(done(passing.outcome) && outputOf(passing.outcome) === sha256('ABC'), `the same input in upper case passes ${CHECK} and is done with "ABC": ${brief(passing)}`).toBe(true);
  }, 900_000);
});
