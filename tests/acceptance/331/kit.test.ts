// #331 AC4: env-local passes `environment@1` (#13's kit, shipped by #314), whose planted environments each fail
// it naming what they got wrong: one that reports ready before its health route answers (the route), one that
// listens on a port it wasn't leased (the port), one that leaves a grandchild after `down` (the process), and one
// that starts a check's stack in the session's worktree instead of the checkout it was given (the worktree). The
// kit's fills take `up(spec, lease, checkout)`, as `deep.registerEnvironment` does. env-local is reached through
// its public entry, `@deepbuild/env-local`, on a real supervisor (README, The surface). "At install", through the
// extension host (#348, #349), is in blocked.test.ts.
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runKit, slotKits, cleanFills, type SlotFill, type SlotKit, type SlotReport } from '../../../packages/conformance/src/index.ts';
import { openAsks } from '../../../packages/asks/src/index.ts';
import { openRecord } from '../../../packages/record/src/index.ts';
import { openSupervisor, type Host } from '../../../packages/supervisor/src/index.ts';
import { cleanup, tempDir } from './helpers.ts';

afterEach(cleanup, 60_000);

const ENV = 'environment@1';
const PLANTS = ['ready-before-health', 'unleased-port', 'leaves-grandchild', 'starts-in-worktree'] as const;
const kit = (): SlotKit => {
  const k = slotKits().find((x) => x.slot === ENV);
  if (!k) throw Error(`slotKits() ships no ${ENV} kit`);
  return k;
};
const failing = (r: SlotReport) => r.cases.filter((c) => c.outcome !== 'PASS');

/** The public entry env-local is reached through (README): its fill on the host it starts every process through. */
interface EnvLocalModule { envLocal(options: { host: Host }): SlotFill }
async function envLocalModule(): Promise<EnvLocalModule> {
  try {
    return (await import('../../../packages/env-local/src/index.ts')) as EnvLocalModule;
  } catch (error) {
    throw Error(`env-local has no public entry at packages/env-local/src/index.ts (@deepbuild/env-local): ${(error as Error).message}`);
  }
}

describe('AC4 #331.5c02ca8a env-local passes environment@1, whose four planted environments each fail it, naming the route, the port, the process or the worktree', () => {
  it('AC4 the kit plants the four environments the issue names, and hands every fill a checkout: up(spec, lease, checkout) with a folder that exists', async () => {
    const k = kit();
    const names = k.planted.map((p) => p.name);
    for (const name of PLANTS) expect(names, `${ENV} plants ${name}`).toContain(name);
    const reference = cleanFills(k)[0]!;
    const given: unknown[] = [];
    const watched: SlotFill = {
      ...reference,
      up: (spec: unknown, lease: unknown, checkout: unknown) => {
        given.push({ checkout, exists: typeof checkout === 'string' && existsSync(checkout) });
        return (reference.up as (...a: unknown[]) => unknown)(spec, lease, checkout);
      },
    };
    const report = await runKit(k, watched, { seed: 1 });
    expect(failing(report).map((c) => `${c.id}: ${c.message}`), 'the reference fill, watched, passes').toEqual([]);
    expect(given.length, 'up was called').toBeGreaterThan(0);
    for (const g of given as { checkout: unknown; exists: boolean }[]) {
      expect(typeof g.checkout === 'string' && isAbsolute(g.checkout), `up got a checkout folder as its third argument (${JSON.stringify(g.checkout)})`).toBe(true);
      expect(g.exists, `the checkout ${String(g.checkout)} exists when up is called`).toBe(true);
      expect(g.checkout, 'the checkout is not the kit\'s own folder').not.toBe(process.cwd());
    }
  }, 300_000);

  it('AC4 each of the four planted environments fails the kit, a FAIL carrying its own message and naming the route, the port, the process or the worktree', async () => {
    const k = kit();
    const names: Record<(typeof PLANTS)[number], [string, (m: string, input: { health?: string }) => boolean]> = {
      'ready-before-health': ['the health route', (m, input) => (input.health ? m.includes(input.health) : /\/[\w-]/.test(m))],
      'unleased-port': ['the port', (m) => /port/.test(m) && /\b\d{2,5}\b/.test(m)],
      'leaves-grandchild': ['the process by PID', (m) => /\bpid \d+/.test(m)],
      'starts-in-worktree': ['the worktree it started in, by path', (m) => /worktree/i.test(m) && /(^|\s|')\/[^\s']+/.test(m)],
    };
    const problems: string[] = [];
    for (const name of PLANTS) {
      const p = k.planted.find((x) => x.name === name);
      if (!p) { problems.push(`${ENV} plants no ${name}`); continue; }
      const report = await runKit(k, p.fill, { seed: 1 });
      const named = failing(report).filter((c) => c.outcome === 'FAIL' && c.message.includes(p.message));
      if (report.verdict === 'PASS' || named.length === 0) { problems.push(`${name}: no FAIL carries "${p.message}" (failures: ${failing(report).map((c) => `${c.id}: ${c.message}`).join(' | ') || 'none'})`); continue; }
      const [what, says] = names[name];
      for (const c of named) if (!says(c.message, (c.input ?? {}) as { health?: string })) problems.push(`${name}: ${c.id}'s FAIL doesn't name ${what}: ${c.message}`);
    }
    expect(problems, 'each planted environment fails environment@1, naming what it got wrong').toEqual([]);
  }, 600_000);

  it('AC4 env-local, on a real supervisor, passes environment@1 on its fixed and seeded parts', async () => {
    const { envLocal } = await envLocalModule();
    const dir = tempDir();
    const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
    const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
    const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 2 * 86_400_000 } } } });
    try {
      const fill = envLocal({ host: sup });
      expect(fill.slot).toBe(ENV);
      const report = await runKit(kit(), fill, { seed: 1 });
      expect(failing(report).map((c) => `${c.id}: ${c.outcome} ${c.message}`), 'env-local passes every case').toEqual([]);
      expect(report.verdict).toBe('PASS');
    } finally {
      await sup.close();
      await record.close();
    }
  }, 300_000);
});
