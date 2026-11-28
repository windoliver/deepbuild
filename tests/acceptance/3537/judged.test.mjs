import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { approvalItem, judgedRow, loop, manifest, marked, measured, names, percent, recordOf, rowOf, scriptOf, sidesOf, staged, task, within, working } from './helpers.mjs';

const UNREADABLE = '{"work":{"records":"many"}}';
const NO_WORK = '{"held":512}';
const CEILING = 100_000_000_000;
const FIXTURE = {
  shrunk: { base: loop(750_000, working({ records: 3000 })), change: loop(750, working({ records: 3 })), limits: { instructions: CEILING } },
  steady: { base: loop(10_000, working({ records: 3000 })), change: loop(6_880, working({ records: 3000 })) },
  halved: { base: loop(8_000, working({ records: 3000 })), change: loop(1_000, working({ records: 3000 })) },
  meant: { base: loop(4_000, working({ records: 7000 })), change: loop(40, working({ records: 7 })) },
  stray: { base: loop(4_000, working({ records: 5000 })), change: loop(40, working({ records: 5 })) },
  'plain-a': { base: loop(2_000) },
  'plain-b': { base: loop(2_000, NO_WORK) },
  'unread-change': { base: loop(20_000, working({ records: 3000 })), change: loop(20_000, UNREADABLE) },
  'unread-base': { base: loop(20_000, UNREADABLE), change: loop(20_000, working({ records: 3000 })) },
};
const WITH_WORK = ['shrunk', 'steady', 'halved', 'meant', 'stray'];
const WITHOUT_WORK = ['plain-a', 'plain-b'];
const UNREAD = ['unread-change', 'unread-base'];
const MEANT_ITEM = approvalItem('meant', 'records', 7000, 7);
const STRAY_ITEM_NAMING_STEADY = approvalItem('steady', 'records', 5000, 5);
const READINGS = ['p50Ms', 'peakBytes', 'instructions'];

async function play(box) {
  const ids = Object.keys(FIXTURE);
  const scripts = (side) => Object.fromEntries(ids.filter((id) => FIXTURE[id][side]).map((id) => [scriptOf(id), FIXTURE[id][side]]));
  const repo = await marked(box, { 'benchmarks/budgets.json': manifest(ids.map((id) => task(id, FIXTURE[id].limits))), ...scripts('base') });
  const commit = repo.commit(scripts('change'), 'Do less in five benchmarks and garble two reports');
  repo.approve('do-less', commit, [MEANT_ITEM, STRAY_ITEM_NAMING_STEADY]);
  const run = await measured(box, repo, 25);
  return { commit, record: recordOf(box, run, commit, 'the measured commit') };
}
const scene = staged(after, play);

const said = (row) => JSON.stringify({ state: row.state, note: row.note ?? null }).slice(0, 1500);

test('AC1 #3537.ac8dfced a fixture task whose run reports work records 3000 on the merge base and records 3 on the change reads INCONCLUSIVE, naming records and both values, where its time and its instructions retired fell by 99%', within(30), async () => {
  const { commit, record } = await scene();
  const row = judgedRow(record, 'shrunk');
  const sides = sidesOf(row);
  assert.ok(sides, `the record of ${commit} doesn't hold both sides' p50 and instructions retired per round for shrunk, so its fall can't be read: ${JSON.stringify(row).slice(0, 1500)}`);
  const fell = `its p50 fell by ${percent(1 - sides.timeKept)}, from ${sides.base.p50Ms.toFixed(1)} to ${sides.change.p50Ms.toFixed(1)} ms, and its instructions retired by ${percent(1 - sides.instructionsKept)}`;
  assert.ok(sides.timeKept <= 0.01 && sides.instructionsKept <= 0.01, `INCONCLUSIVE (scene): shrunk's time and instructions retired didn't both fall by 99% in the window's own readings, so this run isn't the criterion's case: ${fell}`);
  const judges = `compare and judgeInstructions left ${row.note ? `"${row.note}"` : 'no miss'} in its note, and judgeCount read ${row.limits?.instructions?.status ?? 'nothing'} on its instructions ceiling of ${CEILING}`;
  assert.notEqual(row.state, 'PASS', `shrunk read PASS on ${commit}, judged as on the merge base (${judges}): its run reports work {"records":3000} on the merge base and {"records":3} on the change, where ${fell}`);
  assert.equal(row.state, 'INCONCLUSIVE', `shrunk read ${row.state} on ${commit}, not INCONCLUSIVE: its run reports work {"records":3000} on the merge base and {"records":3} on the change, where ${fell}: ${said(row)}`);
  for (const named of ['records', 3000, 3]) assert.ok(names(row.note, named), `shrunk's INCONCLUSIVE on ${commit} doesn't name ${named}, of the count records and its values 3000 on the merge base and 3 on the change: ${said(row)}`);
});

