// #344.10e389aa's check run: screenshots of the rules page as the app draws it (deep-replica --view rules, at the
// reference window, light), over pages the real hub wrote with `deep rules sync`. Run by hand on a Mac; it writes
// target/acceptance/344/rules-page.png (every rule of the issue's fixture with what enforces it, a guard among them)
// and rules-page-text-only.png (a rule whose guard fails its planted call, reading text only). Whether they look
// right is the owner's taste call, recorded in tests/acceptance/344/TASTE.json; tests/acceptance/344/taste.test.ts
// reads both.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { childEnv, run, shown } from '../../acceptance/303/helpers.ts';
import {
  FORCE_PUSH, NPM_TEST, REPO, Session, addGuard, badGuard, cleanupAll, fixtureWorld, goodGuard, show, startHub, stopHub, syncRules, type World,
} from '../../acceptance/344/helpers.ts';

afterAll(cleanupAll, 120_000);
const OUT = join(REPO, 'target', 'acceptance', '344');
const REPLICA = join(REPO, 'target', 'debug', 'deep-replica');
const REBASE = 'never rebase published branches';

async function shoot(w: World, name: string): Promise<void> {
  const out = join(w.tmp, 'replica');
  const ran = await run(REPLICA, ['--view', 'rules', '--out', out, '--appearance', 'light'], { env: childEnv(w.home), cwd: w.tmp, timeoutMs: 300_000 });
  expect(ran.code, `deep-replica --view rules draws the page: ${shown(ran)}`).toBe(0);
  const png = join(out, 'screens', 'rules.png');
  expect(existsSync(png), `deep-replica wrote ${png}`).toBe(true);
  mkdirSync(OUT, { recursive: true });
  copyFileSync(png, join(OUT, name));
}

it('the rules page, every rule with what enforces it', async () => {
  execFileSync('cargo', ['build', '--locked', '-q', '-p', 'deep-replica', '--bin', 'deep-replica'], { cwd: REPO, stdio: 'inherit' });
  const w = fixtureWorld({ root: ['never push without asking', 'Run the linter before every commit', FORCE_PUSH], codex: [NPM_TEST] });
  const hub = await startHub(w);
  try {
    expect((await addGuard(w, goodGuard('no-force-push', FORCE_PUSH, 'git push --force'))).code).toBe(0);
    await new Session(w).start();
    { const rules = await syncRules(w); expect(rules.length, `deep rules sync wrote the page:\n  ${show(rules)}`).toBeGreaterThan(0); }
    await shoot(w, 'rules-page.png');
  } finally {
    await stopHub(hub);
  }
}, 900_000);

it('the rules page with a rule whose guard fails its planted call, reading text only', async () => {
  const w = fixtureWorld({ rootOnly: true, root: [FORCE_PUSH, REBASE] });
  const hub = await startHub(w, { plant: 'installs-unchecked' });
  try {
    expect((await addGuard(w, goodGuard('no-force-push', FORCE_PUSH, 'git push --force'))).code).toBe(0);
    expect((await addGuard(w, badGuard('no-rebase-published', REBASE, 'git rebase --onto'))).code).toBe(0);
    await new Session(w).start();
    { const rules = await syncRules(w); expect(rules.length, `deep rules sync wrote the page:\n  ${show(rules)}`).toBeGreaterThan(0); }
    await shoot(w, 'rules-page-text-only.png');
  } finally {
    await stopHub(hub);
  }
}, 900_000);
