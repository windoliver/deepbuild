// AC4 #2697.1f9af6f6: "On the recorded film sessions of the agent eval, the agent reads the guide before its first
// render, and each brief's named checks are run as on the merge base. A planted skill with no line naming the guide
// fails, naming the session that never read it"
//
// Reads recordings only: no session is started and no model is called (README: AC4, and what is unrun). The recorded
// sessions are every run.json in the checkout the agent eval's scorer reads as a run (scripts/agent-eval.mjs), and a
// film session is one whose recorded `brief` holds `craft`, the checks the brief names. By the skill each recorded:
//   - on the change: the skill text is skills/deepbuild/SKILL.md, byte for byte;
//   - on the merge base: it holds the merge base's section "## Craft checks a film brief names";
//   - planted: neither, and no word of it is the guide's name (agent-eval's `--skill <file>`).
// asserts, first test: there is at least one film session on the change, and in each the first `deep_kinds {op: read,
// guide: <the guide>}` comes before the first `deep_show`; the checks its verdict rows report (`from: {craft: <name>}`
// in any result it was delivered) are the ones its brief names, and the ones the merge base's film session of the same
// `repo` reports. Second test: there is at least one planted film session, and the same first check fails on each,
// naming it as the session that never read the guide.
// No recording, no planted recording, no render or no merge-base counterpart is a failure, BLOCKED or INCONCLUSIVE,
// never a pass.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AC, SKILL, TIMEOUT, checksRunFailures, guideName, isFilm, none, readBeforeRenderFailures, recordings, runId, skillOf, useCleanup, useShow,
  type Recording,
} from './helpers.ts';

const bin = useShow();
useCleanup();
const BASE_SECTION = '\n## Craft checks a film brief names\n';
const namesGuide = (text: string, guide: string): boolean => new RegExp(`(?<![A-Za-z0-9_])${guide.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`).test(text);

/** The guide's name and the recorded film sessions, by the skill they recorded. */
function sessions(): { guide: string; change: Recording[]; base: Recording[]; planted: Recording[]; other: Recording[] } {
  const skill = readFileSync(SKILL, 'utf8');
  const named = guideName(bin(), skill);
  expect(named.failure, 'the skill\'s craft line names the guide deep_kinds serves').toBeUndefined();
  const guide = named.name!;
  const all = recordings();
  const films = all.filter(isFilm);
  console.log(`recorded runs: ${all.length} (${all.map((r) => r.file).join(', ') || 'none'}); film sessions: ${films.length}`);
  const change = films.filter((r) => skillOf(r) === skill);
  const base = films.filter((r) => skillOf(r).includes(BASE_SECTION));
  const planted = films.filter((r) => !change.includes(r) && !base.includes(r) && !namesGuide(skillOf(r), guide));
  const other = films.filter((r) => !change.includes(r) && !base.includes(r) && !planted.includes(r));
  if (other.length) console.log(`film sessions on another skill, not judged: ${other.map(runId).join(', ')}`);
  return { guide, change, base, planted, other };
}

describe(`${AC.sessions} on the agent eval's recorded film sessions, the guide is read before the first render`, () => {
  it(`${AC.sessions} each recorded film session reads the guide before its first render, and runs its brief's named checks as the merge base's session did`, () => {
    const { guide, change, base } = sessions();
    expect(change.length, 'BLOCKED: the agent eval has no recorded film session on this skill (a run.json whose brief holds craft and whose skill is skills/deepbuild/SKILL.md)').toBeGreaterThan(0);
    const baseOf = (r: Recording): Recording | undefined => base.find((b) => b.run['repo'] === r.run['repo']);
    none(change.flatMap((r) => [...readBeforeRenderFailures(r, guide), ...checksRunFailures(r, baseOf(r))]), 'the recorded film sessions');
  }, TIMEOUT);

  it(`${AC.sessions} a recorded film session on a planted skill with no line naming the guide fails, naming the session`, () => {
    const { guide, planted } = sessions();
    expect(planted.length, 'BLOCKED: the agent eval has no recorded film session on a planted skill that names no guide').toBeGreaterThan(0);
    for (const r of planted) {
      const failures = readBeforeRenderFailures(r, guide);
      expect(failures.some((f) => f.startsWith(`${runId(r)}:`) && f.includes('never read the guide')), `the planted session ${runId(r)} fails, named as the session that never read ${guide}: ${failures.join(' | ') || 'it passed'}`).toBe(true);
    }
  }, TIMEOUT);
});
