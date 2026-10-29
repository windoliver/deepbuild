// #29 AC3, AC4, AC5, AC6, AC7: the floor, before any check runs: the validity gate and the definition's hash, with no model.
// Real files in a temp checkout; the masked-exit oracle is the core's own `maskIn` (README, open points 1 and 3).
import { describe, expect, it } from 'vitest';
import { maskIn } from '../../../packages/checks-command/src/shell.ts';
import { floor, lockDefinition, recomputeHash } from '../../../packages/gate/src/index.ts';
import type { DefinitionParts, FloorInput, FloorResult, SessionLog } from '../../../packages/gate/src/index.ts';
import { mustFail, tempDir, write } from './helpers.ts';

type Opts = NonNullable<Parameters<typeof floor>[1]>;
const CART = 'export function total(a: number[]) {\n  return a.reduce((x, y) => x + y, 0);\n}\n// line 4\n';
const TEST = "import { total } from '../src/cart';\ntest('rounds tax', () => expect(total([1])).toBe(1));\n";
const CHECK = '.deepbuild/checks/total.sh';
const EXPECTED = '.deepbuild/expected/total.txt';

function definition(over: Partial<DefinitionParts> = {}): DefinitionParts {
  return {
    task_ref: 'task:01K74FX2B4D6F8H0K2M4P6R8T0',
    requirements: [{ id: 'R1', text: 'the receipt shows $18.01', check: CHECK }, { id: 'R2', text: 'a test covers it', check: null }],
    deliverables: ['src/cart.ts'],
    files: { [CHECK]: '#!/bin/sh\nnode check.js\n', [EXPECTED]: '18.01\n' },
    ...over,
  };
}
/** A checkout holding the cart, its test, a README and the package.json whose `test` script is `script`. */
function checkout(script = 'vitest run'): string {
  const dir = tempDir();
  write(dir, {
    'src/cart.ts': CART, 'test/cart.test.ts': TEST, 'docs/cart.md': '# cart\n', 'package.json': JSON.stringify({ scripts: { test: script } }),
  });
  return dir;
}
const READ_ALL: SessionLog = { read: ['src/cart.ts', 'test/cart.test.ts', 'docs/cart.md'], ran: [{ command: 'pnpm test', exit_status: 1, output: '1 failed' }], links: [] };
function input(dir: string, message: string, session: SessionLog = READ_ALL, def = definition(), locked = lockDefinition(definition())): FloorInput {
  return { claim: { claim: 'claim:01K74G1Z3X5V7T9R1P3N5M7K9H', message }, checkout: dir, definition: def, locked, session };
}
const findings = (r: FloorResult) => (r.ok ? [] : r.findings);
function sentBackNaming(r: FloorResult, kind: string, ref: string, what: string): void {
  expect(r.ok, `${what}: the claim goes back (claim:01K74G1Z3X5V7T9R1P3N5M7K9H)`).toBe(false);
  if (r.ok) return;
  expect(r.action, `${what}: a validity-gate failure is a send-back`).toBe('send_back');
  const f = r.findings.find((x) => x.ref.includes(ref));
  expect(f, `${what}: a finding names ${ref}; the findings are ${JSON.stringify(r.findings)}`).toBeDefined();
  expect(f!.kind, `${what}: the finding's kind`).toBe(kind);
  expect(f!.why, `${what}: the words name ${ref}`).toContain(ref);
}

describe('AC3 a claim citing a test, file or run the session never read or ran goes back naming it', () => {
  const unread = (opts?: Opts) => {
    const dir = checkout();
    const cases: [string, string, string, string, SessionLog][] = [
      ['file', 'src/cart.ts', 'I fixed `src/cart.ts`', 'a file', { ...READ_ALL, read: ['test/cart.test.ts'] }],
      ['line', 'src/cart.ts:2', 'The bug was at `src/cart.ts:2`', 'a line', { ...READ_ALL, read: [] }],
      ['test', 'test/cart.test.ts', 'The test `test/cart.test.ts › rounds tax` passes', 'a test', { ...READ_ALL, read: ['src/cart.ts'], ran: [] }],
      ['run', 'pnpm lint', 'I ran `pnpm lint` and it is clean', 'a run', READ_ALL],
    ];
    for (const [kind, ref, message, what, session] of cases) sentBackNaming(floor(input(dir, message, session), opts), kind, ref, what);
  };
  it('AC3 an unread file, line, test or a run never made goes back naming it', () => unread());
  it('AC3 a cited file or line that does not resolve goes back naming it', () => {
    const dir = checkout();
    sentBackNaming(floor(input(dir, 'See `src/missing.ts`', { ...READ_ALL, read: [...READ_ALL.read, 'src/missing.ts'] })), 'file', 'src/missing.ts', 'a missing file');
    sentBackNaming(floor(input(dir, 'See `src/cart.ts:99`')), 'line', 'src/cart.ts:99', 'a line past the end');
  });
  it('AC3 a link that resolves nowhere goes back naming it; one the session fetched passes', () => {
    const dir = checkout();
    const url = 'https://example.test/pr/3';
    sentBackNaming(floor(input(dir, `PR: \`${url}\``)), 'link', url, 'an unknown link');
    expect(floor(input(dir, `PR: \`${url}\``, { ...READ_ALL, links: [url] }))).toEqual({ ok: true });
  });
  it('AC3 the same claim, with everything it cites read or run, passes the gate; words outside backticks decide nothing', () => {
    const dir = checkout();
    expect(floor(input(dir, 'I changed `src/cart.ts:2`, and `test/cart.test.ts › rounds tax` and `pnpm test` ran; also src/never-read.ts in prose'))).toEqual({ ok: true });
  });
  it('AC3 a gate that does not check reads fails the first assertion', async () => {
    await mustFail('no-read-check', () => unread({ plant: 'no-read-check' }), ['src/cart.ts']);
  });
});

