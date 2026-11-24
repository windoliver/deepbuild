// AC4 #2697.6cec48c3: "The agent eval scores a film session on the guide, offline: `node scripts/agent-eval.mjs
// score`, given a film session in the recorded run's shape (its `brief` names craft checks) built from real `deep-show
// run` replies with no model called, passes it when the first `deep_kinds` read of the guide its skill names comes
// before its first `deep_show` and its verdict rows report exactly the checks its brief names. The same session fails,
// each time with a reason naming the session, when the read comes after the first render, when it never reads the
// guide, when its rows miss a check its brief names or report one it doesn't, and when its skill is a planted skill
// with no line naming the guide"
//
// Each session is one `deep-show run` scenario on the checkout's deep-show (#409's world and film: the agent presents
// three 3 s shots, its claim's brief names the craft checks), recorded in run.json's shape with deep-show's replies as
// the calls' results, and scored by the CLI (README: AC4). The good session reads the guide the skill names first and
// its claim's brief names shot_length and ends, the checks its recorded brief names; it keeps every rule the scorer
// had before (the skill pinned to the installed version, its tools the live list, its first call the manifest's, no
// call twice, its one claim cited from the verdict), so only the film rules decide. Each other session changes one
// thing.
// asserts: the good session is PASS, exit 0, no reason. Each other is FAIL, exit 1, with a reason whose text names its
// run id (and ends, for the rows that miss it or report it).
// Wrong programs: the merge base's scorer, which has no film rule (it fails the five FAIL tests); for the PASS test,
// twins/eval-fails-briefs (the merge base's scorer failing every session whose brief names a craft check).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AC, SKILL, TIMEOUT, filmSession, guideName, plantedSkill, scoredFailNaming, scoredPass, scoreSession, useCleanup, useShow, type FilmSession } from './helpers.ts';

const bin = useShow();
useCleanup();

/** The skill and the guide it names, read from it as every test of this suite reads it. */
function theSkill(): { skill: string; guide: string } {
  const skill = readFileSync(SKILL, 'utf8');
  const named = guideName(bin(), skill);
  expect(named.failure, 'the skill\'s craft line names the guide deep_kinds serves').toBeUndefined();
  return { skill, guide: named.name! };
}
/** The good session, with `change` applied. */
function session(run: string, change: Partial<FilmSession> = {}): FilmSession {
  const { skill, guide } = theSkill();
  return { run, skill, guide, read: 'before', brief: ['shot_length', 'ends'], ...change };
}

describe(`${AC.sessions} the agent eval's scorer judges a film session on the guide, offline`, () => {
  it(`${AC.sessions} a film session that reads the guide before its first deep_show and whose rows report exactly its brief's checks passes`, () => {
    const s = session('eval-claude-code-kettle-film-good');
    scoredPass(scoreSession(filmSession(bin(), s)), 'the good film session');
  }, TIMEOUT);

  it(`${AC.sessions} the session fails, naming it, when its read of the guide comes after its first render`, () => {
    const s = session('eval-claude-code-kettle-film-read-after', { read: 'after' });
    scoredFailNaming(scoreSession(filmSession(bin(), s)), s.run, [], 'the session that reads the guide after its first deep_show');
  }, TIMEOUT);

  it(`${AC.sessions} the session fails, naming it, when it never reads the guide`, () => {
    const s = session('eval-claude-code-kettle-film-never-read', { read: 'never' });
    scoredFailNaming(scoreSession(filmSession(bin(), s)), s.run, [], 'the session that never reads the guide');
  }, TIMEOUT);

  it(`${AC.sessions} the session fails, naming it and the check, when its rows miss a check its brief names`, () => {
    const s = session('eval-claude-code-kettle-film-rows-miss', { brief: ['shot_length', 'ends'], ran: ['shot_length'] });
    scoredFailNaming(scoreSession(filmSession(bin(), s)), s.run, ['ends'], 'the session whose rows miss ends, which its brief names');
  }, TIMEOUT);

  it(`${AC.sessions} the session fails, naming it and the check, when its rows report a check its brief doesn't name`, () => {
    const s = session('eval-claude-code-kettle-film-rows-unnamed', { brief: ['shot_length'], ran: ['shot_length', 'ends'] });
    scoredFailNaming(scoreSession(filmSession(bin(), s)), s.run, ['ends'], 'the session whose rows report ends, which its brief doesn\'t name');
  }, TIMEOUT);

  it(`${AC.sessions} the session fails, naming it, when its skill is a planted skill with no line naming the guide`, () => {
    const good = session('eval-claude-code-kettle-film-planted-skill');
    const s = { ...good, skill: plantedSkill(good.skill, good.guide) };
    scoredFailNaming(scoreSession(filmSession(bin(), s)), s.run, [], 'the session on the planted skill');
  }, TIMEOUT);
});
