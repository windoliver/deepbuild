// What #3546's blind suite leaves out: a tree with no node_modules, where the pinned tokenizer can't load, as #2338's
// and #1876's suites run these scripts. Tokens are then not counted, never read as 0: `--issue` still prints the text
// and counts its sections and bytes, and the design links lane's reading says so. The real scripts run from a scratch
// folder's own copy of scripts/*.mjs, beside two docs and one open issue.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPTS = fileURLToPath(new URL('../scripts/', import.meta.url));
const SECTION = '## Alpha\n\nAlpha text.\n\n### Beta\n\nBeta text.\n';
const ISSUES = [{ number: 7, body: '**Design:** [Alpha](https://github.com/windoliver/deepbuild/blob/main/docs/technical-design.md#alpha)' }];

/** One run of a script in the scratch folder, with #7 as the open issues. */
function run(t, script, ...args) {
  const root = mkdtempSync(join(tmpdir(), 'deep-uncounted-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const dir of ['docs', 'scripts']) mkdirSync(join(root, dir));
  for (const name of readdirSync(SCRIPTS)) if (name.endsWith('.mjs')) cpSync(join(SCRIPTS, name), join(root, 'scripts', name));
  writeFileSync(join(root, 'docs/technical-design.md'), `# Design\n\nIntro.\n\n${SECTION}`);
  writeFileSync(join(root, 'docs/canvas-primitives.md'), '# Canvas\n\nNothing.\n');
  writeFileSync(join(root, 'issues.json'), JSON.stringify(ISSUES));
  return spawnSync(process.execPath, [join('scripts', script), ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, DEEP_OPEN_ISSUES: join(root, 'issues.json') } });
}

test('--issue without the tokenizer prints the text, counts its sections and bytes, and says tokens are not counted', (t) => {
  const { status, stdout, stderr } = run(t, 'design-section.mjs', '--issue', '7');
  assert.equal(status, 0, stderr);
  assert.equal(stdout, `==> docs/technical-design.md#alpha <==\n${SECTION}`);
  const closing = stderr.trim().split('\n').at(-1);
  assert.match(closing, new RegExp(`\\b1 section, ${Buffer.byteLength(SECTION)} bytes, tokens not counted\\b`), stderr);
  assert.doesNotMatch(closing, /\d tokens/, `a count that wasn't taken reads as a number:\n${stderr}`);
});

test("the design links lane's reading without the tokenizer gives the issues read and says tokens are not counted", (t) => {
  // The lane's verdict on a folder this bare isn't read, only its reading.
  const { stdout, stderr } = run(t, 'design-links.mjs');
  const reading = `${stdout}\n${stderr}`.split('\n').filter((line) => /\bissues read\b/.test(line));
  assert.equal(reading.length, 1, `${stdout}\n${stderr}`);
  assert.match(reading[0], /\b1 issues read; tokens not counted\b/);
  assert.doesNotMatch(reading[0], /\d tokens|\bmedian\b/, `a count that wasn't taken reads as a number:\n${reading[0]}`);
});
