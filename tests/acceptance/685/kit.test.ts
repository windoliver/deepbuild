// AC11: the plug-in passes the `check.kind@1` kit, including a planted runner that reports passed for a theorem the
// checker never found. The kit is the plug-in's, for its kind, run by the conformance package's one runner.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../../../packages/contracts/src/index.ts';
import { runKit } from '../../../packages/conformance/src/index.ts';
import type { SlotCaseResult } from '../../../packages/conformance/src/index.ts';
import type { ProofSpec } from '../../../packages/proof/src/index.ts';
import { context, LEAN_TEST, once, plugin, requireKani, requireLean } from './helpers.ts';

/** The unfound-theorem planted runner and the fixture it is planted against, as the criterion names them. */
const PLANTED = 'unfound-theorem';
const KIT_TEST = 3 * LEAN_TEST;
/** The plug-in's kit; its cases run the real checkers, so the environment must hold both toolchains. */
const kit = once(async () => {
  const k = (await plugin()).proofKit();
  requireLean();
  requireKani();
  return k;
});

interface Input { spec: ProofSpec; checkout: string; deadline: number }
const failing = (cases: SlotCaseResult[]): SlotCaseResult[] => cases.filter((c) => c.outcome === 'FAIL');
/** Every file's text under a checkout, build output left out. */
function texts(dir: string): string {
  return readdirSync(dir).filter((n) => !['.lake', 'target', '.git'].includes(n)).map((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? texts(p) : readFileSync(p, 'utf8');
  }).join('\n');
}
async function unfound(): Promise<{ input: Input; theorem: string }> {
  const k = await kit();
  const f = k.fixtures.find((x) => x.id.includes(PLANTED));
  if (!f) throw new Error(`the kit ships no fixture whose id names ${PLANTED}: ${k.fixtures.map((x) => x.id).join(', ')}`);
  const input = f.input as unknown as Input;
  const all = texts(input.checkout);
  const theorem = input.spec.theorems.find((t) => !all.includes(t.split('::').pop()!));
  if (!theorem) throw new Error(`${f.id}'s spec names no theorem its checkout lacks: ${input.spec.theorems.join(', ')}`);
  return { input, theorem };
}

describe('AC11 the plug-in passes the check.kind@1 kit, including a planted runner that reports passed for a theorem the checker never found', () => {
  it('AC11 the plug-in\'s kit is a check.kind@1 kit with the planted unfound-theorem runner, breaking a rule it lists, and a fixture whose spec names a theorem its checkout lacks', async () => {
    const k = await kit();
    expect(k.slot).toBe('check.kind@1');
    const p = k.planted.find((x) => x.name === PLANTED);
    expect(p, `planted fills: ${k.planted.map((x) => x.name).join(', ')}`).toBeDefined();
    expect(k.rules.map((r) => r.id)).toContain(p!.breaks);
    expect(p!.message.length).toBeGreaterThan(0);
    expect(p!.codes.some((c) => !ERROR_CODES.includes(c)), `${PLANTED} raises its rule's finding, not only a shape refusal (${p!.codes})`).toBe(true);
    expect(p!.fill.kind).toBe('proof');
    const { input } = await unfound();
    expect(existsSync(input.checkout)).toBe(true);
    expect(input.spec.kind).toBe('proof');
  });

  it('AC11 the plug-in\'s runner passes its kit: every case, fixed and seeded, reads PASS', async () => {
    const { proofFill } = await plugin();
    const k = await kit();
    const report = await runKit(k, proofFill(), { seed: 1 });
    expect(report.cases.length).toBeGreaterThan(0);
    expect(report.cases.some((c) => c.part === 'seeded'), 'the kit has a seeded part').toBe(true);
    expect(report.cases.filter((c) => c.outcome !== 'PASS').map((c) => `${c.id}: ${c.outcome} ${c.message}`)).toEqual([]);
    expect(report.verdict).toBe('PASS');
    expect(report.slot).toBe('check.kind@1');
  }, KIT_TEST);

  it('AC11 the planted runner reports passed for the theorem the checker never found; the plug-in\'s runner does not', async () => {
    const { proofFill } = await plugin();
    const k = await kit();
    const { input, theorem } = await unfound();
    const p = k.planted.find((x) => x.name === PLANTED)!;
    const wrong = await p.fill.run(input.spec, context(input.checkout, input.deadline));
    expect(wrong.outcome, `the planted runner on ${theorem}`).toBe('passed');
    const right = await proofFill().run(input.spec, context(input.checkout, input.deadline));
    expect(right.outcome, `the plug-in on ${theorem}: ${right.reasons.join(' | ')}`).not.toBe('passed');
  }, KIT_TEST);

  it('AC11 (wrong program) the kit fails the planted runner, with a FAIL that carries its message and its codes', async () => {
    const k = await kit();
    const p = k.planted.find((x) => x.name === PLANTED)!;
    const report = await runKit(k, p.fill, { seed: 1, parts: ['fixed'] });
    expect(report.verdict).not.toBe('PASS');
    const named = failing(report.cases).filter((c) => c.message.includes(p.message));
    expect(named.length, `a FAIL names "${p.message}" (failures: ${failing(report.cases).map((c) => `${c.id}: ${c.message}`).join(' | ')})`).toBeGreaterThan(0);
    for (const c of named) expect(c.codes).toEqual(expect.arrayContaining(p.codes));
  }, KIT_TEST);
});
