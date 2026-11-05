// #1033 AC4: the Claude Code facts carry a `mods` entry, and the adapter-facts conformance case holds them to it. The
// case runs where the facts files are held as a folder, the preflight's corpus lane (`node scripts/corpus.mjs check
// --facts <dir>`, as #997's loop-facts case runs): given a folder whose claude-code.facts.json has no `mods`, it must
// fail with a line naming the field. The entry's shape is README's (The facts entry).
import { spawnSync } from 'node:child_process';
import { copyFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { tempDir } from '../29/h-d.ts';
import { AC4, cleanup, NODE, REPO, type Line } from './helpers.ts';

afterAll(cleanup, 60_000);

const SHIPPED = join(REPO, 'adapters/claude-code.facts.json');
/** A folder holding the shipped facts files, its claude-code.facts.json as `facts` gives it. */
function factsFolder(facts: unknown): string {
  const dir = tempDir();
  for (const f of readdirSync(join(REPO, 'adapters')).filter((n) => n.endsWith('.facts.json'))) copyFileSync(join(REPO, 'adapters', f), join(dir, f));
  writeFileSync(join(dir, 'claude-code.facts.json'), `${JSON.stringify(facts, null, 2)}\n`);
  return dir;
}
/** The lane's run on `facts`: its exit and each FAIL line with its Fix line. */
function check(facts: string): { code: number | null; fails: string[] } {
  const r = spawnSync(NODE, ['scripts/corpus.mjs', 'check', '--facts', facts], { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 600_000 });
  const fails = r.stdout.split('\n').map((l, i, all) => (l.startsWith('FAIL') ? `${l} ${all[i + 1]?.trim().startsWith('Fix:') ? all[i + 1]!.trim() : ''}` : '')).filter(Boolean);
  return { code: r.status, fails };
}
const namesMods = (line: string): boolean => /\bmods\b/.test(line) && /claude/i.test(line);

describe(`${AC4} a Claude Code facts file without the mods entry fails the adapter-facts conformance case, naming the field; the entry's versions are the docs'`, () => {
  const shipped = JSON.parse(readFileSync(SHIPPED, 'utf8')) as Line;

  it(`${AC4} adapters/claude-code.facts.json has a mods entry: first loaded in 2.1.287 in the terminal and 2.1.286 in the desktop app, tool.check past PreToolUse, and when that can't happen`, () => {
    const mods = shipped.mods as Line | undefined;
    expect(mods, 'adapters/claude-code.facts.json must have a mods entry').toBeTypeOf('object');
    expect(mods!.since, 'mods.since: the first version that loads mods, per surface').toEqual({ terminal: '2.1.287', desktop: '2.1.286' });
    expect(typeof mods!.readBy === 'string' && mods!.readBy.length > 0, 'mods names the core rule that reads it (readBy)').toBe(true);
    expect(typeof mods!.conformance === 'string' && mods!.conformance.length > 0, 'mods names its conformance case').toBe(true);
    expect(mods!.overrides, 'mods.overrides: the event that can approve a call past a PreToolUse deny').toEqual({ event: 'tool.check', past: 'PreToolUse' });
    const when = Array.isArray(mods!.holdsWhen) ? (mods!.holdsWhen as Line[]).map((h) => JSON.stringify(h)) : [];
    expect(when.length, `mods.holdsWhen lists the four cases where the deny holds: ${JSON.stringify(mods!.holdsWhen)}`).toBe(4);
    for (const [what, test] of [
      ['managed settings on the machine', (t: string) => /managed settings/i.test(t)],
      ['a Team or Enterprise login as the session\'s credential', (t: string) => /team/i.test(t) && /enterprise/i.test(t)],
      ['plan mode, for a call that isn\'t read-only', (t: string) => /plan mode/i.test(t) && /read-only/i.test(t)],
      ['AskUserQuestion or a tool that needs your interaction, from 2.1.292', (t: string) => t.includes('AskUserQuestion') && t.includes('2.1.292')],
    ] as const) expect(when.some(test), `mods.holdsWhen names ${what}: ${JSON.stringify(mods!.holdsWhen)}`).toBe(true);
  });

  it(`${AC4} node scripts/corpus.mjs check, given claude-code.facts.json without mods, fails the adapter-facts conformance case, naming the field`, () => {
    const planted = { ...shipped };
    delete planted.mods;
    const { code, fails } = check(factsFolder(planted));
    expect(code, 'the check fails').not.toBe(0);
    expect(fails.filter(namesMods), `a FAIL line names the missing field, mods, of the Claude Code facts; the FAIL lines were: ${fails.join(' | ').slice(0, 3000) || 'none'}`).not.toEqual([]);
  }, 600_000);

  it(`${AC4} (control) the same check with the shipped facts has no FAIL line naming mods`, () => {
    const { fails } = check(factsFolder(shipped));
    expect(fails.filter(namesMods), 'the case passes the shipped facts').toEqual([]);
  }, 600_000);
});
