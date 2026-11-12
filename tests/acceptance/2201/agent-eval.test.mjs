// #2201 acceptance: tests/agent-eval.test.mjs passes on main, its recorded run listing the tools read from
// packages/hub/tools.json. Written first and blind (README.md). Each test runs the real files as child processes: the
// test file by the issue's command, the scorer by its own. Nothing here imports the code under test, and every
// failure is an assertion in this file that carries the child's exit code and output.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// The checkout this file is in, never the working folder.
const ROOT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const TEST = 'tests/agent-eval.test.mjs';
const SCORER = 'scripts/agent-eval.mjs';
const SKILL = 'skills/deepbuild/SKILL.md';
const TOOLS = 'packages/hub/tools.json';
const PACKAGE = 'packages/hub/package.json';
const RECORDED = 'tests/acceptance/26/fixtures/eval/run.json';

/**
 * Runs node in `folder` and waits for it. The child is no part of the runner that runs this file, so it must not
 * report to it. Its output has the folder's path cut out, and `shown` quotes each line, so none reads as a frame of
 * this file's own stack.
 */
function node(folder, args) {
  const env = { ...process.env, NO_COLOR: '1' };
  delete env.NODE_TEST_CONTEXT;
  delete env.FORCE_COLOR;
  const result = spawnSync(process.execPath, args, { cwd: folder, env, encoding: 'utf8', timeout: 60_000 });
  const plain = (text) => String(text ?? '').replaceAll(folder, folder === ROOT ? '<checkout>' : '<copy>');
  const stdout = plain(result.stdout);
  const output = `${stdout}${plain(result.stderr)}`;
  const shown = [`$ node ${args.join(' ')}`, `exit ${result.status ?? result.signal ?? result.error?.code}`, ...output.trimEnd().split('\n').map((line) => `  | ${line}`.trimEnd())].join('\n');
  return { status: result.status, stdout, output, shown };
}

/** Holds a run of the test file to a pass: exit 0, with a test that ran and passed and none skipped or left to do. */
function passes(run, what) {
  assert.equal(run.status, 0, `${what}\n${run.shown}`);
  const count = (word) => Number(new RegExp(`^\\S+ ${word} (\\d+)$`, 'm').exec(run.output)?.[1]);
  assert.ok(count('pass') >= 1 && count('skipped') === 0 && count('todo') === 0, `${what}: it exits 0 with no test that ran and passed, or with one skipped\n${run.shown}`);
}

/** The files the test reads, copied byte for byte into a temporary folder that is removed when the test ends. */
function copyOf(t) {
  const copy = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2201-')));
  t.after(() => rmSync(copy, { recursive: true, force: true }));
  for (const path of [TEST, SCORER, SKILL, TOOLS, PACKAGE, RECORDED]) {
    assert.ok(existsSync(join(ROOT, path)), `the checkout has no ${path}`);
    cpSync(join(ROOT, path), join(copy, path));
  }
  return copy;
}

test('#2201.85a64726 node --test tests/agent-eval.test.mjs passes in the checkout: it exits 0 with a test that ran and passed, none skipped', () => {
  passes(node(ROOT, ['--test', TEST]), `node --test ${TEST} does not pass in the checkout`);
});

