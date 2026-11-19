// AC6: An English string edited after its translation was written marks that key stale, and the release check fails,
// naming the key, until it is translated again or confirmed.
//
// The release check is `node scripts/app-copy-lint.mjs --release`, a lane the release preflight runs (scripts/lanes.mjs
// `releaseLanes`; README, Surface 7). Each run is over a copy of the checkout's source under /tmp (#1458's way), the
// checkout never changed. The key is the one whose English is "Set up" (a literal the issue names); in a copy its English
// is edited to "Set it up". A translation records the SHA-256 of the English it was written from (README, Surface 3), so
// confirming it records the new English's hash beside the same words, and translating it again writes new words with it.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { cleanup, COPY, fails, ID, keysOf, lanes, LINT, lint, MIN, runs, shown, sourceCopy, sourceHash, tables } from './helpers.ts';

afterAll(cleanup, 60_000);
const EDITED = 'Set it up';
function edit(root: string, file: string, change: (table: Record<string, unknown>) => void): void {
  const path = join(root, COPY, file);
  const table = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  change(table);
  writeFileSync(path, `${JSON.stringify(table, null, 2)}\n`);
}

it(`AC6 ${ID.stale}: an English string edited after its translation was written marks that key stale and fails the release check, naming the key, until it is translated again or confirmed`, async () => {
  const { releaseLanes } = await lanes();
  expect(runs(releaseLanes, [LINT, '--release']), `the release preflight runs node ${LINT} --release`).toBe(true);
  const clean = await lint(sourceCopy(), true);
  expect(clean.code === 0 && fails(clean).length === 0, `the release check passes the checkout's tables: ${shown(clean)}`).toBe(true);
  const t = tables();
  if (typeof t === 'string') expect.fail(t);
  const key = keysOf(t, 'Set up').find((k) => typeof t.en[k] === 'string');
  expect(key, 'the English table has a key whose English is "Set up"').toBeDefined();
  const was = t.zh[key!];
  expect(typeof was?.text, `the zh-Hans table translates ${key} as a string`).toBe('string');
  /** A copy whose English for the key reads EDITED, and, when given, whose zh-Hans entry for it is `zh`. */
  const edited = (zh?: { text: string; source: string }): string => {
    const root = sourceCopy();
    edit(root, 'en.json', (en) => { en[key!] = EDITED; });
    if (zh) edit(root, 'zh-Hans.json', (table) => { table[key!] = zh; });
    return root;
  };
  const stale = await lint(edited(), true);
  expect(stale.code, `the release check fails once the English of ${key} changed: ${shown(stale)}`).toBe(1);
  expect(fails(stale).filter((l) => l.includes(key!) && /stale/i.test(l)), `a FAIL line names ${key} as stale: ${shown(stale)}`).not.toEqual([]);
  const confirmed = await lint(edited({ text: was!.text as string, source: sourceHash(EDITED) }), true);
  expect(confirmed.code === 0 && fails(confirmed).length === 0, `confirmed (its words kept, the new English's hash recorded), the release check passes: ${shown(confirmed)}`).toBe(true);
  const again = await lint(edited({ text: '开始设置', source: sourceHash(EDITED) }), true);
  expect(again.code === 0 && fails(again).length === 0, `translated again, the release check passes: ${shown(again)}`).toBe(true);
}, 30 * MIN);
