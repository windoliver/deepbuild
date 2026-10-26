// #316 AC8: with ~/.claude/settings.json a symlink to a dotfiles file, an agent's Edit of that target, a sed -i
// that reaches it through `..`, and a Write through a fresh symlink that points at it are each denied with the
// hub stopped, naming deep_propose, because each path is matched after `..` and symlinks are resolved, against
// each config file's own path and the file it links to. A matcher that matches only the listed paths as written
// (the plant plant-paths-as-written) allows all three and fails this test, naming the first path it let through.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  bash, buildDeepHook, carriesReasonNextStep, cleanup, decision, denialText, edit, hook, installDefaults, link,
  makeHome, newSession, shown, write, type Line, type Ran, type Rules,
} from './helpers.ts';

let REAL: string;
let PLANT: string;
beforeAll(async () => {
  REAL = await buildDeepHook();
  // The plant is code the implementer writes; if its feature is absent (the base), the build fails and this
  // suite's wrong-program test fails rather than passing.
  PLANT = await buildDeepHook({ features: ['plant-paths-as-written'] }).catch((e: Error) => e.message);
}, 900_000);
afterEach(cleanup, 60_000);

/**
 * A home whose ~/.claude/settings.json links to a dotfiles file, with a second symlink pointing at the same file.
 * dotfiles and the extra symlink are siblings of the home folder, so `../dotfiles/claude.json` from HOME resolves
 * to the linked target.
 */
interface World { home: string; rules: Rules; session: ReturnType<typeof newSession>; target: string; viaLink: string }
function world(): World {
  const home = makeHome();
  const rules = installDefaults(home);
  const parent = dirname(home);                      // the test's temp folder; home is <parent>/h
  const target = join(parent, 'dotfiles', 'claude.json');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, '{}');
  link(target, join(home, '.claude', 'settings.json'));   // ~/.claude/settings.json -> the dotfiles file
  const viaLink = join(parent, 's');                 // a fresh symlink (a /tmp/s-style link) pointing at it
  link(target, viaLink);
  const session = newSession(home, home);            // payload cwd = HOME
  return { home, rules, session, target, viaLink };
}
/** The three writes that each reach the linked target, with the labels the plant must be caught naming. */
function reaches(w: World): { label: string; body: Line }[] {
  return [
    { label: w.target, body: edit(w.session, w.target) },                          // Edit of the linked target
    { label: '../dotfiles/claude.json', body: bash(w.session, 'sed -i s/a/b/ ../dotfiles/claude.json') }, // through ..
    { label: w.viaLink, body: write(w.session, w.viaLink) },                        // Write through the fresh symlink
  ];
}
async function run(binary: string, w: World, body: Line): Promise<Ran> {
  return hook(w.home, w.session, 'PreToolUse', body, { binary, cwd: w.session.cwd });
}
/** Throws at the first write the binary let through, naming its path; returns on an all-denied run. */
async function judge(binary: string, w: World): Promise<void> {
  for (const { label, body } of reaches(w)) {
    const ran = await run(binary, w, body);
    if (decision(ran) !== 'deny') throw Error(`the write to ${label} reached the linked config and must be denied: ${shown(ran)}`);
    if (!carriesReasonNextStep(ran, w.rules)) throw Error(`the write to ${label}: the denial carries no default entry's reason and next_step: ${shown(ran)}`);
    if (!denialText(ran).includes('deep_propose')) throw Error(`the write to ${label}: the denial does not name deep_propose: ${shown(ran)}`);
  }
}

describe('AC8 #316.9404dfdb a symlinked config, its target, a .. path and a write through a fresh symlink are each denied naming deep_propose; a paths-as-written matcher fails', () => {
  it('AC8 the real matcher denies all three reaches of the linked config, each naming deep_propose; an ordinary write is allowed', async () => {
    const w = world();
    await judge(REAL, w);
    const ok = await run(REAL, w, write(w.session, join(w.home, 'work', 'x.md')));
    if (decision(ok) !== 'allow') throw Error(`an ordinary write far from any config must be allowed: ${shown(ok)}`);
  }, 900_000);

  it('AC8 (wrong program) a matcher that matches only the listed paths as written lets all three through and fails, naming the path', async () => {
    if (!PLANT.startsWith('/')) throw Error(`the plant plant-paths-as-written did not build: ${PLANT}`);
    const w = world();
    await expect(judge(PLANT, w)).rejects.toThrow(/must be denied|does not name/);
  }, 900_000);
});
