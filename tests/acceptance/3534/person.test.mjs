// #3534 criteria 2, 3 and 7: what an issue waits on a person for, split by the six kinds; the prompts a person sends
// before the merge; a wait for a person told from a wait for a job; and a wait cut at the merge. Written blind from
// issue #3534 at base 5a81b58de (README). One fixture serves every test of this file; the command runs once a span.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { CAUSES, cleanup, clock, fixture, instant, KINDS, LATER, near, partOf, plural, reading, rowOf, show, SPAN, sum, TEST } from './helpers.mjs';

after(cleanup);

const READ = ['A', 'B', 'C'];
const six = (person) => Object.fromEntries(KINDS.map((kind) => [kind, person[kind]]));
/** The fixture's waits of an issue under the given causes, for a message. */
const waits = (want, causes) => want.waits.filter((wait) => causes.includes(wait.cause)).map((wait) => `${plural(wait.counted ?? wait.minutes)} of ${wait.what} (${clock(wait.from)} to ${clock(wait.to)})`).join('; ');

test("#3534.e845c6a7 a person's wait is split into merge, prompt, conflict, plan, question and permission, and the six sum to the issue's person minutes", TEST, () => {
  const read = reading(SPAN);
  for (const name of READ) {
    const want = fixture().rows[name];
    const row = rowOf(read, want);
    const got = six(row.person);
    assert.equal(sum(got), row.causes.person, `issue #${want.issue}: its six kinds of a person's wait sum to ${sum(got)} minutes, and its causes give a person ${row.causes.person}\nperson ${show(row.person)}\ncauses ${show(row.causes)}\n${read.said}`);
    assert.deepEqual(got, want.person, `issue #${want.issue}: a person's waits are ${show(got)}, not ${show(want.person)}. The fixture has ${waits(want, KINDS)}${name === 'A' ? '; and a plan\'s approval of 12 minutes, a question\'s answer of 9 and a call a person permitted of 6' : ''}\n${read.said}`);
  }
});

