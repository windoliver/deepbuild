// #1527's review, regressions the blind suite misses: a repeat job's model turn writes the git config of the copy it
// works in, asking git to run a command of its own whenever it reads that copy's files. The hub's own git, which runs
// with no sandbox, must never read that config, so the command never runs. Uses the blind suite's played claude.
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { DATA_CHECK, fixture, Job, JOB_FILE, MIN, monthly, runLine, shown } from '../../acceptance/1527/helpers.ts';

test('a run\'s own git config never runs in the hub', async () => {
  const marker = join(mkdtempSync(join(tmpdir(), 'deep-1527-')), 'ran');
  const j = await Job.open();
  const csv = j.w.file('sales.csv', fixture('report-1.csv'));
  const m = monthly(csv);
  j.answers([{ match: 'sales report', answer: m.answer }]);
  j.work({
    dry: [{ cost_usd: 0.05 }],
    turns: [{
      cost_usd: 0.05,
      files: {
        // What its data check reads, so the run passes and the hub commits what it made.
        'input.csv': fixture('report-1.csv'),
        'report.md': '# Monthly report\n\nTotal: 250\n',
        [JOB_FILE]: fixture('job.sh'),
        [DATA_CHECK]: fixture('data.sh'),
        '.git/config': `[core]\n\trepositoryformatversion = 0\n\tbare = false\n\tfsmonitor = touch ${marker}; false\n`,
      },
    }],
  });
  const { sent, card } = await j.ask(m.words, [csv]);
  expect(card, `the monthly report reaches its card (deep: ${sent.ran ? shown(sent.ran) : 'still running'})`).toBeDefined();
  const { pos, ran } = await j.yes(card!);
  expect(ran.code, `your yes is taken (${shown(ran)})`).toBe(0);
  const run = await j.firstRun(String(card!.drafted.data.key), pos);
  expect(run?.ended, 'its first run, the turn that writes the git config, ends').toBeDefined();
  expect(existsSync(marker), `${runLine(run!)}: the command in the run's git config ran in the hub`).toBe(false);
  // It passes its data check, so only the git folder it left keeps it from landing.
  expect(run!.verdict, `${runLine(run!)}: a run that leaves a git folder of its own FAILs`).toBe('FAIL');
  expect(run!.cause, `${runLine(run!)}: naming it`).toMatch(/\.git\b/);
}, 30 * MIN);

// `.GIT` too: a Mac's disk reads it as `.git`, and so does git.
test.each(['sub/.git', 'sub/.GIT'])('a run that leaves a git folder of its own, %s, lands nothing', async (repo) => {
  const marker = join(mkdtempSync(join(tmpdir(), 'deep-1527-')), 'ran');
  const j = await Job.open();
  const csv = j.w.file('sales.csv', fixture('report-1.csv'));
  const m = monthly(csv);
  j.answers([{ match: 'sales report', answer: m.answer }]);
  // A repo in the copy: once landed and checked out, the hub's git would read its config whenever it reads the copy.
  j.work({
    dry: [{ cost_usd: 0.05 }],
    turns: [{
      cost_usd: 0.05,
      files: {
        'input.csv': fixture('report-1.csv'),
        'report.md': '# Monthly report\n\nTotal: 250\n',
        [DATA_CHECK]: fixture('data.sh'),
        [`${repo}/HEAD`]: 'ref: refs/heads/main\n',
        [`${repo}/config`]: `[core]\n\trepositoryformatversion = 0\n\tbare = false\n\tfsmonitor = touch ${marker}; false\n`,
        [`${repo}/objects/.keep`]: '',
        [`${repo}/refs/heads/.keep`]: '',
      },
    }],
  });
  const { sent, card } = await j.ask(m.words, [csv]);
  expect(card, `the monthly report reaches its card (deep: ${sent.ran ? shown(sent.ran) : 'still running'})`).toBeDefined();
  const { pos, ran } = await j.yes(card!);
  expect(ran.code, `your yes is taken (${shown(ran)})`).toBe(0);
  const workspace = await j.workspace(pos);
  const run = await j.firstRun(String(card!.drafted.data.key), pos);
  expect(run?.ended, 'its first run ends').toBeDefined();
  expect(run!.verdict, `${runLine(run!)}: a run that leaves a git folder of its own FAILs`).toBe('FAIL');
  expect(run!.cause, `${runLine(run!)}: naming it`).toContain(repo);
  expect(existsSync(join(workspace!.folder, 'report.md')), `${runLine(run!)}: nothing of it lands in the workspace`).toBe(false);
  expect(existsSync(marker), `${runLine(run!)}: the command in its git config ran in the hub`).toBe(false);
}, 30 * MIN);
