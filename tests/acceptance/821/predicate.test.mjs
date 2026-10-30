// AC3: each lane's paths come from the same predicate its script judges by, so a lane can't skip a file its
// script would read as its input; a planted lane whose paths miss a file its script reads fails, naming the lane
// and the file. The surface is the lane script's `inputs` export and runLanes' FAIL line (README: Surfaces).
import assert from 'node:assert/strict';
import test from 'node:test';
import { BASE_FILES, pathLanes, repo, runPlanted, runReal, scriptInputs, stateOf, write } from './helpers.mjs';

// The probe set, and what each named lane's script reads (#112's CONFIG; #684's model, engine, pin and lane script).
const PROBES = {
  'crates/deep-app/AGENTS.md': { 'config eval': 'RUN', 'verdict proofs': 'SKIP' },
  'packages/cli/CLAUDE.md': { 'config eval': 'RUN', 'verdict proofs': 'SKIP' },
  'AGENTS.md': { 'config eval': 'RUN', 'verdict proofs': 'SKIP' },
  'CLAUDE.md': { 'config eval': 'RUN', 'verdict proofs': 'SKIP' },
  'skills/x/SKILL.md': { 'config eval': 'RUN', 'verdict proofs': 'SKIP' },
  '.claude/settings.json': { 'config eval': 'RUN', 'verdict proofs': 'SKIP' },
  '.codex/config.toml': { 'config eval': 'RUN', 'verdict proofs': 'SKIP' },
  'lean-toolchain': { 'config eval': 'SKIP', 'verdict proofs': 'RUN' },
  'scripts/verdict-proofs.mjs': { 'config eval': 'SKIP', 'verdict proofs': 'RUN' },
  'packages/verdicts/src/x.ts': { 'config eval': 'SKIP', 'verdict proofs': 'RUN' },
  'packages/verdicts/model/X.lean': { 'config eval': 'SKIP', 'verdict proofs': 'RUN' },
  'docs/notes.md': { 'config eval': 'SKIP', 'verdict proofs': 'SKIP' },
};
const SCRIPTS = { 'config eval': 'scripts/config-eval.mjs', 'verdict proofs': 'scripts/verdict-proofs.mjs' };

/** A scratch repository whose change touches only `file`: an edit when the base holds it, else a new file. */
function changeOnly(t, file) {
  const cwd = repo(t);
  write(cwd, { [file]: `${BASE_FILES[file] ?? ''}edited for the probe\n` });
  return cwd;
}

// The planted lane's script: it reads AGENTS.md and sub/AGENTS.md, and says so through its inputs export.
const PLANTED_SCRIPT = `import { pathToFileURL } from 'node:url';
/** The files this script reads as its input. */
export const inputs = (file) => file === 'AGENTS.md' || file === 'sub/AGENTS.md';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log('PLANTED RAN');
`;
const PLANTED = 'planted reader';
const planted = (paths) => ({ name: PLANTED, paths, commands: [['node', 'scripts/planted-reader.mjs']], fix: 'Fixture: nothing to fix.' });
function plantedRepo(t, change) {
  const cwd = repo(t, { files: { ...BASE_FILES, 'scripts/planted-reader.mjs': PLANTED_SCRIPT } });
  write(cwd, change);
  return cwd;
}