describe('AC4 a claim missing a deliverable its definition names goes back naming it', () => {
  const missing = (opts?: Opts) => {
    const dir = checkout();
    const def = definition({ deliverables: ['src/cart.ts', 'docs/receipt.md', 'src/discount.ts'] });
    const r = floor(input(dir, 'Done.', READ_ALL, def, lockDefinition(def)), opts);
    sentBackNaming(r, 'deliverable', 'docs/receipt.md', 'a missing deliverable');
    expect(findings(r).map((f) => f.ref).filter((x) => x.includes('src/discount.ts')), 'every missing deliverable is named').toHaveLength(1);
    expect(findings(r).some((f) => f.ref.includes('src/cart.ts')), 'a deliverable that exists is not named').toBe(false);
  };
  it('AC4 names each missing deliverable and not the present one', () => missing());
  it('AC4 all deliverables present: passes', () => {
    const dir = checkout();
    expect(floor(input(dir, 'Done.'))).toEqual({ ok: true });
  });
  it('AC4 a gate that skips the deliverable check fails', async () => {
    await mustFail('no-deliverable-check', () => missing({ plant: 'no-deliverable-check' }), ['docs/receipt.md']);
  });
});

describe('AC5 a claim whose definition hash differs from the locked one is INVALID, naming what changed', () => {
  const locked = lockDefinition(definition());
  it('AC5 the hash is stable, and every part changes it', () => {
    expect(lockDefinition(definition())).toEqual(locked);
    expect(locked.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(locked.parts)).toEqual(expect.arrayContaining(['requirement:R1', 'requirement:R2', 'deliverables', `file:${CHECK}`, `file:${EXPECTED}`]));
    expect(recomputeHash(definition(), locked)).toEqual({ same: true, hash: locked.hash, changed: [] });
  });
  it('AC5 a drafted check file with other bytes: INVALID naming the file', () => {
    const def = definition({ files: { [CHECK]: '#!/bin/sh\nexit 0\n', [EXPECTED]: '18.01\n' } });
    const h = recomputeHash(def, locked);
    expect(h.same).toBe(false);
    expect(h.hash).not.toBe(locked.hash);
    expect(h.changed).toEqual([`file:${CHECK}`]);
    const r = floor(input(checkout(), 'Done.', READ_ALL, def, locked));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.action).toBe('INVALID');
    const f = r.findings.find((x) => x.kind === 'definition_hash')!;
    expect(f, JSON.stringify(r.findings)).toBeDefined();
    expect(f.changed).toEqual([`file:${CHECK}`]);
    expect(f.why).toContain(CHECK);
  });
  it('AC5 an expected output, a requirement and the deliverables each change the hash and are named', () => {
    const e = recomputeHash(definition({ files: { [CHECK]: '#!/bin/sh\nnode check.js\n', [EXPECTED]: '18.00\n' } }), locked);
    expect(e.changed).toEqual([`file:${EXPECTED}`]);
    const r = recomputeHash(definition({ requirements: [{ id: 'R1', text: 'the receipt shows $18.00', check: CHECK }, { id: 'R2', text: 'a test covers it', check: null }] }), locked);
    expect(r.same).toBe(false);
    expect(r.changed).toEqual(['requirement:R1']);
    const d = recomputeHash(definition({ deliverables: [] }), locked);
    expect(d.changed).toEqual(['deliverables']);
    const f = floor(input(checkout(), 'Done.', READ_ALL, definition({ requirements: [{ id: 'R1', text: 'changed', check: CHECK }, { id: 'R2', text: 'a test covers it', check: null }] }), locked));
    expect(f.ok).toBe(false);
    if (!f.ok) expect(f.findings.find((x) => x.kind === 'definition_hash')!.why).toContain('R1');
  });
  it('AC5 a removed check file is named too', () => {
    const def = definition({ files: { [EXPECTED]: '18.01\n' } });
    expect(recomputeHash(def, locked).changed).toContain(`file:${CHECK}`);
  });
  it('AC5 an unchanged definition passes the floor', () => {
    expect(floor(input(checkout(), 'Done.'))).toEqual({ ok: true });
  });
});

