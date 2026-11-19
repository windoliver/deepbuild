// #1514 AC5: each agent's facts carry a rule-load entry, and a facts file without it fails the adapter-facts conformance
// case, naming the field. The case runs as the preflight's corpus lane runs it, `node scripts/corpus.mjs check --facts
// <dir>` (as #1033's and #1296's suites run it), on a folder of the shipped facts files with one agent's entry taken out:
// Codex's, then Claude Code's. The entry is the key of the agent's facts named like `ruleLoad` (README: chosen).
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AC5, CLAUDE, CODEX, REPO, entryPath, type Json } from './helpers.ts';

const made: string[] = [];
afterAll(() => { for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true }); });

const AGENTS = [{ file: 'codex.facts.json', agent: CODEX, name: 'Codex' }, { file: 'claude-code.facts.json', agent: CLAUDE, name: 'Claude Code' }] as const;
const shipped = (file: string): Json => JSON.parse(readFileSync(join(REPO, 'adapters', file), 'utf8')) as Json;

/** A folder of the shipped facts files, one of them replaced by `facts`. */
function factsFolder(file?: string, facts?: Json): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'dh1514f-')));
  made.push(dir);
  for (const f of readdirSync(join(REPO, 'adapters')).filter((n) => n.endsWith('.facts.json'))) copyFileSync(join(REPO, 'adapters', f), join(dir, f));
  if (file) writeFileSync(join(dir, file), `${JSON.stringify(facts, null, 2)}\n`);
  return dir;
}
/** The lane on `dir`: its exit, and each FAIL line with the Fix line under it. */
function check(dir: string): { code: number | null; fails: string[] } {
  const r = spawnSync(process.execPath, ['scripts/corpus.mjs', 'check', '--facts', dir], { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 600_000 });
  const lines = `${r.stdout}\n${r.stderr}`.split('\n');
  const fails = lines.map((l, i) => (l.startsWith('FAIL') ? `${l} ${lines[i + 1]?.trim().startsWith('Fix:') ? lines[i + 1]!.trim() : ''}` : '')).filter(Boolean);
  return { code: r.status, fails };
}
/** The entry's key in an agent's shipped facts, or the chosen name where they have none. */
const keyOf = (facts: Json): string => entryPath(facts)?.at(-1) ?? 'ruleLoad';
/** The agent's shipped facts with the rule-load entry taken out. */
function without(facts: Json): Json {
  const copy = JSON.parse(JSON.stringify(facts)) as Json;
  const path = entryPath(copy);
  if (path) delete path.slice(0, -1).reduce((v: Json, k) => v[k], copy)[path.at(-1)!];
  return copy;
}

describe(`${AC5} a facts file without the rule-load entry fails the adapter-facts conformance case, naming the field`, () => {
  it(`${AC5} codex.facts.json, then claude-code.facts.json, without the rule-load entry: node scripts/corpus.mjs check fails with a line naming the field and the agent; the shipped facts carry the entry and the same check names no such field`, () => {
    for (const { file, agent, name } of AGENTS) {
      const facts = shipped(file);
      const field = keyOf(facts);
      const { code, fails } = check(factsFolder(file, without(facts)));
      const naming = fails.filter((l) => l.includes(field) && agent.test(l));
      expect(naming, `AC5 with ${file} lacking its rule-load entry, a FAIL line names the field ${field} and ${name}; the FAIL lines were: ${fails.join(' | ').slice(0, 3000) || 'none'}`).not.toEqual([]);
      expect(code, 'the check fails').not.toBe(0);
    }
    const control = check(factsFolder()).fails;
    for (const { file, name } of AGENTS) {
      const facts = shipped(file);
      expect(entryPath(facts), `adapters/${file} carries ${name}'s rule-load entry (a key named like ruleLoad), so the shipped facts are the control`).toBeDefined();
      const field = keyOf(facts);
      expect(control.filter((l) => l.includes(field)), `AC5 the case passes the shipped facts: no FAIL line names ${field}`).toEqual([]);
    }
  }, 600_000);
});
