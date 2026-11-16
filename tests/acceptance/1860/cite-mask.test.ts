// #1860's acceptance tests (README): the validity gate reads the mask in the run a claim cites, not only in the run
// the cite matched. Each case is a claim whose final message cites one run, judged by the core's floor (the validity
// gate before any check runs) from `@deepbuild/gate`'s public entry, on real files in a temporary checkout whose
// package.json `test` script is plain `vitest run`, so any mask the gate finds can only come from the cite or the run.
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { floor, lockDefinition } from '../../../packages/gate/src/index.ts';
import type { DefinitionParts, FloorResult, SessionRun } from '../../../packages/gate/src/index.ts';

const MASK = 'exit status masked by `|| true`';
const CLAIM = 'claim:01K74G1Z3X5V7T9R1P3N5M7K9H';

const made: string[] = [];
afterAll(() => { for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true }); });
/** A checkout holding a package.json whose `test` script masks nothing. */
function checkout(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'dh1860-')));
  made.push(dir);
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: 'cart', private: true, scripts: { test: 'vitest run' } }, null, 2)}\n`);
  return dir;
}
const definition: DefinitionParts = { task_ref: 'task:01K74FX2B4D6F8H0K2M4P6R8T0', requirements: [], deliverables: ['package.json'], files: {} };

/** The floor's result for a claim whose final message cites `cite`, in a session that ran `ran`. */
function judge(cite: string, ran: SessionRun[]): FloorResult {
  return floor({
    claim: { claim: CLAIM, message: `Done: \`${cite}\` passes.` },
    checkout: checkout(), definition, locked: lockDefinition(definition), session: { read: [], ran },
  });
}
function goesBackNamingMask(r: FloorResult, cite: string, ran: string[]): void {
  const story = `a claim citing \`${cite}\` in a session that ran ${ran.map((c) => `\`${c}\``).join(' then ')}`;
  expect(r.ok, `${story} goes back before any check runs, naming "${MASK}"; the gate let it through`).toBe(false);
  if (r.ok) return;
  expect(r.action, `${story}: a validity-gate failure is a send-back`).toBe('send_back');
  expect(r.findings.some((f) => f.why.includes(MASK)), `${story}: a finding names "${MASK}"; the findings are ${JSON.stringify(r.findings)}`).toBe(true);
}

describe('#1860 the validity gate reads the mask in the run a claim cites', () => {
  it('AC1 a session that ran `pnpm test` then `pnpm test || true`, citing `pnpm test || true`, goes back naming the mask', () => {
    const ran = [{ command: 'pnpm test', exit_status: 1, output: '1 failed' }, { command: 'pnpm test || true', exit_status: 0, output: '1 failed' }];
    goesBackNamingMask(judge('pnpm test || true', ran), 'pnpm test || true', ran.map((r) => r.command));
  });

  it('AC2 a session that ran only `pnpm test`, citing `pnpm test || true`, goes back naming the mask', () => {
    const ran = [{ command: 'pnpm test', exit_status: 0, output: '3 passed' }];
    goesBackNamingMask(judge('pnpm test || true', ran), 'pnpm test || true', ['pnpm test']);
  });

  it('AC3 a session that ran only `pnpm test`, citing `pnpm test`, still passes the gate', () => {
    const r = judge('pnpm test', [{ command: 'pnpm test', exit_status: 0, output: '3 passed' }]);
    expect(r, `a claim citing \`pnpm test\`, the run the session made, passes the gate; it got ${JSON.stringify(r)}`).toEqual({ ok: true });
  });
});