describe('AC6 a claim citing a run whose command masked its exit status goes back naming the mask', () => {
  const masked = (opts?: Opts) => {
    const dir = checkout();
    const log: SessionLog = { ...READ_ALL, ran: [{ command: 'pnpm test || true', exit_status: 0, output: ' Tests  1 failed | 4 passed\n' }] };
    const r = floor(input(dir, 'I ran `pnpm test || true`; its output shows 1 failed test', log), opts);
    sentBackNaming(r, 'masked_exit', 'pnpm test || true', 'the masked run');
    const f = findings(r).find((x) => x.kind === 'masked_exit')!;
    expect(f.mask, 'the mask as the core names it').toBe(maskIn('pnpm test || true'));
    expect(f.why).toContain('exit status masked by `|| true`');
  };
  it('AC6 `pnpm test || true` goes back naming "exit status masked by `|| true`"', () => masked());
  it('AC6 the same claim citing a bare `pnpm test` run the session made passes the gate', () => {
    expect(floor(input(checkout(), 'I ran `pnpm test`; its output shows 1 failed test'))).toEqual({ ok: true });
  });
  it('AC6 a gate that checks only that the cited run happened lets the first through and fails', async () => {
    await mustFail('run-happened-only', () => masked({ plant: 'run-happened-only' }), ['pnpm test || true']);
  });
  it('AC6 every mask the core names goes back with the mask maskIn returns', () => {
    const list = ['pnpm test || exit 0', 'pnpm test; true', 'set +e; pnpm test', 'pnpm test || :', 'pnpm test || echo ok', 'pnpm test; exit 0', '! pnpm test', 'pnpm test --passWithNoTests', 'pnpm test &', 'pnpm test | tee out.log'];
    const known = list.filter((c) => maskIn(c) !== null);
    expect(known.length, 'the core knows at least these masks').toBeGreaterThanOrEqual(5);
    for (const command of known) {
      const log: SessionLog = { ...READ_ALL, ran: [{ command, exit_status: 0, output: '' }] };
      const r = floor(input(checkout(), `I ran \`${command}\``, log));
      expect(r.ok, command).toBe(false);
      const f = findings(r).find((x) => x.kind === 'masked_exit');
      expect(f?.mask, `${command}: the mask`).toBe(maskIn(command));
      expect(f?.why, command).toContain(`exit status masked by \`${maskIn(command)}\``);
    }
  });
  it('AC6 a package script that masks its exit goes back too; a clean script passes', () => {
    const script = 'vitest run || true';
    const log: SessionLog = { ...READ_ALL, ran: [{ command: 'pnpm test', exit_status: 0, output: '' }] };
    const r = floor(input(checkout(script), 'I ran `pnpm test`', log));
    expect(r.ok, 'the script `vitest run || true` masks the run').toBe(false);
    expect(findings(r).find((x) => x.kind === 'masked_exit')?.mask).toBe(maskIn(script));
    expect(floor(input(checkout('vitest run'), 'I ran `pnpm test`', log))).toEqual({ ok: true });
  });
});

describe('AC7 in safe mode the floor still holds', () => {
  const neverMade = 'I ran `pnpm e2e` and it passed';
  const safe = (opts: Opts = {}) => {
    const dir = checkout();
    const a = floor(input(dir, neverMade), { safe: true, ...opts });
    expect(a.ok, 'claim:01K74G1Z3X5V7T9R1P3N5M7K9H cites a run the session never made: it goes back').toBe(false);
    if (!a.ok) expect(a.findings.some((f) => f.kind === 'run' && f.ref.includes('pnpm e2e'))).toBe(true);
    const def = definition({ files: { [CHECK]: '#!/bin/sh\nexit 0\n', [EXPECTED]: '18.01\n' } });
    const b = floor(input(dir, 'Done.', READ_ALL, def), { safe: true, ...opts });
    expect(b.ok, 'claim:01K74G1Z3X5V7T9R1P3N5M7K9H has a definition hash that differs: INVALID').toBe(false);
    if (!b.ok) expect(b.action).toBe('INVALID');
  };
  it('AC7 safe mode with no extension: a never-made run goes back and a differing hash is INVALID', () => safe());
  it('AC7 an installed done gate that approves everything changes nothing, and is never consulted', () => {
    let consulted = 0;
    const doneGate = (): FloorResult => { consulted++; return { ok: true }; };
    safe({ doneGate });
    const r = floor(input(checkout(), neverMade), { doneGate });
    expect(r.ok).toBe(false);
    expect(consulted, 'the floor never asks an extension').toBe(0);
  });
  it('AC7 a gate runner that leaves either to the done gate extension fails, naming the claim', async () => {
    await mustFail('leaves-to-done-gate', () => safe({ plant: 'leaves-to-done-gate' }), ['claim:01K74G1Z3X5V7T9R1P3N5M7K9H']);
  });
  it('AC7 the floor is the same with and without safe mode', () => {
    const dir = checkout();
    expect(floor(input(dir, neverMade), { safe: true })).toEqual(floor(input(dir, neverMade)));
  });
});
