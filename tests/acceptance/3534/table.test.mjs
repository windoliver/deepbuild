// #3534 criteria 1 and 9: the table `node scripts/issue-time.mjs --since <day> [--until <day>]` prints. Criterion 1:
// each issue's causes sum to its whole time, from its session's first prompt to its merge. Criterion 9: the table holds
// each issue whose PR merged in the span, named by the first of the four words of its PR's body; the totals; the forge
// read once; nothing written. Written blind from issue #3534 at base 5a81b58de (README). One fixture serves every test
// of this file; the command runs once a span.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { CAUSES, cleanup, clock, fixture, instant, issueTime, LATER, NAMED_LATER, near, NOT_READ, numberOf, OPEN_ENDED, OUTSIDE, partOf, plural, reading, rowOf, rowsOf, show, snapshot, SPAN, started, TEST, waitsOf } from './helpers.mjs';

after(cleanup);

const span = (words) => words.join(' ');
const READ = ['A', 'B', 'C'];
/** The first span's reading, once its table holds the three issues with minutes above 0: an empty table shows nothing. */
function readWhole() {
  const read = reading(SPAN);
  for (const name of READ) {
    const want = fixture().rows[name];
    const row = rowOf(read, want);
    assert.ok(row.minutes > 0, `issue #${want.issue}: \`minutes\` is ${row.minutes}, where the fixture has ${want.minutes}: a table of zeros shows nothing of what the command read\n${read.said}`);
  }
  return read;
}

test("#3534.8aeb9b47 each issue's causes sum to its whole time, from its session's first prompt to its merge, to the minute", TEST, () => {
  for (const [days, names] of [[SPAN, READ], [LATER, ['D']]]) {
    const read = reading(days);
    for (const name of names) {
      const want = fixture().rows[name];
      const row = rowOf(read, want);
      const counted = CAUSES.reduce((total, cause) => total + row.causes[cause], 0);
      const whole = `the ${want.minutes} from its first prompt (${clock(want.first_prompt)}) to its merge (${clock(want.merged)})`;
      const missing = want.minutes - counted;
      const left = missing > 0 ? waitsOf(want, missing) : [];
      assert.equal(counted, want.minutes, `issue #${want.issue}: its causes sum to ${counted} minutes, ${missing > 0 ? `${plural(missing)} short of` : `${plural(-missing)} over`} ${whole}${left.length ? `; the fixture has a wait of ${plural(missing)} there: ${left.join('; and ')}` : ''}\ncauses ${show(row.causes)}\n${read.said}`);
      assert.equal(row.minutes, want.minutes, `issue #${want.issue}: \`minutes\` is ${row.minutes}, not ${whole}: ${plural(Math.abs(want.minutes - row.minutes))} ${want.minutes > row.minutes ? 'are missing' : 'too many'}\n${read.said}`);
    }
  }
});

// The Scope's words, under the criterion whose sum they make: what is own, and what the records can't place.
test('#3534.8aeb9b47 of the causes that sum, thinking and each tool call that returns within a minute are own, thinking over 15 minutes is unplaced, and neither is spread over another cause', TEST, () => {
  const read = reading(SPAN);
  const notes = {
    A: 'its thinking and its two calls of 20 seconds are own',
    B: 'its thinking and its three calls of 20 seconds, over two sessions, are own',
    C: 'it thinks once for 45 minutes, which is unplaced, and once for 14, which is own',
  };
  for (const name of READ) {
    const want = fixture().rows[name];
    const row = rowOf(read, want);
    assert.equal(row.causes.own, want.causes.own, `issue #${want.issue}: own is ${row.causes.own} minutes, not ${want.causes.own}: ${notes[name]}\ncauses ${show(row.causes)}, the fixture's ${show(want.causes)}\n${read.said}`);
    assert.equal(row.causes.unplaced, want.causes.unplaced, `issue #${want.issue}: unplaced is ${row.causes.unplaced} minutes, not ${want.causes.unplaced}: ${notes[name]}\ncauses ${show(row.causes)}, the fixture's ${show(want.causes)}\n${read.said}`);
  }
});

