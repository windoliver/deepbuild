// #567's fast tests: no Claude Code session and no spend.
//
// AC1: the exit's scenario with a made-up Claude Code session (README: The made-up session). Its hooks run through the
// entries `deep setup` wrote into the temporary home's user settings, the real deep-hook and the real hub, in a repo
// whose `.deepbuild/done.yaml` names a unit check that fails; the session edits a line that fixes nothing and stops
// saying it is done. The check is the one the live test runs on a real session. The issue's wrong program, a build
// without the Stop hold, is the twin `no-stop-hold` (twins.json), which the proof lane lays over the checkout.
//
// AC2 and AC3: the spine's record, `docs/spine.json` (README: The spine's record), read against this checkout's git
// history, never taken at its word; each check is also run on wrong records made from it, which must fail naming why.
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC1, AC2, AC3, chatOf, cleanup, editFile, exitScenario, falseDoneProblems, FIX, historyOrBlocked, measuredSpine, readLines,
  readSpineRecord, redact, repoGit, seenOf, spineProblems, stop, timeProblems, unitPasses, weeksProblems, writeProof, type SpineRecord,
} from './helpers.ts';

afterAll(cleanup, 60_000);

describe(`${AC1} In a Claude Code session, a seeded false "done" is held, sent back, and its verdict line shows in the chat`, () => {
  it(`${AC1} a made-up session through setup's entries, deep-hook and the hub: its false "done" is held until the spec's unit check ran, sent back naming unit, and its verdict line shows in the chat; the same session's true "done" is let through`, async () => {
    const x = await exitScenario();
    writeProof('fast', 'record.json', JSON.stringify(x.events.filter((e) => e.log_pos > x.since), null, 1));
    writeProof('fast', 'false-done.json', JSON.stringify(x.falseDone, null, 1));
    falseDoneProblems({ events: x.events, session: x.s.id, since: x.since, seen: x.falseDone, check: 'unit', chat: x.chat });
    // Held because it was false: once the agent makes the fix, its next stop (Claude Code's continuation) isn't sent back.
    editFile(x.w, 'src/auth.js', FIX);
    expect(unitPasses(x.w), 'the fix makes the unit check pass, run by hand').toBe(true);
    const auth = join(x.w.repo, 'src/auth.js');
    await x.claude.tool(x.s, 'Edit', { file_path: auth, old_string: FIX.from, new_string: FIX.to }, { filePath: auth, oldString: FIX.from, newString: FIX.to });
    const fixed = seenOf(await stop(x.claude, x.s, 'Fixed: expired tokens are rejected now.', true));
    writeProof('fast', 'true-done.json', JSON.stringify(fixed, null, 1));
    writeProof('fast', 'transcript.jsonl', readLines(x.s.transcript).map((e) => JSON.stringify(e)).join('\n'));
    expect(fixed.blocked, `${AC1} a stop is held and sent back for being false: the same session's stop after the fix, with the unit check passing, must be let through: ${fixed.shownAs}`).toBeUndefined();
    expect(fixed.line ?? '', `${AC1} the true "done" isn't shown as sent back: ${fixed.shownAs}`).not.toMatch(/\bsent back\b/);
    expect(chatOf(x.s).length, 'the transcript keeps what the chat showed').toBeGreaterThan(0);
    await x.claude.end();
  }, 300_000);
});

/** The spine's record, with git history to read it against; BLOCKED without either. */
function record(): SpineRecord {
  historyOrBlocked();
  return readSpineRecord();
}
const clone = (rec: SpineRecord): SpineRecord => JSON.parse(JSON.stringify(rec)) as SpineRecord;
/** A commit on HEAD's first-parent line that isn't a merge: a landing no pull request made. */
const notAMerge = () => repoGit('rev-list', '--first-parent', '--no-merges', '-n', '1', 'HEAD');

