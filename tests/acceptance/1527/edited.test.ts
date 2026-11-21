// AC4: the hourly team-feed watcher's first run, a session of the played model in the job's workspace, rewrites the
// approved wake test into one that always says new. That edit changes nothing: the next fire is BLOCKED on the wake
// test's digest, naming its file, and runs neither the edited test nor the model.
import { expect, test } from 'vitest';
import { fireLine, fixture, HOUR, hourly, Job, MIN, named, runLine, shown, WAKE_FILE } from './helpers.ts';

test(named(4), async () => {
  const j = await Job.open({ feed: fixture('feed-two.json') });
  const { words, answer } = hourly(j.feed!.url);
  j.answers([{ match: 'team feed', answer }]);
  // The session's turn writes its notes, and an edited wake test over the approved one.
  j.work({ dry: [{ cost_usd: 0.05 }], turns: [{ cost_usd: 0.05, files: { 'news.md': '# New in the team feed\n\n- Friday lunch is at noon\n', [WAKE_FILE]: fixture('wake-edited.sh') } }] });

  const { sent, card } = await j.ask(words);
  expect(card, `the hourly job with its wake test reaches its card (deep: ${sent.ran ? shown(sent.ran) : 'still running'})`).toBeDefined();
  const key = String(card!.drafted.data.key);
  const { pos, ran } = await j.yes(card!);
  expect(ran.code, `your yes to ${card!.ask} is taken (${shown(ran)})`).toBe(0);
  const workspace = await j.workspace(pos);
  expect(workspace, 'your yes makes the job\'s workspace').toBeDefined();
  const first = await j.firstRun(key, pos);
  expect(first?.ended, 'your yes starts the job and its first run, the session that edits the wake test, ends').toBeDefined();
  const onDisk = await j.file(workspace!.folder, WAKE_FILE);

  const f = await j.fire(1, key, HOUR);
  expect(f.runs.map(runLine), `${fireLine(f)}: the next fire makes a run (the wake test on disk: ${JSON.stringify(onDisk ?? null)})`).toHaveLength(1);
  const r = f.runs[0]!;
  expect(r.verdict, `${runLine(r)}: the next fire is BLOCKED`).toBe('BLOCKED');
  expect(r.cause, `${runLine(r)}: BLOCKED on the wake test's digest`).toMatch(/digest/i);
  expect(r.cause, `${runLine(r)}: naming the file`).toContain(WAKE_FILE);
  expect(f.turns.map((e) => `${e.kind} ${JSON.stringify(e.data).slice(0, 200)}`), `${fireLine(f)}: the edit changes nothing: the edited test, which says new, wakes no model`).toEqual([]);
}, 60 * MIN);
