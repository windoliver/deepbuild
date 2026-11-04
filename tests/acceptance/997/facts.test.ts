// #997 AC2: the loop facts name Claude Code's Monitor call, and the loop-facts conformance case holds them to it.
// The case runs where the facts are held to the recorded corpus, the preflight's corpus lane
// (`node scripts/corpus.mjs check --facts <dir>`, README, Surfaces): given a folder of facts files whose
// loops.facts.json has the Monitor entry taken out, it must fail with a line naming the loop facts and `Monitor`.
import { spawnSync } from 'node:child_process';
import { copyFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, NODE, REPO, tempDir, type Line } from '../18/mapping/helpers.ts';
import { AC2 } from './helpers.ts';

afterAll(cleanup, 60_000);

const SHIPPED = join(REPO, 'adapters/loops.facts.json');
/** The value with every entry for the Monitor tool taken out: a key `Monitor`, or a list item `Monitor`. */
function withoutMonitor(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter((v) => v !== 'Monitor').map(withoutMonitor);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([k]) => k !== 'Monitor').map(([k, v]) => [k, withoutMonitor(v)]));
  return value;
}
/** A folder holding the shipped facts files, its loops.facts.json as `loops` gives it. */
function factsFolder(loops: unknown): string {
  const dir = tempDir();
  for (const f of readdirSync(join(REPO, 'adapters')).filter((n) => n.endsWith('.facts.json'))) copyFileSync(join(REPO, 'adapters', f), join(dir, f));
  writeFileSync(join(dir, 'loops.facts.json'), `${JSON.stringify(loops, null, 2)}\n`);
  return dir;
}
function check(facts: string): { code: number | null; fails: string[] } {
  const r = spawnSync(NODE, ['scripts/corpus.mjs', 'check', '--facts', facts], { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 600_000 });
  const fails = r.stdout.split('\n').map((l, i, all) => (l.startsWith('FAIL') ? `${l} ${all[i + 1]?.trim().startsWith('Fix:') ? all[i + 1]!.trim() : ''}` : '')).filter(Boolean);
  return { code: r.status, fails };
}

describe(`${AC2} A planted facts file without the Monitor entry fails the loop-facts conformance case, naming the tool`, () => {
  const shipped = JSON.parse(readFileSync(SHIPPED, 'utf8')) as Line;
  const planted = withoutMonitor(shipped) as Line;

  it(`${AC2} the shipped loop facts name Claude Code's Monitor call, so there is an entry to take out`, () => {
    expect(JSON.stringify(shipped.agents?.claude ?? {}), 'adapters/loops.facts.json names a Monitor entry for Claude Code').toContain('"Monitor"');
    expect(JSON.stringify(planted), 'taking the Monitor entry out changes the facts').not.toBe(JSON.stringify(shipped));
  });

  it(`${AC2} node scripts/corpus.mjs check, given loops.facts.json without the Monitor entry, fails the loop-facts conformance case, naming Monitor`, () => {
    const { code, fails } = check(factsFolder(planted));
    const named = fails.filter((l) => l.includes('Monitor') && /loop/i.test(l));
    console.log(`AC2 planted: exit ${code}; FAIL lines naming Monitor: ${named.join(' | ') || 'none'}`);
    expect(code, 'the check fails').not.toBe(0);
    expect(named, `a FAIL line of the loop-facts conformance case names the tool, Monitor; the FAIL lines were: ${fails.join(' | ').slice(0, 3000)}`).not.toEqual([]);
  }, 600_000);

  it(`${AC2} (control) the same check with the shipped loop facts has no loop-facts FAIL line naming Monitor`, () => {
    const { fails } = check(factsFolder(shipped));
    expect(fails.filter((l) => l.includes('Monitor') && /loop/i.test(l)), 'the case passes the shipped facts').toEqual([]);
  }, 600_000);
});
