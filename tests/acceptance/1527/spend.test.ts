// AC7's last part: a monthly costs report with two tasks, so a run with the model takes two turns, one a task. Its
// dry run costs $0.30, and the played model's first real turn reports $5, past any line drawn from it: the run stops
// before its next model turn, with its spend recorded against it. Then, in the same world, a visits report whose turns
// cost $0.10 each takes both of its turns, so a program that stops every run after one turn fails too.
import { expect, test } from 'vitest';
import { costOf, fixture, Job, MIN, monthly, named, runLine, shown, turnsIn, type Ev, type Run } from './helpers.ts';

const DRY_USD = 0.3;
const PAST_USD = 5;
const UNDER_USD = 0.1;

/** A report's first run after your yes: the run, its model turns, and the spend recorded against it. */
async function firstRunOf(j: Job, topic: string, turnUsd: number): Promise<{ line?: number; run?: Run; turns: Ev[]; spent: Ev[] }> {
  const csv = j.w.file(`${topic}.csv`, fixture('report-1.csv'));
  const m = monthly(csv, { topic, tasks: [`Gather the ${topic} numbers`, `Write the ${topic} report`] });
  j.answers([{ match: `${topic} report`, answer: m.answer }]);
  j.work({ dry: [{ cost_usd: DRY_USD }], turns: [{ cost_usd: turnUsd, files: { [`${topic}.md`]: `# The ${topic}\n` } }] });
  const { sent, card } = await j.ask(m.words, [csv]);
  expect(card, `the ${topic} report reaches its card (deep: ${sent.ran ? shown(sent.ran) : 'still running'})`).toBeDefined();
  const line = costOf(card!).run_usd;
  const key = String(card!.drafted.data.key);
  const { pos, ran } = await j.yes(card!);
  expect(ran.code, `your yes to ${card!.ask} is taken (${shown(ran)})`).toBe(0);
  const run = await j.firstRun(key, pos);
  const events = (await j.w.events()).filter((e) => e.log_pos > pos);
  return {
    ...(line === undefined ? {} : { line }), ...(run ? { run } : {}),
    turns: turnsIn(events),
    spent: run ? events.filter((e) => e.kind === 'spend.charged' && e.data.run === run.run) : [],
  };
}
const spentOn = (spent: Ev[]): number => spent.reduce((n, e) => n + Number(e.data.usd ?? 0), 0);

test(named(7), async () => {
  const j = await Job.open();

  const past = await firstRunOf(j, 'costs', PAST_USD);
  expect(typeof past.line, 'the card says what one run may spend').toBe('number');
  expect(past.line!, `the per-run line, from a ${DRY_USD} dry run, is below the first turn's ${PAST_USD}`).toBeLessThan(PAST_USD);
  expect(past.run?.ended, 'your yes starts the job and its first run ends').toBeDefined();
  expect(past.turns.map((e) => `${e.kind} ${JSON.stringify(e.data).slice(0, 200)}`), `${runLine(past.run!)}: past its per-run line after one turn, it stops before its next model turn`).toHaveLength(1);
  expect(past.run!.verdict, `${runLine(past.run!)}: a run stopped at its line doesn't pass`).not.toBe('PASS');
  expect(past.run!.cause, `${runLine(past.run!)}: its end says it stopped at what a run may spend`).toMatch(/spen[dt]|cost|\$/i);
  expect(spentOn(past.spent), `${runLine(past.run!)}: its real spend is recorded against it (spend.charged naming the run)`).toBeGreaterThanOrEqual(PAST_USD);
  expect(spentOn(past.spent), 'and holds one turn\'s spend, not two').toBeLessThan(2 * PAST_USD);

  const under = await firstRunOf(j, 'visits', UNDER_USD);
  expect(under.run?.ended, 'the visits report\'s first run ends').toBeDefined();
  expect(under.line!, `its line is above two turns' ${2 * UNDER_USD}`).toBeGreaterThanOrEqual(2 * UNDER_USD);
  expect(under.turns.map((e) => `${e.kind} ${JSON.stringify(e.data).slice(0, 200)}`), `${runLine(under.run!)}: a run within its line takes its next model turn: one a task`).toHaveLength(2);
  expect(spentOn(under.spent), `${runLine(under.run!)}: its real spend is recorded against it`).toBeGreaterThanOrEqual(2 * UNDER_USD - 0.001);
}, 60 * MIN);
