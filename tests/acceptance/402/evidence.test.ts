// AC3: a cell grid or a captured screen never counts as evidence of an agent's state; a claim that cites one alone goes
// back. Through the verdict engine (@deepbuild/verdicts, #28) and the real record (@deepbuild/record, SQLite in a temp
// folder), as #28's tests drive them: a claim whose requirement a check covers and whose run passed (so, uncited, it is a
// PASS), and whose `cites` (README: The claim's citations) name what the claim rests on. A claim that cites a cell grid
// or a captured screen and nothing that counts is INVALID, naming each, and its recorded verdict says so; one that also
// cites a run it can resolve is not sent back for the grid, which proves nothing either way. A gate that counts the grid
// (the engine with the citation left out) fails the same check. At the base the engine reads no `cites`, so the claim
// is a PASS.
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { recordVerdict, verdict } from '../../../packages/verdicts/src/index.ts';
import type { ClaimInput, Verdict } from '../../../packages/verdicts/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import type { RecordStore } from '../../../packages/record/src/index.ts';
import { check, claim, commitOf, run, T0 } from '../28/helpers.ts';

/** What a claim cites (README: The claim's citations): a handle and what kind of thing it names. */
interface Cite { kind: 'file' | 'line' | 'test' | 'run' | 'link' | 'cell_grid' | 'screen'; handle: string }
type Cited = ClaimInput & { cites: Cite[] };

const COMMIT = commitOf('402-grid');
const GRID: Cite = { kind: 'cell_grid', handle: 'cells:doc:01JB7D0000000000000000AAAA#screen@17' };
const SCREEN: Cite = { kind: 'screen', handle: 'screen:sha256:7c0e1b2f9d3a4c5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6' };
const unit = check('unit:agent-is-idle');
const passed = run(unit, COMMIT, 'passed');
const RUN: Cite = { kind: 'run', handle: passed.run };
const base = (): ClaimInput => claim({ commit: COMMIT, checks: [unit], runs: [passed] });
const cited = (...cites: Cite[]): Cited => ({ ...base(), cites });

/** What "goes back" means: INVALID, with a reason that names each cite that doesn't count. */
function goesBackProblems(v: Verdict, cites: readonly Cite[]): string[] {
  const f: string[] = [];
  if (v.outcome !== 'INVALID') f.push(`the claim is ${v.outcome}, not INVALID (sent back)`);
  for (const c of cites) if (!v.reasons.some((r) => r.includes(c.handle))) f.push(`no reason names the ${c.kind} ${c.handle} that was cited`);
  return f;
}
/** What "not sent back" means here: no reason names the cite, and the claim stands on its check as before. */
function standsProblems(v: Verdict, cites: readonly Cite[]): string[] {
  const f: string[] = [];
  if (v.outcome !== 'PASS') f.push(`the claim is ${v.outcome}, not PASS: ${v.reasons.join('; ').slice(0, 300)}`);
  for (const c of cites) if (v.reasons.some((r) => r.includes(c.handle))) f.push(`a reason names ${c.handle}, which the claim may cite beside a run`);
  return f;
}

const roots: string[] = [];
afterEach(() => { for (const d of roots.splice(0)) rmSync(d, { recursive: true, force: true }); });
async function open(): Promise<RecordStore> {
  const dir = mkdtempSync(join('/tmp', 'dh402-record-'));
  roots.push(dir);
  let t = T0;
  return openRecord({ path: join(dir, 'record.db'), now: () => (t += 1) });
}

describe('AC3 a cell grid or a captured screen never counts as evidence of an agent\'s state', () => {
  it('AC3 a claim that cites a cell grid alone, a captured screen alone, or both, goes back, naming each; beside a run that resolves the grid adds nothing, and an uncited claim is as before', () => {
    for (const cites of [[GRID], [SCREEN], [GRID, SCREEN]]) {
      expect(goesBackProblems(verdict(cited(...cites)), cites), `a claim citing ${cites.map((c) => c.kind).join(' and ')} alone goes back`).toEqual([]);
    }
    // The controls: what the gate must not send back.
    expect(verdict(base()).outcome, 'the uncited claim').toBe('PASS');
    expect(standsProblems(verdict(cited(RUN)), [RUN]), 'a claim that cites its resolved run').toEqual([]);
    const beside = verdict(cited(GRID, SCREEN, RUN));
    expect(standsProblems(beside, [GRID, SCREEN]), 'a claim that cites a grid and a screen beside its run').toEqual([]);
    expect(beside.requirements[0]!.evidence, 'the evidence the verdict counts is the run\'s, never the grid\'s').toEqual(verdict(base()).requirements[0]!.evidence);
  });

  it('AC3 the recorded verdict of a claim that cites a grid alone is INVALID and names the grid; the one beside a run is a PASS', async () => {
    const record = await open();
    const sent = await recordVerdict(record, verdict(cited(GRID)), T0 + 10);
    const stood = await recordVerdict(record, verdict({ ...cited(GRID, RUN), claim: 'claim:01K74G1Z3X5V7T9R1P3N5M7K9J' }), T0 + 20);
    const rows = (await record.table('verdicts')).rows;
    const row = (id: string) => rows.find((r) => String(r['id']) === id);
    expect(String(row(sent.id)?.['outcome']), 'the recorded verdict of the claim that cites the grid alone').toBe('INVALID');
    expect(String(row(sent.id)?.['reasons']), 'its recorded reasons name the grid').toContain(GRID.handle);
    expect(String(row(stood.id)?.['outcome']), 'the recorded verdict of the claim that cites the grid beside its run').toBe('PASS');
    await record.close();
  });

  it('AC3 a gate that counts the grid (the engine reading no `cites`) fails the same check: it passes the claim and names nothing', () => {
    // The honest verdict must send the claim back before the wrong one is worth comparing.
    expect(goesBackProblems(verdict(cited(GRID)), [GRID]), 'the real gate sends it back').toEqual([]);
    const counts = verdict(base());
    const found = goesBackProblems(counts, [GRID]);
    expect(found.some((m) => m.includes('not INVALID')), `a gate that counts the grid fails: ${JSON.stringify(found)}`).toBe(true);
    expect(found.some((m) => m.includes(GRID.handle)), 'and names the grid it let through').toBe(true);
    // A gate that sends it back but says nothing of what is missing fails too.
    const mute: Verdict = { ...verdict(cited(GRID)), reasons: [] };
    expect(goesBackProblems(mute, [GRID]).some((m) => m.includes(GRID.handle)), 'a send-back that names nothing fails').toBe(true);
  });
});
