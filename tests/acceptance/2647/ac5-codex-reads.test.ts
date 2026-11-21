// #2647 AC5 #2647.799c3768: one `modified` call opens codex-hooks.json and hooks.json once each, and returns what it
// returns on the merge base for an untouched file, an edited entry and a removed entry.
//
// The hub's own Codex settings (packages/hub/src/codex-settings.ts): `recordEntries` writes what setup records in the
// hub's root (<root>/codex-hooks.json, naming the Codex home), `withEntries` gives Codex's hooks.json DeepBuild's twelve
// entries, and `modified` compares the two, as hub.health() and `deep doctor` read it. Every file open of the process
// is counted while one `modified` call runs (opens.ts wraps node:fs's opening reads). The returned list must equal
// what the merge base's `modified` returns (reference-modified.ts, its copy) for the same files.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { modified, recordEntries, withEntries } from '../../../packages/hub/src/codex-settings.ts';
import { countOpens } from './opens.ts';
import { modifiedOnBase } from './reference-modified.ts';
import { removeTemp, tempDir } from './asks.ts';

const AC5 = '#2647.799c3768';

const saved = process.env.CODEX_HOME;
afterEach(() => {
  if (saved === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = saved;
  removeTemp();
});

type Hooks = { hooks: Record<string, { hooks: Record<string, unknown>[] }[]> };
/** A hub root and a Codex home with setup's record and Codex's hooks.json holding DeepBuild's twelve entries, changed by `edit`. */
function setUp(edit: (hooks: Hooks) => void): { root: string; record: string; file: string } {
  const dir = tempDir();
  const root = join(dir, 'deepbuild');
  const home = join(dir, 'codex');
  mkdirSync(root, { recursive: true });
  mkdirSync(home, { recursive: true });
  process.env.CODEX_HOME = home;
  const hook = join(root, 'bin', 'deep-hook');
  recordEntries(root, hook, { command: '/usr/local/bin/deep', args: ['mcp'] });
  const hooks = JSON.parse(withEntries('', hook)) as Hooks;
  if (Object.keys(hooks.hooks).length !== 12) throw Error(`BLOCKED: setup's entries are ${Object.keys(hooks.hooks).length} events, not twelve`);
  edit(hooks);
  const file = join(home, 'hooks.json');
  writeFileSync(file, `${JSON.stringify(hooks, null, 2)}\n`);
  // A different home in this process's environment: modified reads the one setup recorded.
  process.env.CODEX_HOME = join(dir, 'elsewhere');
  return { root, record: join(root, 'codex-hooks.json'), file };
}

const CASES: { name: string; edit: (h: Hooks) => void; empty: boolean }[] = [
  { name: 'an untouched file', edit: () => undefined, empty: true },
  { name: 'an edited entry (the Stop timeout changed)', edit: (h) => { h.hooks.Stop![0]!.hooks[0]!.timeout = 30; }, empty: false },
  { name: 'a removed entry (PreCompact gone)', edit: (h) => { delete h.hooks.PreCompact; }, empty: false },
];

describe(`${AC5} one modified call opens codex-hooks.json and hooks.json once each, and returns what the merge base returns for an untouched file, an edited entry and a removed entry`, () => {
  for (const c of CASES) {
    it(`${AC5} ${c.name}: one open of each file, and the merge base's list`, () => {
      const { root, record, file } = setUp(c.edit);
      const expected = modifiedOnBase(root);
      if ((expected.length === 0) !== c.empty) throw Error(`BLOCKED: the merge base's modified reads ${c.name} as ${JSON.stringify(expected)}`);
      const { value, opens } = countOpens([record, file], () => modified(root));
      expect(value, `modified must return what the merge base returns for ${c.name}`).toEqual(expected);
      const counts = { 'codex-hooks.json': opens.get(record) ?? 0, 'hooks.json': opens.get(file) ?? 0 };
      expect(counts, `one modified call for ${c.name} opened codex-hooks.json ${counts['codex-hooks.json']} times and hooks.json ${counts['hooks.json']} times, where once each would do`).toEqual({ 'codex-hooks.json': 1, 'hooks.json': 1 });
    }, 30_000);
  }
});
