// #1296 AC3: Claude Code's facts carry a context-output entry, and a facts file without it fails the adapter-facts
// conformance case, naming the field. The case runs as the preflight's corpus lane runs it, `node scripts/corpus.mjs
// check --facts <dir>`, on a folder of the shipped facts files whose claude-code.facts.json has the entry taken out.
// The entry's name is open: it is the key of adapters/claude-code.facts.json, at any depth, named like
// `contextOutput` (README, The surface under test).
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { AC3, CAP, PREVIEW } from './helpers.ts';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const NODE = process.execPath;
const SHIPPED = join(REPO, 'adapters/claude-code.facts.json');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const made: string[] = [];
afterAll(() => { for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true }); });

/** The path to the context-output entry: the first key named like contextOutput, depth first. */
function entryPath(value: Json, at: string[] = []): string[] | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  for (const key of Object.keys(value)) {
    if (/^context[-_ ]?outputs?$/i.test(key)) return [...at, key];
  }
  for (const [key, child] of Object.entries(value)) {
    const found = entryPath(child, [...at, key]);
    if (found) return found;
  }
  return undefined;
}
/** A folder holding the shipped facts files, its claude-code.facts.json as `facts`. */
function factsFolder(facts: Json): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'dh1296f-')));
  made.push(dir);
  for (const f of readdirSync(join(REPO, 'adapters')).filter((n) => n.endsWith('.facts.json'))) copyFileSync(join(REPO, 'adapters', f), join(dir, f));
  writeFileSync(join(dir, 'claude-code.facts.json'), `${JSON.stringify(facts, null, 2)}\n`);
  return dir;
}
/** The lane on `dir`: its exit, and each FAIL line with the Fix line under it. */
function check(dir: string): { code: number | null; fails: string[] } {
  const r = spawnSync(NODE, ['scripts/corpus.mjs', 'check', '--facts', dir], { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 600_000 });
  const lines = `${r.stdout}\n${r.stderr}`.split('\n');
  const fails = lines.map((l, i) => (l.startsWith('FAIL') ? `${l} ${lines[i + 1]?.trim().startsWith('Fix:') ? lines[i + 1]!.trim() : ''}` : '')).filter(Boolean);
  return { code: r.status, fails };
}

describe(`${AC3} a facts file without the context-output entry fails the adapter-facts conformance case, naming the field`, () => {
  const shipped = JSON.parse(readFileSync(SHIPPED, 'utf8')) as Json;
  const path = entryPath(shipped);

  it(`${AC3} adapters/claude-code.facts.json has a context-output entry (the 10,000-character cap, the 2,000-character preview, its versions, PostCompact among its events); taken out, node scripts/corpus.mjs check fails naming it`, () => {
    expect(path, 'adapters/claude-code.facts.json must have a context-output entry (a key named like contextOutput)').toBeDefined();
    const entry = path!.reduce((v: Json, k) => v[k], shipped);
    const text = JSON.stringify(entry);
    expect(text, `the entry holds the cap, ${CAP} characters`).toMatch(new RegExp(`(?<![0-9])${CAP}(?![0-9])`));
    expect(text, `the entry holds the preview length, ${PREVIEW} characters`).toMatch(new RegExp(`(?<![0-9])${PREVIEW}(?![0-9])`));
    expect(text, 'the entry names the versions it holds for').toMatch(/\d+\.\d+\.\d+/);
    expect(text, 'the entry says, per hook event, what reaches the model: PostCompact among them').toContain('PostCompact');
    const field = path!.at(-1)!;
    const planted = JSON.parse(JSON.stringify(shipped)) as Json;
    delete path!.slice(0, -1).reduce((v: Json, k) => v[k], planted)[field];
    const { code, fails } = check(factsFolder(planted));
    const naming = fails.filter((l) => l.includes(field) && /claude/i.test(l));
    expect(naming, `AC3 a FAIL line names the missing field ${field} of the Claude Code facts; the FAIL lines were: ${fails.join(' | ').slice(0, 3000) || 'none'}`).not.toEqual([]);
    expect(code, 'the check fails').not.toBe(0);
  }, 600_000);

  it(`${AC3} (control) the same check on the shipped facts has no FAIL line naming the entry`, () => {
    expect(path, 'adapters/claude-code.facts.json must have a context-output entry (a key named like contextOutput)').toBeDefined();
    const field = path!.at(-1)!;
    const { fails } = check(factsFolder(shipped));
    expect(fails.filter((l) => l.includes(field)), 'the case passes the shipped facts').toEqual([]);
  }, 600_000);
});
