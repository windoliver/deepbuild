// #2173 AC2: A dependency a manifest names with no entry still fails the lane,
// naming the manifest and the dependency. All edits below are in a disposable copy.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const manifest = 'crates/deep-app/Cargo.toml';
const section = "target.'cfg(target_os = \"macos\")'.dependencies";
const dependency = 'accesskit_macos';
const config = 'scripts/repo-rules.json';
const script = 'scripts/repo-rules.mjs';
const failure = `FAIL deps: ${manifest} ${section} ${dependency} ^0.26 is not in ${config}`;
const badLines = (out) => out.split('\n').filter((line) => /^(FAIL|INVALID|BLOCKED) /.test(line));

function command(cwd, executable, args) {
  const result = spawnSync(executable, args, {
    cwd, encoding: 'utf8', timeout: 180_000, maxBuffer: 64 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, 'process must finish, not be killed');
  return { status: result.status, out: (result.stdout ?? '') + (result.stderr ?? '') };
}

function missingEntry(result) {
  assert.equal(result.status, 1, 'missing entry must make the public command exit 1');
  assert.deepEqual(badLines(result.out), [failure], 'only the named missing entry may fail');
  assert.doesNotMatch(result.out, /^PASS deps:/m);
}

function clean(result) {
  assert.equal(result.status, 0, 'clean twin must pass ALL checks; unrelated failures are not waived');
  assert.deepEqual(badLines(result.out), []);
  assert.match(result.out, /^PASS deps:/m);
}

test('#2173 AC2: missing entry fails; listed twin passes; ignore-missing mutant is rejected', (t) => {
  const scratch = mkdtempSync(join(tmpdir(), 'repo-rules-2173-ac2-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const files = command(root, 'git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  assert.equal(files.status, 0);
  // Copy files, never hard-link: checker/config mutations cannot reach the live tree.
  // Our own evidence/tests are not inputs to the archived source-tree fixture.
  for (const path of new Set(files.out.split('\0').filter(Boolean))) {
    if (path.startsWith('tests/acceptance/2173/ac2/')) continue;
    mkdirSync(dirname(join(scratch, path)), { recursive: true });
    copyFileSync(join(root, path), join(scratch, path));
  }
  assert.equal(command(scratch, 'git', ['init', '-q']).status, 0);
  const rules = JSON.parse(readFileSync(join(scratch, config), 'utf8'));
  const names = rules.deps[manifest][section];
  assert.match(readFileSync(join(scratch, manifest), 'utf8'), /^accesskit_macos = "0\.26"$/m);
  const save = () => writeFileSync(join(scratch, config), `${JSON.stringify(rules, null, 2)}\n`);
  const run = (label) => {
    const result = command(scratch, process.execPath, [script]);
    const redacted = result.out.replaceAll(scratch, '<scratch>').replaceAll(root, '<source>');
    t.diagnostic(`${label}: node ${script}; exit=${result.status}\n${redacted}`);
    return result;
  };

  delete names[dependency];
  save();
  const negative = run('negative control: declared but unlisted');

  // The sole clean-twin difference is the entry; keep the declaration and every other check.
  // Reason and expected spec come from #2173, not from checker output.
  names[dependency] = {
    spec: '^0.26',
    why: "The window forwards an assistive client's question of what is focused to the view, so the row or control the keys are on is what a screen reader and full keyboard access follow.",
  };
  save();
  const listed = run('clean twin: same dependency listed with its reason');

  // A running wrong program, not a replacement Cargo/physics checker or canned output.
  // Keep metadata, all other dependency validations, and every other lane intact.
  delete names[dependency];
  save();
  const source = readFileSync(join(scratch, script), 'utf8');
  const branch = "if (!allowed.has(key)) report('FAIL', 'deps', `${manifest} ${section} ${name} ${spec} is not in ${config}`, fixes.dep);";
  assert.equal(source.split(branch).length, 2, 'mutation anchor must occur exactly once');
  writeFileSync(join(scratch, script), source.replace(branch, 'if (!allowed.has(key)) continue;'));
  const mutant = run('wrong program: ignores missing entries');

  // Run all three before judging, so a prerequisite is visible rather than silently skipped.
  missingEntry(negative);
  clean(listed);
  clean(mutant); // proves the mutant ran successfully, not that AC2 passed
  assert.throws(() => missingEntry(mutant), /missing entry must make the public command exit 1/);
  t.diagnostic('PASS AC2; wrong program rejected by the SAME missing-entry oracle (exit 0 instead of 1)');
});
