// AC6 #1463.cc5d1e3f: `992/agree` still holds, and every word comes from `states::TABLE`. The first is #992's suite file,
// run as it is, in a process of its own; the second reads every reader over the fixture: each row's word in `deep status
// --json`, `deep inbox --json` and the app's list is a word of states::TABLE (read from its source) with its entry, each
// row's line in `deep` and `deep status` holds that word, and no reader prints a word that goes (`gone quiet`, `2 need you`).
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { appList, cleanup, deep, ID, jsonRows, MAIN, makeWorld, NOON, REPO, retiredFailures, shown, stateTable, tableFailures, textRowFailures } from './helpers.ts';

afterAll(cleanup, 60_000);

describe(ID.words, () => {
  test(`${ID.words}: 992/agree still holds`, async () => {
    const out = await new Promise<{ code: number | null; text: string }>((resolve) => {
      const child = spawn(process.execPath, [join(REPO, 'node_modules/vitest/vitest.mjs'), 'run', '--root', 'tests/acceptance/992', '--no-file-parallelism', 'agree.test.ts'], { cwd: REPO, env: { ...process.env, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
      let text = '';
      child.stdout.setEncoding('utf8').on('data', (d: string) => (text += d));
      child.stderr.setEncoding('utf8').on('data', (d: string) => (text += d));
      const timer = setTimeout(() => child.kill('SIGKILL'), 2_700_000);
      child.on('close', (code) => { clearTimeout(timer); resolve({ code, text }); });
    });
    const summary = /Tests\s+([^\n]+)/.exec(out.text)?.[1] ?? 'no summary';
    console.log(`tests/acceptance/992 agree.test.ts: exit ${out.code}, ${summary}`);
    expect(out.code === 0 && /\b1 passed\b/.test(summary) && !/failed/.test(summary), `tests/acceptance/992's agree.test.ts must pass as it is: exit ${out.code}, ${summary}\n${out.text.slice(-4000)}`).toBe(true);
  }, 2_800_000);

  test(`${ID.words}: every word comes from states::TABLE`, async () => {
    const table = stateTable();
    const w = await makeWorld(MAIN, { clock: NOON });
    const texts: [string, string][] = [];
    for (const args of [[], ['status'], ['inbox']]) {
      const r = await deep(w, args);
      const who = `deep${args.length ? ` ${args[0]}` : ''}`;
      expect(r.code, `${who} exits 0: ${shown(r)}`).toBe(0);
      texts.push([who, r.stdout]);
    }
    const words = `states::TABLE has ${table.map((t) => `"${t.word}"`).join(', ')}`;
    expect(texts.flatMap(([who, text]) => retiredFailures(text, table, who)), `the words that go, in each reader's text; ${words}`).toEqual([]);
    const status = await jsonRows(w, 'status');
    const inbox = await jsonRows(w, 'inbox');
    const app = await appList(w);
    expect(app.rows, "deep_drive's see answers the list's rows (README, Pinned 5)").toBeInstanceOf(Array);
    expect([
      ...tableFailures(status.rows, table, 'deep status --json'),
      ...tableFailures(inbox.rows, table, 'deep inbox --json'),
      ...tableFailures(app.rows!, table, "the app's list"),
      ...texts.filter(([who]) => who !== 'deep inbox').flatMap(([who, text]) => textRowFailures(text, status.rows, who)),
    ], `each row's word; ${words}`).toEqual([]);
  }, 900_000);
});