test("#3534.e845c6a7 only a prompt that is the app's conflict line is a conflict: one that talks of merge conflicts in its own words, or opens with the line's first words, is a prompt like any other", TEST, () => {
  const read = reading(SPAN);
  const want = fixture().rows.A;
  const row = rowOf(read, want);
  const talk = want.waits.find((wait) => wait.what.includes('only talks of merge conflicts'));
  const line = want.waits.find((wait) => wait.cause === 'conflict');
  assert.equal(row.person.conflict, want.person.conflict, `issue #${want.issue}: conflict is ${row.person.conflict} minutes, not the ${line.minutes} from a turn's end (${clock(line.from)}) to the prompt that is the app's conflict line (${clock(line.to)})${row.person.conflict === line.minutes + talk.minutes ? `; the ${talk.minutes} minutes before a prompt that only talks of merge conflicts (${clock(talk.to)}) are counted with them, and no other prompt is read for its words` : ''}\nperson ${show(row.person)}\n${read.said}`);
  assert.equal(row.person.prompt, want.person.prompt, `issue #${want.issue}: prompt is ${row.person.prompt} minutes, not ${want.person.prompt}: ${waits(want, ['prompt'])}\nperson ${show(row.person)}\n${read.said}`);
  for (const name of ['B', 'C']) {
    const none = fixture().rows[name];
    const other = rowOf(read, none);
    const opens = none.waits.find((wait) => wait.what.includes('opens with the words Merge conflicts'));
    assert.equal(other.person.conflict, 0, `issue #${none.issue} has no prompt that is the app's conflict line, and its conflict is ${other.person.conflict} minutes${opens && other.person.conflict === opens.minutes ? `: the ${opens.minutes} before ${opens.what.replace(/^a turn's end until /, '')} (${clock(opens.to)}), which is not the line` : ''}\nperson ${show(other.person)}\n${read.said}`);
  }
});

// The Fields' words, under the criterion whose split they average: `total.person`.
test("#3534.e845c6a7 the totals give each of a person's six kinds of wait as minutes an issue", TEST, () => {
  const read = reading(SPAN);
  const total = partOf(read, 'total');
  const want = fixture().total;
  const each = (pick) => READ.map((name) => `#${fixture().rows[name].issue} ${pick(fixture().rows[name])}`).join(', ');
  for (const kind of KINDS) {
    assert.ok(near(total.person?.[kind], want.person[kind]), `total.person.${kind} is ${show(total.person?.[kind])}, not the ${want.person[kind]} minutes an issue of ${each((row) => row.person[kind])}\ntotal.person ${show(total.person)}\n${read.said}`);
  }
});

test("#3534.021e72cb prompts counts a person's prompts before the merge, beside the first", TEST, () => {
  const read = reading(SPAN);
  const notes = {
    A: 'after its first prompt a person sends three: one for the total, the app\'s conflict line, and one that asks about conflicts; a sidechain row, a tool\'s result and the first prompt are none of them',
    B: 'after its first prompt a person sends four over its two sessions, the second session\'s opening prompt among them; its two job notices are no person\'s prompt',
    C: 'after its first prompt a person sends two, the morning after and once more',
  };
  // One more for every issue is what the count reads with the first prompt in it.
  const withFirst = READ.every((name) => rowOf(read, fixture().rows[name]).prompts === fixture().rows[name].prompts + 1);
  for (const name of READ) {
    const want = fixture().rows[name];
    const row = rowOf(read, want);
    assert.equal(row.prompts, want.prompts, `issue #${want.issue}: prompts is ${show(row.prompts)}, not ${want.prompts}: ${notes[name]}${withFirst ? '; every issue reads one more, which is the count with the first prompt in it' : ''}\n${read.said}`);
  }
  const later = reading(LATER);
  const want = fixture().rows.D;
  const row = rowOf(later, want);
  assert.equal(row.prompts, want.prompts, `issue #${want.issue}: prompts is ${show(row.prompts)}, not ${want.prompts}: its one other prompt comes at ${clock(want.waits[0].to)}, after its merge at ${clock(want.merged)}\n${later.said}`);
});

// The Fields' words, under the criterion whose count they average: `total.prompts`.
test('#3534.021e72cb the totals give the prompts an issue: the mean of the count over the issues read', TEST, () => {
  const read = reading(SPAN);
  const total = partOf(read, 'total');
  const each = READ.map((name) => `#${fixture().rows[name].issue} ${fixture().rows[name].prompts}`).join(', ');
  assert.ok(near(total.prompts, fixture().total.prompts), `total.prompts is ${show(total.prompts)}, not the ${fixture().total.prompts} prompts an issue of ${each}\n${read.said}`);
});

test("#3534.8eed42c8 a turn's end until a person's prompt is a wait for a person, and a wait for a job only when a job the session started gives its notice after that prompt", TEST, () => {
  const read = reading(SPAN);
  for (const name of READ) {
    const want = fixture().rows[name];
    const row = rowOf(read, want);
    const fromPerson = want.causes.person - row.causes.person, toJob = row.causes.job - want.causes.job;
    const moved = fromPerson > 0 && toJob > 0 ? `${plural(Math.min(fromPerson, toJob))} of waiting for a person ${Math.min(fromPerson, toJob) === 1 ? 'is' : 'are'} counted as waiting for a job`
      : fromPerson < 0 && toJob < 0 ? `${plural(Math.min(-fromPerson, -toJob))} of waiting for a job ${Math.min(-fromPerson, -toJob) === 1 ? 'is' : 'are'} counted as waiting for a person` : 'the two do not match the fixture';
    const said = `issue #${want.issue}: ${moved}: person is ${row.causes.person} minutes where the fixture has ${want.causes.person}, and job is ${row.causes.job} where it has ${want.causes.job}.\nIts waits for a person: ${waits(want, KINDS)}.\nIts waits for a job after a turn's end: ${waits(want, ['job']) || 'none'}.\n${read.said}`;
    assert.equal(row.causes.person, want.causes.person, said);
    assert.equal(row.causes.job, want.causes.job, said);
  }
});

test('#3534.8eed42c8 a wait that runs past the merge is cut at the merge, and what follows the merge counts for nothing', TEST, () => {
  const read = reading(LATER);
  const want = fixture().rows.D;
  const row = rowOf(read, want);
  const [wait] = want.waits;
  const past = `its last turn's end before the merge, at ${clock(wait.from)}, waits ${wait.minutes} minutes for the next prompt, at ${clock(wait.to)}, and the merge comes ${wait.counted} minutes into that wait, at ${clock(want.merged)}: ${wait.minutes - wait.counted} of its minutes lie past the merge`;
  const counted = CAUSES.reduce((total, cause) => total + row.causes[cause], 0);
  assert.equal(counted, want.minutes, `issue #${want.issue}: its causes sum to ${counted} minutes, ${plural(Math.abs(counted - want.minutes))} ${counted > want.minutes ? 'more' : 'fewer'} than the ${want.minutes} from its first prompt (${clock(want.first_prompt)}) to its merge; ${past}\ncauses ${show(row.causes)}\n${read.said}`);
  assert.equal(row.minutes, want.minutes, `issue #${want.issue}: \`minutes\` is ${row.minutes}, not the ${want.minutes} from its first prompt (${clock(want.first_prompt)}) to its merge; ${past}\n${read.said}`);
  assert.equal(instant(row.merged), want.merged, `issue #${want.issue}: merged is ${show(row.merged)}, not ${clock(want.merged)}\n${read.said}`);
  assert.equal(row.causes.person, want.causes.person, `issue #${want.issue}: a person is waited on for ${row.causes.person} minutes, not the ${want.causes.person} up to the merge; ${past}\ncauses ${show(row.causes)}\n${read.said}`);
  // Whether the part up to the merge is `merge` or `prompt` the issue leaves open: the two are read together.
  const { merge, prompt, ...others } = six(row.person);
  assert.equal(merge + prompt, want.either, `issue #${want.issue}: merge and prompt give ${merge + prompt} minutes together, not the ${want.either} up to the merge; ${past}\nperson ${show(row.person)}\n${read.said}`);
  assert.equal(sum(others), 0, `issue #${want.issue} has no conflict line, plan, question or permitted call, and its person minutes are ${show(row.person)}\n${read.said}`);
  const rest = { own: row.causes.own, job: row.causes.job, hook: row.causes.hook, unplaced: row.causes.unplaced };
  assert.deepEqual(rest, { own: want.causes.own, job: want.causes.job, hook: 0, unplaced: 0 }, `issue #${want.issue}: before its merge it has ${want.causes.own} minutes of its own work and a call of ${want.causes.job}; the thinking and the 6-minute call after ${clock(wait.to)} lie past the merge\ncauses ${show(row.causes)}\n${read.said}`);
});
