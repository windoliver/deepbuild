// AC7's card and AC5, on one input: "every month, write the sales report from the attached file", with sales.csv. Its
// card shows a cost per run and per month from a dry run that made no project (AC7). Approved, its first run wakes the
// played model, which writes the report and leaves the script that does the whole job and its data check. A month on,
// the same columns with new numbers: the script runs with no model and the run passes its data check. A month after,
// a column renamed: the model wakes once (AC5).
import { expect, test } from 'vitest';
import { costOf, DATA_CHECK, DAY, fireLine, fixture, JOB_FILE, Job, MIN, monthly, named, runLine, shown, usd, type Card, type Ran, type Sent } from './helpers.ts';

/** What the dry run reports it cost, in dollars. */
const DRY_USD = 0.42;
/** A month on the hub's clock: 31 days, so any reading of "every month" has one slot in it. */
const MONTH = 31 * DAY;

/** The model's turn on a month's input: the report, the script that does the whole job with no model, and its data check. */
function month(csv: string, total: number, columns: string): Record<string, string> {
  return {
    'input.csv': csv,
    'report.md': `# Monthly report\n\nTotal: ${total}\n`,
    [JOB_FILE]: fixture('job.sh').replace('month,region,amount', columns),
    [DATA_CHECK]: fixture('data.sh'),
  };
}

interface Scene { j: Job; csv: string; sent: Sent; card: Card | undefined; pos: number; before: { made: number; folders: string[]; jobs: number } }
let shared: Promise<Scene> | undefined;
async function scene(): Promise<Scene> {
  const j = await Job.open();
  const csv = j.w.file('sales.csv', fixture('report-1.csv'));
  const m = monthly(csv);
  j.answers([{ match: 'sales report', answer: m.answer }]);
  j.work({ dry: [{ cost_usd: DRY_USD, files: { 'report.md': '# Monthly report (dry run)\n' } }], turns: [{ cost_usd: 0.3, files: month(fixture('report-1.csv'), 250, 'month,region,amount') }] });
  const { sent, card } = await j.ask(m.words, [csv]);
  const events = (await j.w.events()).filter((e) => e.log_pos > sent.since);
  return {
    j, csv, sent, card, pos: 0,
    before: { made: events.filter((e) => e.kind === 'workspace.created').length, folders: j.w.workspaceFolders(), jobs: events.filter((e) => e.kind === 'job.recorded').length },
  };
}

test(named(7), async () => {
  const s = await (shared ??= scene());
  expect(s.card, `the monthly report reaches its card (deep: ${s.sent.ran ? shown(s.sent.ran) : 'still running'})`).toBeDefined();
  const cost = costOf(s.card!);
  expect(typeof cost.run_usd, `the card's brief carries what one run may spend: ${JSON.stringify(cost)}`).toBe('number');
  expect(typeof cost.month_usd, `the card's brief carries what a month comes to: ${JSON.stringify(cost)}`).toBe('number');
  expect(cost.run_usd!, `what one run may spend comes from the dry run, which cost ${usd(DRY_USD)}`).toBeGreaterThanOrEqual(DRY_USD);
  expect(cost.month_usd!, 'a month of a monthly job comes to at least one run').toBeGreaterThanOrEqual(cost.run_usd!);
  const question = String(s.card!.created.data.question);
  expect(question, `the card shows the cost per run, ${usd(cost.run_usd!)}`).toContain(usd(cost.run_usd!));
  expect(question, `the card shows the cost per month, ${usd(cost.month_usd!)}`).toContain(usd(cost.month_usd!));
  expect(question, 'the card says which cost is a run\'s').toMatch(/\brun\b/i);
  expect(question, 'and which a month\'s').toMatch(/\bmonth\b/i);
  // From a dry run in the job's own folder, which makes no project.
  expect(s.before.jobs, 'a dry run ran before the card, beside the research job: two jobs on the runner').toBeGreaterThanOrEqual(2);
  expect(s.before.made, 'the dry run makes no project: no workspace.created before your yes').toBe(0);
  expect(s.before.folders, 'and no folder under ~/.deepbuild/workspaces').toEqual([]);
}, 30 * MIN);

test(named(5), async () => {
  const s = await (shared ??= scene());
  expect(s.card, 'the monthly report reaches its card').toBeDefined();
  const { j } = s;
  const key = String(s.card!.drafted.data.key);
  const { pos, ran } = await j.yes(s.card!);
  expect(ran.code, `your yes to ${s.card!.ask} is taken (${shown(ran as Ran)})`).toBe(0);
  const workspace = await j.workspace(pos);
  expect(workspace, 'your yes makes the report\'s workspace').toBeDefined();
  const first = await j.firstRun(key, pos);
  expect(first?.ended, 'your yes starts the job and its first run, with the model, ends').toBeDefined();
  expect(await j.file(workspace!.folder, JOB_FILE), `the first finished run left the script that does the whole job (${JOB_FILE})`).toBeDefined();

  // The second run: the same columns, new numbers.
  j.w.file('sales.csv', fixture('report-2.csv'));
  const second = await j.fire(2, key, MONTH);
  expect(second.runs.map(runLine), `${fireLine(second)}: a month on, the job runs once`).toHaveLength(1);
  expect(second.turns.map((e) => `${e.kind} ${JSON.stringify(e.data).slice(0, 200)}`), `${fireLine(second)}: the same columns with new numbers make no model turn`).toEqual([]);
  expect(second.runs[0]!.verdict, `${runLine(second.runs[0]!)}: it still passes its data check`).toBe('PASS');
  expect(await j.file(workspace!.folder, 'report.md'), 'the report is the new numbers\', made by the script with no model').toContain('Total: 285');

  // The third run: a column renamed.
  j.w.file('sales.csv', fixture('report-3.csv'));
  j.work({ dry: [{ cost_usd: DRY_USD }], turns: [{ cost_usd: 0.3, files: month(fixture('report-3.csv'), 310, 'month,area,amount') }] });
  const third = await j.fire(3, key, MONTH);
  expect(third.runs.map(runLine), `${fireLine(third)}: a month on, the job runs once`).toHaveLength(1);
  expect(third.turns.length, `${fireLine(third)}: with a column renamed, it wakes the model once`).toBe(1);
  expect(third.runs[0]!.noop, `${runLine(third.runs[0]!)}: the run that woke the model is no no-op`).toBe(false);
}, 60 * MIN);
