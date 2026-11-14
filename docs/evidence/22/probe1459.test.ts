// By-hand probe for #22's Mac run 22l: what the real deep-app shows an assistive client on #1172's world, and whether
// the app is still alive, for the two #1459 files that failed at the PR head in 22j and passed on main in 22k.
// Put it at <repo>/target/e2e-22/probe1459.test.ts and run from the repo root on the Mac:
//   E2E_OUT=<dir> npx vitest run --root target/e2e-22 probe1459.test.ts --testTimeout=1200000
// It asserts nothing: it writes <dir>/probe1459.txt. It stops only the processes the helpers started, by PID.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { appBinary, makeWorld, useCleanup } from '../../tests/acceptance/1172/helpers.ts';
import { fixtureCopy, label, RealApp } from '../../tests/acceptance/1459/helpers.ts';

useCleanup();
const OUT = process.env.E2E_OUT!;
mkdirSync(OUT, { recursive: true });
const out: string[] = [];
const log = (s: string) => { out.push(s); writeFileSync(join(OUT, 'probe1459.txt'), `${out.join('\n')}\n`); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function watch(name: string, args: string[]): Promise<void> {
  const world = await makeWorld();
  log(`\n== ${name}: asks ${world.asks.map((a) => `${a.handle} "${a.question}"`).join('; ')}`);
  let app: RealApp;
  try {
    app = await RealApp.launch(world.home, await appBinary(), args);
  } catch (error) {
    log(`launch failed: ${(error as Error).message}`);
    return;
  }
  try {
    for (let i = 0; i < 12; i++) {
      const child = app.child;
      const windows = await app.windows().catch((e: Error) => `windows failed: ${e.message}`);
      const nodes = await app.nodes().catch(() => []);
      const texts = nodes.map((n) => ({ role: n.role, label: label(n), value: n.value, identifier: n.identifier })).filter((n) => n.label || n.value || n.identifier);
      log(`t+${i * 3}s exit ${child.exitCode} signal ${child.signalCode} windows ${JSON.stringify(windows)} nodes ${nodes.length}`);
      if (i === 0 || i === 11 || child.exitCode !== null || child.signalCode !== null) log(`   texts ${JSON.stringify(texts).slice(0, 6000)}`);
      for (const ask of world.asks) log(`   "${ask.question.slice(0, 24)}…" label-starts ${nodes.filter((n) => (label(n) ?? '').startsWith(ask.question)).length} anywhere ${nodes.filter((n) => [n.title, n.description, n.value].some((t) => (t ?? '').includes(ask.question))).length}`);
      if (child.exitCode !== null || child.signalCode !== null) break;
      await sleep(3000);
    }
    log(`stderr: ${app.stderr().slice(-3000)}`);
  } finally {
    await app.stop();
  }
}

it('probe', async () => {
  await watch('plain app', []);
  await watch('--panel asks', ['--panel', fixtureCopy('panels', 'asks')]);
}, 1_200_000);
