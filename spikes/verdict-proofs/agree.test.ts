// The engine agrees with the proved Lean model on its exported vectors, and a twin engine with one precedence row
// swapped does not. Local only: run by hand, as README says; no lane runs it.
//   .lake/build/bin/vectors 10279 10000 > vectors.jsonl
//   npx vitest run --root spikes/verdict-proofs
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { verdict } from '../../packages/verdicts/src/index.ts';
import type { Verdict } from '../../packages/verdicts/src/index.ts';
import { concretize, reqId, type Vector } from './concretize.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const src = join(here, '../../packages/verdicts/src');

const file = join(here, 'vectors.jsonl');
const vectors: Vector[] = existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Vector) : [];

/** The first difference between the engine's verdict and the model's, naming the vector by its seed. */
function disagreement(v: Vector, got: Verdict): string | null {
  const name = `seed ${v.seed}`;
  if (got.outcome !== v.verdict) return `${name}: engine ${got.outcome}, model ${v.verdict} (rows: ${v.rows.join('; ')})`;
  for (const [i, want] of v.checks.entries()) {
    if (got.checks[i]?.outcome !== want) return `${name}: check${v.claim.checks[i]!.id} engine ${got.checks[i]?.outcome}, model ${want}`;
  }
  for (const [i, want] of v.reqs.entries()) {
    if (got.requirements[i]?.outcome !== want) return `${name}: ${reqId(v.claim.reqs[i]!.id)} engine ${got.requirements[i]?.outcome}, model ${want}`;
  }
  return null;
}

describe('the engine agrees with the proved model', () => {
  it(`on every exported vector (${vectors.length})`, () => {
    expect(vectors.length, 'vectors.jsonl from `lake exe vectors`').toBeGreaterThanOrEqual(10_000);
    const out: string[] = [];
    for (const v of vectors) {
      const d = disagreement(v, verdict(concretize(v.claim)));
      if (d) out.push(d);
    }
    expect(out.slice(0, 5), `${out.length} disagreements`).toEqual([]);
  });

  it('the vectors reach every outcome and every row of the model', () => {
    const outcomes = new Set(vectors.map((v) => v.verdict));
    expect([...outcomes].sort()).toEqual(['BLOCKED', 'FAIL', 'INCONCLUSIVE', 'INVALID', 'PASS', 'pending']);
    expect(new Set(vectors.flatMap((v) => v.rows)).size).toBe(29);
  });
});

// ---- Planted twins: the engine with two adjacent ranks swapped in its precedence table.
const RANK = 'const RANK: Readonly<Record<Result, number>> = { PASS: 0, pending: 1, INCONCLUSIVE: 2, BLOCKED: 3, INVALID: 4, FAIL: 5 };';
const ORDER = ['PASS', 'pending', 'INCONCLUSIVE', 'BLOCKED', 'INVALID', 'FAIL'] as const;
const twins = join(here, '.twin');
afterAll(() => rmSync(twins, { recursive: true, force: true }));

describe('a twin engine with one precedence row swapped fails the comparison', () => {
  for (let i = 0; i < ORDER.length - 1; i++) {
    const [a, b] = [ORDER[i]!, ORDER[i + 1]!];
    it(`${a} ⇄ ${b}`, async () => {
      const dir = join(twins, `${a}-${b}`);
      mkdirSync(dir, { recursive: true });
      for (const f of readdirSync(src)) cpSync(join(src, f), join(dir, f));
      const engine = readFileSync(join(dir, 'engine.ts'), 'utf8');
      expect(engine.includes(RANK), 'the engine still holds its precedence table as written').toBe(true);
      const ranks = ORDER.map((r, j) => `${r}: ${j === i ? j + 1 : j === i + 1 ? j - 1 : j}`).join(', ');
      writeFileSync(join(dir, 'engine.ts'), engine.replace(RANK, `const RANK: Readonly<Record<Result, number>> = { ${ranks} };`));
      const twin = (await import(join(dir, 'index.ts'))) as { verdict: typeof verdict };
      const caught = vectors.find((v) => disagreement(v, twin.verdict(concretize(v.claim))) !== null);
      expect(caught, `${a} ⇄ ${b} is caught`).toBeDefined();
      expect(disagreement(caught!, twin.verdict(concretize(caught!.claim)))).toContain(`seed ${caught!.seed}`);
    });
  }
});