test('AC3: a planted lane whose paths miss a file its script reads fails, naming the lane and the file', (t) => {
  // Wrong: paths name AGENTS.md only, while the script also reads sub/AGENTS.md, which the change adds.
  const narrow = runPlanted(plantedRepo(t, { 'sub/AGENTS.md': '# Nested rules\n' }), [planted(['AGENTS.md'])]);
  assert.ok(
    narrow.lines.some((l) => l.startsWith('FAIL ') && l.includes(PLANTED) && l.includes('sub/AGENTS.md')),
    `a lane whose paths miss sub/AGENTS.md, which its script reads, must print a FAIL line naming "${PLANTED}" and sub/AGENTS.md:\n${narrow.out}`,
  );
  assert.equal(narrow.status, 1, `that lane must fail the run:\n${narrow.out}`);
  assert.ok(!narrow.lines.some((l) => l.startsWith(`PASS ${PLANTED}`)), `that lane must not pass:\n${narrow.out}`);

  // Twin: paths that agree with the script run the lane on the same change, and it passes.
  const agrees = runPlanted(plantedRepo(t, { 'sub/AGENTS.md': '# Nested rules\n' }), [planted(['AGENTS.md', 'sub/AGENTS.md'])]);
  assert.equal(stateOf(agrees, PLANTED, { stub: false }), 'RUN', agrees.out);
  assert.ok(agrees.lines.includes('PLANTED RAN'), `the agreeing lane's script must run:\n${agrees.out}`);
  assert.ok(agrees.lines.some((l) => l.startsWith(`PASS ${PLANTED}`)), agrees.out);
  assert.ok(!agrees.lines.some((l) => l.startsWith('FAIL ')), `paths that agree with the script must not fail:\n${agrees.out}`);
  assert.equal(agrees.status, 0, agrees.out);

  // Twin: the agreeing lane still skips a change its script doesn't read, with no FAIL.
  const unread = runPlanted(plantedRepo(t, { 'docs/notes.md': 'Notes, edited.\n' }), [planted(['AGENTS.md', 'sub/AGENTS.md'])]);
  assert.equal(stateOf(unread, PLANTED, { stub: false }), 'SKIP', unread.out);
  assert.ok(!unread.lines.some((l) => l.startsWith('FAIL ')), `a skip of a file the script doesn't read must not fail:\n${unread.out}`);
  assert.equal(unread.status, 0, unread.out);
});

test('AC3: on the probe set, config eval and verdict proofs run exactly for the files their scripts read', (t) => {
  const got = {};
  for (const file of Object.keys(PROBES)) {
    const r = runReal(changeOnly(t, file), Object.keys(SCRIPTS));
    got[file] = Object.fromEntries(Object.keys(SCRIPTS).map((lane) => [lane, stateOf(r, lane)]));
  }
  assert.deepEqual(got, PROBES, 'each lane must RUN for a change to a file its script reads and SKIP for one it never reads');
});

test('AC3: each lane script exports the inputs predicate it judges by, and every lane with paths agrees with it', (t) => {
  const probes = Object.keys(PROBES);
  // The two named scripts say they read exactly what the issue and #112/#684 say.
  for (const [lane, script] of Object.entries(SCRIPTS)) {
    const said = scriptInputs(t, script, probes);
    assert.ok(!said.error, `${script} (the ${lane} lane's script) must export inputs, a (file) => boolean predicate: ${said.error}`);
    assert.deepEqual(said.inputs, Object.fromEntries(probes.map((f) => [f, PROBES[f][lane] === 'RUN'])), `${script}'s inputs`);
  }
  // Every lane in checks with paths, named here or not, runs exactly where its script's inputs say.
  const lanes = pathLanes(t);
  assert.ok(lanes.length >= 2, `checks must still hold the path-gated lanes: ${JSON.stringify(lanes)}`);
  const reads = {};
  for (const { name, script } of lanes) {
    assert.ok(script, `the lane ${name} has paths but runs no scripts/<name>.mjs whose inputs it could come from`);
    const said = scriptInputs(t, script, probes);
    assert.ok(!said.error, `${script} (the ${name} lane's script) must export inputs: ${said.error}`);
    reads[name] = said.inputs;
  }
  const mismatches = [];
  for (const file of probes) {
    const r = runReal(changeOnly(t, file), lanes.map((l) => l.name));
    for (const { name } of lanes) {
      const state = stateOf(r, name);
      if ((state === 'RUN') !== reads[name][file]) mismatches.push(`${name} ${state} on ${file}, whose script ${reads[name][file] ? 'reads' : "doesn't read"} it`);
    }
  }
  assert.deepEqual(mismatches, []);
});

