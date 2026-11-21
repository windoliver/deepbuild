// #1872, criteria 1 and 2: scripts/main-watch.mjs and scripts/known-failures-check.mjs each decide a verdict, so an
// edit of either fails the proof guard with no signed approval tag, naming the file, and passes as its own commit under
// a signed tag naming the file. Reached by running this checkout's real `node scripts/proof.mjs guard` in scratch
// repositories, as tests/acceptance/1115/guard.test.mjs runs it (README: The guard). Each file is its own top-level
// test, with no subtests, so each fails at its own assertion (README: Redraft).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { CHECKOUT, expectPassed, expectRefused, guardRepo, KNOWN_CHECK, LONG, MAIN_WATCH, sandbox } from './helpers.mjs';

// Each file as this checkout holds it, and a planted loosening of it: landings never pause; a listed failure never lapses.
// Should the line have moved, any edit will do: a trailing statement that ends the run green.
const plant = (path, from, to) => {
  const text = readFileSync(join(CHECKOUT, path), 'utf8');
  return { path, before: text, after: text.includes(from) ? text.replace(from, to) : `${text}\nprocess.exitCode = 0; // planted for #1872\n` };
};
const FILES = [
  plant(MAIN_WATCH, 'const paused = (state) => Object.values(state.reds ?? {});', 'const paused = () => [];'),
  plant(KNOWN_CHECK, 'const DAYS = 14;', 'const DAYS = 3650;'),
];

for (const { path, before, after } of FILES) {
  test(`#1872.d76cf8af a planted commit that edits ${path} fails the proof guard with no signed approval tag, naming the file`, LONG, async (t) => {
    const scene = guardRepo(sandbox(t), { [path]: before });
    scene.commit({ [path]: after });
    expectRefused(await scene.guard(), `an edit of ${path} with no tag`, [path]);
  });

  test(`#1872.d76cf8af the same edit of ${path} under an unsigned approval tag naming the file fails the guard, naming the file`, LONG, async (t) => {
    const scene = guardRepo(sandbox(t), { [path]: before });
    scene.approve(scene.commit({ [path]: after }), [path], null);
    expectRefused(await scene.guard(), `an edit of ${path} under an unsigned tag`, [path]);
  });

  test(`#1872.b7513f90 the same edit of ${path}, as its own commit under a signed approval tag naming the file, passes the guard`, LONG, async (t) => {
    const scene = guardRepo(sandbox(t), { [path]: before });
    scene.approve(scene.commit({ [path]: after }), [path]);
    expectPassed(await scene.guard(), `an edit of ${path} under a signed tag naming it`, [path]);
  });
}
