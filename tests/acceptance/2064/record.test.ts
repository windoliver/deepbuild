// #2064: an error inside the rule refuses the call, naming the error (AC6); a pull request a joined command opened is
// recorded as the session's by asking the forge for the branch's pull request, never from the command's output (AC7).
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { AC6, AC7, BRANCH, cleaning, room, sleep, typedTurn, until } from './helpers.ts';
import { completedCall, hook, newSession, type Obj } from '../1881/helpers.ts';

cleaning();

it(`${AC6} with the record's read of the issue's task failing inside the rule, gh pr create saying Closes #7 is denied naming the error`, async () => {
  const r = await room();
  // The planted error: the table the rule reads the session's tasks from is gone, so its read throws "no such table".
  const db = new DatabaseSync(join(r.hub.root, 'ledger.db'));
  for (let tries = 0; ; tries++) {
    try { db.exec('ALTER TABLE tasks RENAME TO tasks_gone'); break; } catch (error) { if (tries > 50) throw error; await sleep(100); }
  }
  db.close();
  const command = 'gh pr create --title t --body "Closes #7"';
  const got = await r.call(command);
  expect(got.denied, `\`${command}\` ran though the rule's own read threw; an error inside the rule must refuse the call`).toBe(true);
  expect(got.words, `\`${command}\` was denied without naming the error ("no such table")`).toMatch(/no such table/i);
}, 240_000);

it(`${AC7} against a stand-in forge, the pull request a joined git push && gh pr create opened is recorded as the session's, with its link, though the command's output holds none`, async () => {
  const r = await room();
  const s = newSession(r.hub, r.w.repo);
  await hook(r.hub, s, 'SessionStart', { source: 'startup' }, Date.now() - 2000);
  await typedTurn(r.hub, s, 'Open the pull request for this branch.');
  const command = 'git push -u origin b && gh pr create --title t --body "Part of #7"';
  const url = `https://github.com/acme/shop/pull/1`;
  // What the joined command does on the forge: the push, then `gh pr create`'s POST. Its output carries a link to nothing the forge holds.
  const { ghPrCreate } = await import('../1881/helpers.ts');
  expect(await ghPrCreate(r.forge, command, BRANCH)).toBe(url);
  const decoy = 'https://github.com/elsewhere/decoy/pull/99';
  const out: Obj = { stdout: `branch '${BRANCH}' set up to track 'origin/${BRANCH}'.\n${decoy}\n`, stderr: '', interrupted: false, isImage: false };
  await completedCall(r.hub, s, 'Bash', { command }, out);
  const read = async () => (await until(r.hub, (all) => all.some((e) => e.kind === 'session.reading' && e.session === s.id && String(e.data.reading).includes(url)), 20_000))
    .filter((e) => e.kind === 'session.reading' && e.session === s.id).map((e) => String(e.data.reading));
  const readings = await read();
  expect(readings.some((x) => x.includes(url)), `\`${command}\` opened ${url} on the forge but no reading of the session records it: ${JSON.stringify(readings)}`).toBe(true);
  expect(readings.some((x) => x.includes('decoy')), `a link in the command's output is not the session's pull request: ${JSON.stringify(readings)}`).toBe(false);
  expect(r.forge.requests.some((q) => q.method === 'GET' && q.path.startsWith('/repos/acme/shop/pulls')), `the hub must ask the forge for the branch's pull request: ${r.forge.requests.map((q) => `${q.method} ${q.path}`).join(', ') || 'no request'}`).toBe(true);
}, 240_000);