test('AC2 #3537.f37dbb33 the same task with equal work on both sides and instructions retired down by 30% reads PASS, and its window record holds the fall', within(30), async () => {
  const { commit, record } = await scene();
  const row = judgedRow(record, 'steady');
  const sides = sidesOf(row);
  assert.ok(sides, `the record of ${commit} doesn't hold steady's fall: its row holds no instructions retired per round for both sides: ${JSON.stringify(row).slice(0, 1500)}`);
  const fall = 1 - sides.instructionsKept;
  assert.ok(fall >= 0.25 && fall <= 0.35, `INCONCLUSIVE (scene): steady's instructions retired fell by ${percent(fall)} in the window's own readings, not by the criterion's 30%`);
  assert.equal(row.state, 'PASS', `steady read ${row.state} on ${commit}, not PASS: its work is equal on both sides, {"records":3000}, and its instructions retired fell by ${percent(fall)}, which is a gain: ${said(row)}`);
});

test('AC4 #3537.fb27f5b5 with an approved proposal that names the task and both values, the unlike comparison is judged, and an approval naming another task leaves it INCONCLUSIVE', within(30), async () => {
  const { commit, record } = await scene();
  const meant = judgedRow(record, 'meant');
  assert.equal(meant.state, 'PASS', `meant's unlike work, records 7000 on the merge base and 7 on the change, wasn't judged on ${commit}, which carries the approval "Approves: ${MEANT_ITEM}": it read ${meant.state}, where its fall is a gain: ${said(meant)}`);
  const stray = judgedRow(record, 'stray');
  const taken = `the window took an approval naming steady, "Approves: ${STRAY_ITEM_NAMING_STEADY}", for stray's unlike work, records 5000 on the merge base and 5 on the change, on ${commit}`;
  assert.equal(stray.state, 'INCONCLUSIVE', `${taken}: stray read ${stray.state}, not INCONCLUSIVE: ${said(stray)}`);
  for (const named of ['records', 5000, 5]) assert.ok(names(stray.note, named), `stray's INCONCLUSIVE on ${commit}, under an approval naming steady, doesn't name ${named}, of the count records and its values 5000 and 5: ${said(stray)}`);
});

test('AC5 #3537.b8c98e7f work that cannot be read on one side is missing, never equal, and the task reads INCONCLUSIVE', within(30), async () => {
  const { commit, record } = await scene();
  for (const [id, side, other] of [['unread-change', 'change', 'merge base'], ['unread-base', 'merge base', 'change']]) {
    const row = judgedRow(record, id);
    const unread = `its run reports ${UNREADABLE} on the ${side} side, a count that can't be read, and {"work":{"records":3000}} on the ${other} side`;
    assert.notEqual(row.state, 'PASS', `${id} read PASS on ${commit}: ${unread}, so the count missing on the ${side} side was taken as a match`);
    assert.equal(row.state, 'INCONCLUSIVE', `${id} read ${row.state} on ${commit}, not INCONCLUSIVE: ${unread}: ${said(row)}`);
    assert.ok(names(row.note, 'work') || names(row.note, 'records'), `${id}'s INCONCLUSIVE on ${commit} names neither work nor the count records, so it isn't for the work that can't be read on the ${side} side: ${said(row)}`);
  }
});

