// AC3 #2697.09d255e9: "The guide and the skill's line are generated from one source,
// `crates/deep-canvas/src/craft.json`: a check added there shows in the guide with no edit to the skill, and
// `tests/acceptance/26/` finds no drift"
//
// asserts, first test: in a copy of the checkout (every file but .git, target, node_modules and tests/acceptance/,
// README: The copy), a seventeenth check, `reveal_hold`, is added to craft.json's checks, and the skill's generator,
// `node scripts/skill.mjs`, runs as it does today. The copy's skills/deepbuild/SKILL.md is then byte for byte the
// checkout's: no edit to the skill, and none needed. The copy's guide, named by the copy's skill as AC2 reads it, states
// reveal_hold with its description, threshold and fix after its name, and still states the sixteen. The copy's guide is
// read through deep_kinds: from the copy's gallery folder (the scenario's `gallery`) when the generator wrote it there,
// else from deep-show built in the copy (README: The copy).
// Second test: the checkout's skill is what `generate()` gives, byte for byte, its craft line names the guide, and
// tests/acceptance/26/'s drift test (#26.2d751e6d in tools.test.ts) passes, run as its README runs it.
// Wrong programs: the merge base (no guide), a guide written by hand or from another source (the added check never
// shows), a skill that lists each check (it changes when one is added), and a craft line that names a tool's parameter
// (26's drift test fails it).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  AC, REPO, SKILL, TIMEOUT, baseChecks, buildShow, checkoutCopy, clonedTarget, generatedSkill, guideFailures, guideName, guideText, isObject, none,
  normalize, runGenerator, sameFailures, show, useCleanup, useShow, type Check, type JsonObject,
} from './helpers.ts';

const bin = useShow();
useCleanup();

/** The check the test adds to craft.json: its own words, which nothing else in the checkout holds. */
const ADDED: Check & { defaults: JsonObject } = {
  name: 'reveal_hold',
  defaults: { min: 1.5 },
  description: 'After a shot that reveals the subject, the next shot holds at least min seconds before it cuts (added by the #2697 acceptance test).',
  threshold: 'min 1.5 s after a reveal',
  fix: 'Hold the shot after the reveal for at least 1.5 s, or cut the reveal later.',
};

describe(`${AC.source} the guide and the skill's line come from craft.json alone`, () => {
  it(`${AC.source} a check added to craft.json shows in the guide, with its description, threshold and fix, and the skill is unchanged`, () => {
    const b = bin();
    const skill = readFileSync(SKILL, 'utf8');
    const named = guideName(b, skill);
    expect(named.failure, 'the skill\'s craft line names the guide deep_kinds serves').toBeUndefined();
    const before = guideText(b, named.name!);
    expect(before.failure, `deep_kinds read guide: ${named.name}`).toBeUndefined();
    expect(normalize(before.text).includes(normalize(ADDED.description)), 'the checkout\'s guide doesn\'t already hold the added check').toBe(false);

    const copy = checkoutCopy();
    const craftFile = join(copy, 'crates/deep-canvas/src/craft.json');
    const craft = JSON.parse(readFileSync(craftFile, 'utf8')) as JsonObject;
    expect(Array.isArray(craft['checks']), `craft.json holds a list of checks: ${show(craft, 300)}`).toBe(true);
    (craft['checks'] as JsonObject[]).push({ name: ADDED.name, defaults: ADDED.defaults, description: ADDED.description, threshold: ADDED.threshold, fix: ADDED.fix });
    writeFileSync(craftFile, `${JSON.stringify(craft, null, 2)}\n`);
    const generated = runGenerator(copy);
    expect(generated, 'the skill\'s generator runs in the copy').toBeUndefined();
    none(sameFailures(skill, readFileSync(join(copy, 'skills/deepbuild/SKILL.md'), 'utf8'), 'the checkout\'s skill and the copy\'s, regenerated with a check added to craft.json,'), 'a check added to craft.json needs no edit to the skill');

    // The copy's guide: from its gallery folder when the generator wrote the guide there, else from deep-show built in the copy.
    const gallery = join(copy, 'crates/deep-show/gallery');
    let index: unknown;
    try { index = JSON.parse(readFileSync(join(gallery, 'gallery.json'), 'utf8')); } catch { index = undefined; }
    const entry = isObject(index) && Array.isArray(index['guides']) ? index['guides'].filter(isObject).find((g) => g['name'] === named.name) : undefined;
    let file = '';
    try { file = typeof entry?.['file'] === 'string' ? readFileSync(join(gallery, entry['file']), 'utf8') : ''; } catch { file = ''; }
    let guide: { text: string; failure?: string };
    if (normalize(file).includes(normalize(ADDED.description))) {
      console.log(`the generator wrote the guide into the copy's gallery (${String(entry!['file'])}): read from that folder`);
      const again = guideName(b, readFileSync(join(copy, 'skills/deepbuild/SKILL.md'), 'utf8'), gallery);
      expect(again.failure, 'the copy\'s skill names the guide its gallery serves').toBeUndefined();
      guide = guideText(b, again.name!, gallery);
    } else {
      console.log('the copy\'s gallery holds no guide with the added check: deep-show is built in the copy');
      const built = buildShow(copy, { CARGO_TARGET_DIR: clonedTarget(copy) });
      expect(built.error, 'deep-show builds in the copy').toBe('');
      const again = guideName(built.bin, readFileSync(join(copy, 'skills/deepbuild/SKILL.md'), 'utf8'));
      expect(again.failure, 'the copy\'s skill names the guide its deep-show serves').toBeUndefined();
      guide = guideText(built.bin, again.name!);
    }
    expect(guide.failure, 'deep_kinds reads the copy\'s guide').toBeUndefined();
    none(guideFailures(guide.text, [ADDED, ...baseChecks()]), `the copy's guide, with ${ADDED.name} added to craft.json`);
  }, 3 * TIMEOUT);

  it(`${AC.source} the skill is what its generator gives, its craft line names the guide, and tests/acceptance/26/ finds no drift`, () => {
    const b = bin();
    const skill = readFileSync(SKILL, 'utf8');
    const named = guideName(b, skill);
    expect(named.failure, 'the skill\'s craft line names the guide deep_kinds serves').toBeUndefined();
    const generated = generatedSkill(REPO);
    expect(generated.failure, 'scripts/skill.mjs generates the skill').toBeUndefined();
    none(sameFailures(generated.text, skill, 'the generated skill and skills/deepbuild/SKILL.md'), 'the checkout\'s skill is its generator\'s, byte for byte');

    // #26's drift test, as tests/acceptance/26/README.md runs it (from the checkout's root, the workspaces built).
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('VITEST') && k !== 'NODE_OPTIONS'));
    const args = [join(REPO, 'node_modules/vitest/vitest.mjs'), 'run', 'tests/acceptance/26/tools.test.ts', '-t', '2d751e6d', '--reporter=verbose'];
    const r = spawnSync(process.execPath, args, { cwd: REPO, encoding: 'utf8', env: { ...env, NO_COLOR: '1' }, maxBuffer: 256 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    expect(r.status, `tests/acceptance/26/'s drift test passes (exit ${r.status}, ${r.signal ?? 'no signal'}):\n${out.slice(-5000)}`).toBe(0);
    expect(/✓[^\n]*#26\.2d751e6d/.test(out), `the drift test #26.2d751e6d ran and passed, not skipped:\n${out.slice(-3000)}`).toBe(true);
  }, TIMEOUT);
});