test('#2201.e1d48ffc a skill pinned to another version fails the recorded run for the pin alone, naming both versions, and the test asserts it: on a scorer that ignores the pin the test fails, naming both', (t) => {
  const copy = copyOf(t);
  // The installed version is whatever the package says now; the other one is any that differs from it.
  const { version } = JSON.parse(readFileSync(join(copy, PACKAGE), 'utf8'));
  const other = version === '9.9.9' ? '8.8.8' : '9.9.9';
  const skill = readFileSync(join(copy, SKILL), 'utf8');
  const pinned = skill.replace(/^version: .*$/m, `version: ${other}`);
  assert.notEqual(pinned, skill, `${SKILL} has no version line to pin to ${other}`);

  // The run the test scores (the issue's Scope): #26's recorded run, the skill as its text, and as its tools the
  // ones tools.json names. With the skill pinned elsewhere, the scorer's own command fails it for the pin alone.
  const run = JSON.parse(readFileSync(join(copy, RECORDED), 'utf8'));
  run.skill.text = pinned;
  run.tools = Object.keys(JSON.parse(readFileSync(join(copy, TOOLS), 'utf8'))).map((name) => ({ name }));
  writeFileSync(join(copy, 'run.json'), JSON.stringify(run));
  const scored = node(copy, [SCORER, 'score', 'run.json']);
  let verdict;
  try {
    verdict = JSON.parse(scored.stdout.trim().split('\n').at(-1));
  } catch {
    // No verdict line: judged below, as a run that printed none.
  }
  assert.deepEqual({ exit: scored.status, outcome: verdict?.outcome, reasons: verdict?.reasons },
    { exit: 1, outcome: 'FAIL', reasons: [{ code: 'skill_version_mismatch', detail: `the skill is pinned to ${other}, not the installed ${version}` }] },
    `the recorded run with its skill pinned to ${other}, where ${version} is installed, should fail for the pin alone, naming both versions\n${scored.shown}`);

  // The test's second half asserts that. Planted here: the checkout's own scorer with the pin's reason left out. On
  // it the test must fail, and what it says it expected must name a pinned version and the installed one.
  const kept = 'agent-eval.whole.mjs';
  renameSync(join(copy, SCORER), join(copy, 'scripts', kept));
  writeFileSync(join(copy, SCORER), `import { score as whole } from './${kept}';\nexport const score = (run) => whole(run).filter((reason) => reason.code !== 'skill_version_mismatch');\n`);
  const blind = node(copy, ['--test', TEST]);
  assert.notEqual(blind.status, 0, `on a scorer that ignores the pin, ${TEST} passes, so it asserts nothing of a skill pinned to another version\n${blind.shown}`);
  const [, stale, installed] = /the skill is pinned to ([^\s,'"`]+), not the installed ([^\s,'"`]+)/.exec(blind.output) ?? [];
  assert.ok(stale && stale !== version && installed === version, `on a scorer that ignores the pin, ${TEST} fails without naming both versions, a pinned one and the installed ${version}: its second half asserted nothing\n${blind.shown}`);
});

test('#2201.e938bd0d a tool added to the skill alone still fails the test as a mismatch that names it; added to packages/hub/tools.json too, the unedited test passes', (t) => {
  const copy = copyOf(t);
  const tools = JSON.parse(readFileSync(join(copy, TOOLS), 'utf8'));
  // A made-up tool the scorer reads as one (deep_, then lower-case letters and underscores) that neither file names.
  let tool = 'deep_made_up';
  while (tool in tools || readFileSync(join(copy, SKILL), 'utf8').includes(tool)) tool += '_x';

  // The Scope's second bullet: a skill that names a tool the session's list lacks is still a mismatch.
  appendFileSync(join(copy, SKILL), `\n## A block made up for this test\n\n- ${tool}. A tool made up for this test.\n`);
  const alone = node(copy, ['--test', TEST]);
  assert.ok(alone.status !== 0 && alone.output.includes(`the skill names ${tool}, which the live tool list lacks`),
    `with ${tool} added to ${SKILL} alone, ${TEST} should fail, saying the skill names ${tool}, which the live tool list lacks\n${alone.shown}`);

  // The criterion: added to the tool list too, the test passes as the checkout holds it, with no edit.
  tools[tool] = 'A tool made up for this test.';
  writeFileSync(join(copy, TOOLS), `${JSON.stringify(tools, null, 2)}\n`);
  passes(node(copy, ['--test', TEST]), `with ${tool} added to ${TOOLS} and ${SKILL}, ${TEST} as the checkout holds it does not pass`);
});
