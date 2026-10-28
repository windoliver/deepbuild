// AC14 #19.87dafab9 Setup edits Claude Code's user settings by the same strict rules as Codex's `hooks.json`: a
// `~/.claude/settings.json` with a duplicate key is left byte-for-byte as it was, a copy is kept, and setup names
// the key; a setup that loads the file with a parser that keeps the last duplicate and writes it back passes the
// undo test and fails this one.
//
// Two files: one with a duplicate key at the top (`cleanupPeriodDays`), one with a duplicate inside an object
// (`env.MY_TOOL_HOME`), each a key no message would name by chance. "A copy is kept" is a file anywhere under your
// home, other than the settings file, holding exactly its bytes. A setup that installed nothing can't say it
// succeeded (invariant 2), so it exits non-zero.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, copiesOf, firstDifference, makeHome, onMac, runSetup, settingsFile, shown } from './helpers.ts';
import { setupThenUndo } from './scenarios.ts';

afterAll(cleanup, 60_000);

const PLANT = 'setup-last-duplicate-wins';
const TOP = `{
  "model": "opus",
  "cleanupPeriodDays": 30,
  "hooks": {
    "Stop": [ { "hooks": [ { "type": "command", "command": "/bin/echo my-stop" } ] } ]
  },
  "cleanupPeriodDays": 90
}
`;
const NESTED = `{
  "env": {
    "MY_TOOL_HOME": "/opt/mine",
    "MY_FLAG": "1",
    "MY_TOOL_HOME": "/opt/mine-2"
  },
  "permissions": { "allow": ["Bash(npm test:*)"] }
}
`;

async function strict(text: string, key: string, env: Record<string, string | undefined> = {}): Promise<void> {
  onMac();
  const { home } = makeHome();
  const file = settingsFile(home);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  const was = Buffer.from(text);
  const ran = await runSetup(home, { env });
  const now = readFileSync(file);
  if (!now.equals(was)) {
    expect.fail(`AC14 deep setup must leave ${file}, which repeats the key "${key}", byte-for-byte as it was: ${firstDifference(was, now)}; ${shown(ran)}`);
  }
  const copies = copiesOf(home, was, file);
  expect(copies.length, `AC14 deep setup must keep a copy of ${file}, which it couldn't parse strictly, somewhere under ${home}`).toBeGreaterThan(0);
  expect(`${ran.stdout}\n${ran.stderr}`, `AC14 deep setup must name the duplicate key "${key}" in ${file}: ${shown(ran)}`).toContain(key);
  expect(ran.code, `AC14 deep setup installed nothing into ${file}, so it must not exit 0: ${shown(ran)}`).not.toBe(0);
}

describe('AC14 #19.87dafab9 Setup edits Claude Code\'s user settings by the same strict rules as Codex\'s `hooks.json`: a `~/.claude/settings.json` with a duplicate key is left byte-for-byte as it was, a copy is kept, and setup names the key; a setup that loads the file with a parser that keeps the last duplicate and writes it back passes the undo test and fails this one', () => {
  it('AC14 #19.87dafab9 a top-level duplicate key (cleanupPeriodDays): the file is left byte-for-byte, a copy is kept and setup names the key', async () => {
    await strict(TOP, 'cleanupPeriodDays');
  }, 600_000);

  it('AC14 #19.87dafab9 a duplicate key inside an object (env.MY_TOOL_HOME): the file is left byte-for-byte, a copy is kept and setup names the key', async () => {
    await strict(NESTED, 'MY_TOOL_HOME');
  }, 600_000);

  it(`AC14 #19.87dafab9 (wrong program) a setup whose parser keeps the last duplicate and writes the file back (${PLANT}) passes the undo test and fails this one, naming the file`, async () => {
    await setupThenUndo({ DEEP_HUB_PLANT: PLANT });
    let failure = '';
    try { await strict(TOP, 'cleanupPeriodDays', { DEEP_HUB_PLANT: PLANT }); } catch (error) { failure = (error as Error).message; }
    expect(failure, `the strict-edit check must fail on ${PLANT}`).toMatch(/^AC14 deep setup must leave \S*\/\.claude\/settings\.json, which repeats the key "cleanupPeriodDays", byte-for-byte as it was: /);
  }, 900_000);
});