describe(`${AC2} It runs with only the spine's 25 tasks landed`, () => {
  it(`${AC2} the spine's record lists its 25 tasks, #44 as #348, #349 and #350, #236 in part (its run tokens) and #32 as #322, and each landed on main by a merge that names it`, () => {
    const problems = spineProblems(record());
    expect(problems, problems.join('\n')).toEqual([]);
  }, 120_000);

  it(`${AC2} (wrong records) a record missing a task, counting #44 whole, naming #32 itself, or landing a task by a commit that isn't its merge fails, naming the task`, () => {
    const rec = record();
    const wrong: [string, (r: SpineRecord) => void, RegExp][] = [
      ['#31 left out', (r) => { r.tasks = r.tasks.filter((t) => t.issue !== 31); }, /#31\b/],
      ['#44 counted whole', (r) => { const t = r.tasks.find((k) => k.issue === 44)!; delete t.counts_as; }, /#44\b/],
      ['#32 landed as itself', (r) => { const t = r.tasks.find((k) => k.issue === 32)!; t.landed = t.landed.map((l) => ({ ...l, issue: 32 })); }, /#32\b|#322\b/],
      ['#236 whole', (r) => { delete r.tasks.find((k) => k.issue === 236)!.part; }, /#236\b/],
      ['#25 landed by a commit that is no merge', (r) => { const t = r.tasks.find((k) => k.issue === 25)!; t.landed = [{ issue: 25, merge: notAMerge() }]; }, /#25\b/],
      ['#28 landed by #29\'s merge', (r) => { const t = r.tasks.find((k) => k.issue === 28)!; t.landed = r.tasks.find((k) => k.issue === 29)!.landed.map((l) => ({ ...l, issue: 28 })); }, /#28\b/],
    ];
    for (const [what, mutate, names] of wrong) {
      const r = clone(rec);
      mutate(r);
      const problems = spineProblems(r);
      expect(problems.length, `${AC2} the record with ${what} must fail the check`).toBeGreaterThan(0);
      expect(problems.join('\n'), `${AC2} the record with ${what} must fail naming the task`).toMatch(names);
    }
  }, 120_000);
});

describe(`${AC3} The spine's time is measured and recorded, and the weeks are held to six only once it has landed and been measured`, () => {
  it(`${AC3} the recorded start, landing and days are git's measurement of the record's merges, and past three weeks the weeks are replanned by a change to the design's Six weeks section made after the spine landed`, () => {
    const rec = record();
    const measured = measuredSpine(rec);
    writeProof('spine', 'measured.json', redact(JSON.stringify({ recorded: { started: rec.started, landed: rec.landed, days: rec.days, weeks: rec.weeks }, measured: typeof measured === 'string' ? measured : { started: new Date(measured.started).toISOString(), landed: new Date(measured.landed).toISOString(), days: measured.days } }, null, 1)));
    const problems = timeProblems(rec);
    expect(problems, problems.join('\n')).toEqual([]);
  }, 120_000);

  it(`${AC3} (wrong records) a time that isn't git's, no plan for the weeks, or, for a spine past three weeks, weeks held to six, no design change, or one made before the spine landed, fails`, () => {
    const rec = record();
    const measured = measuredSpine(rec);
    if (typeof measured === 'string') throw Error(`${AC3} the spine's time can't be measured: ${measured}`);
    const wrong: [string, (r: SpineRecord) => void, RegExp][] = [
      ['a day more than git measured', (r) => { r.days = Number(r.days) + 1; }, /days/],
      ['a start a day early', (r) => { r.started = new Date(measured.started - 86_400_000).toISOString(); }, /started/],
      ['a landing an hour late', (r) => { r.landed = new Date(measured.landed + 3_600_000).toISOString(); }, /landed/],
      ['no plan for the weeks', (r) => { (r as { weeks?: unknown }).weeks = undefined; }, /weeks/],
      ['the spine not landed (#30 left out)', (r) => { r.tasks = r.tasks.filter((t) => t.issue !== 30); }, /landed/],
    ];
    for (const [what, mutate, names] of wrong) {
      const r = clone(rec);
      mutate(r);
      const problems = timeProblems(r);
      expect(problems.length, `${AC3} the record with ${what} must fail the check`).toBeGreaterThan(0);
      expect(problems.join('\n'), `${AC3} the record with ${what} must fail saying why`).toMatch(names);
    }
    // The weeks' rule on a spine of 22 days, whatever this one took: replanned, by a design change after it landed.
    const early = repoGit('rev-list', '-n', '1', `--before=${Math.floor(measured.landed / 1000) - 86_400}`, 'HEAD', '--', 'docs/technical-design.md');
    const rules: [string, SpineRecord['weeks'], RegExp][] = [
      ['held to six weeks', { plan: 'six weeks', design_change: rec.weeks?.design_change ?? null }, /three weeks/],
      ['replanned with no design change', { plan: 'replanned', design_change: null }, /design change/],
      ['replanned by a design commit from before the spine landed', { plan: 'replanned', design_change: early }, /before the spine landed/],
    ];
    for (const [what, weeks, names] of rules) {
      const problems = weeksProblems(22, measured.landed, weeks);
      expect(problems.join('\n'), `${AC3} a spine of 22 days ${what} must fail saying why`).toMatch(names);
    }
  }, 120_000);
});
