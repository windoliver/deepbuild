// The fixture scan (issue #458): no canvas fixture, and no evidence of one, holds a secret, a path of the machine
// that made it, or a name borrowed from another work. It reads every line for secret patterns (the repo's own, as
// scripts/repo-rules.mjs has them), the local paths /Users/, /private/tmp/ and /Volumes/, and the names on the scan's
// list of character and film names, kept as salted hashes in scripts/fixture-names.json and read as the public text
// lane reads its list, so the list names nothing.
//
//   node scripts/fixture-scan.mjs [<path> …]
//
// Given paths, it scans every file under each. With none, it scans every canvas fixture and its evidence: each
// fixture the kit's manifest lists, as the built deep-show answers it, the shipped suite file, the fixture files under
// a fixtures/parity folder, the kit's corpus, the goldens and this suite's evidence. It prints one line per finding,
// `FAIL fixture scan: <file>:<line>: <what>`, and exits 0 only with none; what it can't read is BLOCKED, never clean.
// Never on push or pull request.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matcher } from './studied-names.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const names = matcher(JSON.parse(readFileSync(new URL('./fixture-names.json', import.meta.url), 'utf8')));
const patterns = [
  ['a private key', /-----BEGIN[A-Z0-9 ]* PRIVATE KEY(?: BLOCK)?-----/],
  ['a GitHub token', /gh[pousr]_[A-Za-z0-9]{36}|github_pat_\w{22,}/],
  ['an API key', /(?<![\w-])sk-[\w-]{20,}/],
  ['an AWS access key', /A(?:KI|SI)A[A-Z0-9]{16}/],
  ...['/Users/', '/private/tmp/', '/Volumes/'].map((path) => [`the local path ${path}`, new RegExp(`(?<![\\w.-])${path}`)]),
];

let failed = false;
const say = (state, message) => {
  failed = true;
  console.log(`${state} fixture scan: ${message}`);
};
/** One text's findings, a line at a time. */
function scan(file, text) {
  for (const [index, line] of text.split('\n').entries()) {
    for (const [what, pattern] of patterns) if (pattern.test(line)) say('FAIL', `${file}:${index + 1}: ${what}`);
    for (const name of names.findings(line)) say('FAIL', `${file}:${index + 1}: "${name}", a name on the scan's list of character and film names`);
  }
}
/** A file's text, or null for a binary one. */
function textOf(path) {
  const bytes = readFileSync(path);
  return bytes.includes(0) ? null : bytes.toString('utf8');
}
function walk(path) {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)).flatMap((entry) => walk(join(path, entry.name)));
}

const given = process.argv.slice(2);
let scanned = 0;
if (given.length) {
  for (const path of given) {
    let files;
    try { files = walk(path); } catch (error) {
      say('BLOCKED', `${path} can't be read (${error.code ?? error.message})`);
      continue;
    }
    for (const file of files) {
      const text = textOf(file);
      if (text !== null) scan(file, text);
      scanned += 1;
    }
  }
} else {
  const listed = spawnSync('git', ['ls-files', '-z', '--', 'scripts/parity-suite.json', 'crates/deep-show/kit-corpus', 'tests/goldens', 'docs/evidence/458', ':(glob)**/fixtures/parity/**'], { cwd: root, encoding: 'utf8', maxBuffer: 2 ** 28 });
  if (listed.status !== 0) say('BLOCKED', `git can't list the checkout's fixture files: ${listed.error?.message ?? listed.stderr.trim()}`);
  for (const file of (listed.stdout ?? '').split('\0').filter(Boolean)) {
    const text = textOf(join(root, file));
    if (text !== null) scan(file, text);
    scanned += 1;
  }
  // The kit's fixtures are documents its modules register, so the built binary lists them.
  const evidence = mkdtempSync(join(tmpdir(), 'deep-fixture-scan-'));
  try {
    const run = spawnSync(join(root, process.env.CARGO_TARGET_DIR ?? 'target', 'debug', 'deep-show'), ['run'], { cwd: root, input: `${JSON.stringify({ evidence, calls: [{ call: 'manifest' }] })}\n`, encoding: 'utf8', maxBuffer: 2 ** 30 });
    let fixtures;
    try { fixtures = JSON.parse(run.stdout.split('\n')[0]).replies[0].fixtures; } catch { fixtures = undefined; }
    if (!Array.isArray(fixtures) || !fixtures.length) say('BLOCKED', `deep-show listed no fixture (${run.error?.message ?? `status ${run.status}`}); build it with cargo build --locked --bin deep-show`);
    for (const f of fixtures ?? []) {
      scan(`${f.name} (the kit's manifest)`, JSON.stringify({ document: f.document, sidecar: f.sidecar }, null, 2));
      scanned += 1;
    }
  } finally {
    rmSync(evidence, { recursive: true, force: true });
  }
}
if (!failed) console.log(`fixture scan: ${scanned} file${scanned === 1 ? '' : 's'} and fixtures clean`);
process.exitCode = failed ? 1 : 0;