const spanOf = (reading) => {
  const values = (Array.isArray(reading) ? [...reading] : [reading]).sort((a, b) => a - b);
  return values.length && values.every((value) => Number.isFinite(value) && value > 0) ? { low: values[0], middle: values[Math.floor(values.length / 2)], high: values.at(-1), rounds: values.length } : null;
};
function fallOf(row, metric) {
  const base = spanOf(row.sides?.base?.[metric]), change = spanOf(row.sides?.change?.[metric]);
  if (!base || !change) return null;
  const kept = change.middle / base.middle;
  if (base.rounds > 1 && kept >= 0.4 && kept <= 0.6) return null;
  return { fell: kept < 0.5, base, change };
}
const inside = (value, span) => Number.isFinite(value) && value >= span.low && value <= span.high;
const spanSaid = ({ low, high }) => (low === high ? `${low}` : `${low} to ${high}`);

test('AC6 #3537.2e65de36 a window record lists each task with no work by name with their count, and each reading that fell by more than half with both values', within(30), async () => {
  const { commit, record } = await scene();
  for (const id of Object.keys(FIXTURE)) judgedRow(record, id);
  const none = record.noWork;
  assert.ok(Array.isArray(none?.tasks), `the record of ${commit} lists no task that reports no work: its noWork is ${JSON.stringify(none ?? null)}`);
  for (const id of WITHOUT_WORK) assert.ok(none.tasks.includes(id), `the record of ${commit} leaves out ${id}, a task whose run reports no work: ${JSON.stringify(none)}`);
  const wrongly = none.tasks.filter((id) => !WITHOUT_WORK.includes(id) && !UNREAD.includes(id));
  assert.deepEqual(wrongly, [], `the record of ${commit} lists ${wrongly.join(', ')} among the tasks that report no work; of the fixture's tasks ${WITH_WORK.join(', ')} report work on both sides: ${JSON.stringify(none)}`);
  assert.ok(none.count === none.tasks.length && new Set(none.tasks).size === none.tasks.length, `the record of ${commit} counts ${none.count} tasks with no work and names ${none.tasks.length}: ${JSON.stringify(none)}`);

  const falls = record.falls;
  assert.ok(Array.isArray(falls), `the record of ${commit} lists no reading that fell by more than half: its falls is ${JSON.stringify(falls ?? null)}`);
  const designed = { halved: fallOf(rowOf(record, 'halved'), 'instructions'), steady: fallOf(rowOf(record, 'steady'), 'instructions') };
  assert.ok(designed.halved?.fell === true && designed.steady?.fell === false, `INCONCLUSIVE (scene): the window's own readings don't show halved's instructions retired down by more than half and steady's by less: ${JSON.stringify(designed)}`);
  const problems = [];
  const judgedReadings = new Set();
  for (const row of record.tests) {
    for (const metric of READINGS) {
      const reading = fallOf(row, metric);
      if (!reading) continue;
      judgedReadings.add(`${row.id} ${metric}`);
      const listed = falls.filter((entry) => entry?.id === row.id && entry?.metric === metric);
      const values = `${spanSaid(reading.base)} on the merge base and ${spanSaid(reading.change)} on the change`;
      if (!reading.fell && listed.length) problems.push(`it lists ${row.id}'s ${metric}, which didn't fall by more than half: ${values}`);
      if (reading.fell && !listed.length) problems.push(`it leaves out ${row.id}'s ${metric}, which fell by more than half: ${values}`);
      if (reading.fell && listed.length > 1) problems.push(`it lists ${row.id}'s ${metric} ${listed.length} times`);
      if (reading.fell && listed.length === 1 && !(inside(listed[0].base, reading.base) && inside(listed[0].change, reading.change))) problems.push(`it lists ${row.id}'s ${metric} with ${listed[0].base} as its merge base's value and ${listed[0].change} as the change's, where the row holds ${values}`);
    }
  }
  for (const entry of falls) {
    if (judgedReadings.has(`${entry?.id} ${entry?.metric}`)) continue;
    if (!(Number.isFinite(entry?.base) && Number.isFinite(entry?.change) && entry.change < 0.5 * entry.base)) problems.push(`it lists ${JSON.stringify(entry)}, whose own two values show no fall by more than half`);
  }
  assert.deepEqual(problems, [], `the record of ${commit} doesn't list each reading that fell by more than half with both values:\n- ${problems.join('\n- ')}\nfalls: ${JSON.stringify(falls).slice(0, 2000)}`);
});