test("#3534.4ae32bc7 the totals give the issues read, the mean and the median of their minutes, the share that took over 12 hours and each cause's mean an issue", TEST, () => {
  const read = reading(SPAN);
  const total = partOf(read, 'total');
  const fx = fixture(), want = fx.total;
  const each = (pick) => READ.map((name) => `#${fx.rows[name].issue} ${pick(fx.rows[name])}`).join(', ');
  const times = each((row) => row.minutes);
  const sorted = READ.map((name) => fx.rows[name].minutes).sort((one, two) => one - two);
  // The middle issue by number, by first prompt and by merge is not the middle one by minutes.
  const unsorted = fx.rows.A.minutes;
  assert.equal(total.issues, want.issues, `total.issues is ${show(total.issues)}, not the ${want.issues} issues read (${times} minutes)\n${read.said}`);
  assert.ok(near(total.mean, want.mean), `total.mean is ${show(total.mean)}, not the ${want.mean} minutes an issue of ${times}\n${read.said}`);
  assert.ok(near(total.median, want.median), `total.median is ${show(total.median)}, not ${want.median}, the middle of the three times in order (${sorted.join(', ')})${near(total.median, unsorted) ? `; ${unsorted} is the time of #${fx.rows.A.issue}, the middle issue by number and by merge, not by minutes` : ''}\n${read.said}`);
  assert.ok(near(total.over_12h, want.over_12h), `total.over_12h is ${show(total.over_12h)}, not ${want.over_12h.toFixed(2)}: one issue of the three took over 12 hours (${times}), as a share from 0 to 1\n${read.said}`);
  for (const cause of CAUSES) {
    assert.ok(near(total.causes?.[cause], want.causes[cause]), `total.causes.${cause} is ${show(total.causes?.[cause])}, not the ${want.causes[cause]} minutes an issue of ${each((row) => row.causes[cause])}\ntotal.causes ${show(total.causes)}\n${read.said}`);
  }
});

test("#3534.4ae32bc7 the table holds each issue whose PR merged in the span, named by the first Closes, Fixes, Resolves or Part of of its PR's body, with its PR, its first prompt and its merge", TEST, () => {
  const fx = fixture();
  const why = (issue) => {
    if (issue === OUTSIDE.after.issue) return `#${issue}'s PR merged ${clock(OUTSIDE.after.merged)}, after the span`;
    if (issue === OUTSIDE.before.issue) return `#${issue}'s PR merged ${clock(OUTSIDE.before.merged)}, before the span`;
    if (issue === NOT_READ.issue) return `#${issue} has no transcript: it is listed in not_read, never as a row`;
    if (NAMED_LATER[issue]) return `${NAMED_LATER[issue]}: a PR's issue is the first of the four in its body`;
    if (issue === OUTSIDE.open.issue) return `#${issue}'s PR is open, not merged`;
    return `${show(issue)} is no issue of the fixture: a PR whose body has no Closes, Fixes, Resolves or Part of is left out`;
  };
  for (const [days, names] of [[SPAN, READ], [LATER, ['D']], [OPEN_ENDED, ['D']]]) {
    const read = reading(days);
    const wanted = names.map((name) => fx.rows[name]);
    const listed = rowsOf(read).map((row) => numberOf(row?.issue));
    const extra = listed.filter((issue) => !wanted.some((want) => want.issue === issue));
    assert.deepEqual(extra, [], `over ${span(days)} the table has a row for ${extra.map((issue) => show(issue)).join(', ')}, which it should not: ${extra.map(why).join('; ')}\n${read.said}`);
    for (const want of wanted) {
      const row = rowOf(read, want);
      assert.equal(numberOf(row.pr), want.pr, `issue #${want.issue}: its PR is #${want.pr}, and the row says ${show(row.pr)}\n${show(row)}`);
      const first = instant(row.first_prompt);
      const decoy = first === fx.decoyFirstPrompt ? '; that is the first prompt of a transcript on the PR\'s head branch that holds no PR link, and a PR\'s sessions are the transcripts that hold its link, or else those on its branch' : '';
      assert.equal(first, want.first_prompt, `issue #${want.issue}: first_prompt is ${show(row.first_prompt)}, not ${clock(want.first_prompt)}, its sessions' first prompt of a person${decoy}\n${show(row)}`);
      assert.equal(instant(row.merged), want.merged, `issue #${want.issue}: merged is ${show(row.merged)}, not ${clock(want.merged)}, the mergedAt the forge gives PR #${want.pr}\n${show(row)}`);
    }
    assert.ok(String(read.json.since).startsWith(days[1]), `over ${span(days)}, since is ${show(read.json.since)}\n${read.said}`);
  }
});

test('#3534.4ae32bc7 #3534.087b8d1d without --json the table is printed: a line for each issue read, the totals after them, and the issue not read with its PR', TEST, () => {
  const run = started(issueTime(SPAN));
  // Colour codes, if any, are not part of the table.
  const lines = run.stdout.replace(/\x1b\[[0-9;]*m/g, '').split('\n');
  const names = (line, number) => RegExp(`(?<![\\d.])${number}(?![\\d.])`).test(line);
  const at = (number) => lines.findIndex((line) => names(line, number));
  const read = READ.map((name) => fixture().rows[name].issue);
  for (const issue of read) assert.ok(at(issue) >= 0, `no line of the table names issue ${issue}, whose PR merged in the span\n${run.said}`);
  const last = Math.max(...read.map((issue) => lines.findLastIndex((line) => names(line, issue))));
  assert.ok(lines.some((line, k) => k > last && /\b(?:totals?|means?|averages?|avg|median|overall|all issues|an issue|per issue)\b/i.test(line)), `no line after the issues' lines gives the totals (a line that says total, mean, average, median, overall, all issues or an issue)\n${run.said}`);
  for (const outside of [OUTSIDE.after, OUTSIDE.before]) assert.equal(at(outside.issue), -1, `a line of the table names issue ${outside.issue}, whose PR merged ${clock(outside.merged)}, outside the span: ${lines[at(outside.issue)]}\n${run.said}`);
  assert.ok(lines.some((line) => names(line, NOT_READ.issue) && names(line, NOT_READ.pr)), `no line names issue ${NOT_READ.issue} with its PR ${NOT_READ.pr}: an issue with no transcript is listed as not read, with its PR\n${run.said}`);
  assert.match(run.stdout, /not[ _-]?read/i, `the table lists issue ${NOT_READ.issue} without saying it is not read\n${run.said}`);
});

test('#3534.4ae32bc7 the forge is read once a run, with gh pr list --state merged, for each PR\'s number, title, body, headRefName and mergedAt', TEST, () => {
  // Each run's own gh calls, as the stand-in wrote them down: two spans with --json, and the table printed.
  for (const run of [readWhole().run, reading(LATER).run, started(issueTime(SPAN))]) {
    const calls = run.gh.map((call) => `gh ${call.join(' ')}`);
    assert.equal(run.gh.length, 1, `the forge is read once, and \`${run.command}\` called gh ${plural(run.gh.length, 'time')}${calls.length ? `: ${calls.join(' | ')}` : ''}\n${run.said}`);
    const [call] = run.gh, [said] = calls;
    assert.ok(call.includes('pr') && call.indexOf('list') === call.indexOf('pr') + 1, `the forge is read with gh pr list, and \`${run.command}\` called ${said}`);
    assert.match(` ${call.join(' ')} `, / (?:--state[= ]|-s )merged /, `the forge is read with gh pr list --state merged, and \`${run.command}\` called ${said}`);
    const fields = (call.find((word) => word.startsWith('--json='))?.slice(7) ?? call[call.indexOf('--json') + 1] ?? '').split(',');
    const unasked = ['number', 'title', 'body', 'headRefName', 'mergedAt'].filter((field) => !fields.includes(field));
    assert.deepEqual(unasked, [], `the forge is read for each PR's number, title, body, headRefName and mergedAt, and ${said} asks for no ${unasked.join(', ')}`);
  }
});

test('#3534.4ae32bc7 the command writes nothing: after its runs the tree, the home folder and the temporary folder hold what they held before the first', TEST, () => {
  const fx = fixture();
  // The folders are compared with what they held before the command ever ran: with --json and without, over two spans.
  const runs = [readWhole().run, reading(LATER).run, started(issueTime(SPAN))];
  const before = fx.pristine, now = snapshot(fx);
  const changed = [...new Set([...Object.keys(before), ...Object.keys(now)])].filter((path) => before[path] !== now[path]).map((path) => `${path} ${!(path in before) ? 'is new' : !(path in now) ? 'is gone' : 'changed'}`);
  assert.deepEqual(changed, [], `the command writes nothing, and after ${runs.map((run) => `\`${run.command}\``).join(', ')}: ${changed.join(', ')} (<tree> is the scratch repository, ~ the runs' HOME, <tmp> their TMPDIR)\n${runs[0].said}`);
});
