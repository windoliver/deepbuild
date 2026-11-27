// Acceptance tests for #2818: scripts/known-failures-record.mjs records persistent failures on main across vitest,
// node --test and cargo (directly or from resumable preflight kept logs), leaves scripts/affected.mjs --record
// untouched (#1872), separates flaky failures into INCONCLUSIVE `Flaky:` issues like scripts/main-watch.mjs, drops
// passing/renamed/deleted entries, passes scripts/known-failures-check.mjs, and prints exact Approves: lines that
// satisfy scripts/proof.mjs guard.
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { APPROVERS, people, tag } from '../../fixtures/approver.mjs';

const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const KNOWN = 'scripts/known-failures.json';
const LONG = { timeout: 300_000 };
const ENV_OUT = ['DEEP_THROTTLE', 'DEEP_PERF_LOCK', 'NODE_TEST_CONTEXT', 'DEEP_PREFLIGHT', 'DEEP_OPEN_ISSUES', 'CARGO_TARGET_DIR', 'DEEP_PROOF_ISSUES', 'DEEP_APPROVERS', 'DEEP_PROOF_VITEST_REPORT', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE'];
const today = () => new Date().toISOString().slice(0, 10);

const STUB_GH = `#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.env.STUB_GH_DIR;
mkdirSync(dir, { recursive: true });
const args = process.argv.slice(2);
appendFileSync(join(dir, 'calls.jsonl'), JSON.stringify(args) + '\\n');
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const all = () => readdirSync(dir).filter((f) => /^\\d+\\.json$/.test(f)).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8'))).sort((a, b) => a.number - b.number);
if (args[0] === 'issue' && args[1] === 'list') {
  const state = (flag('--state') ?? 'open').toLowerCase();
  const fields = (flag('--json') ?? 'number,title,body,state').split(',');
  const list = all().filter((it) => state === 'all' || it.state.toLowerCase() === state).map((it) => Object.fromEntries(fields.map((k) => [k, it[k]])));
  process.stdout.write(JSON.stringify(list) + '\\n');
} else if (args[0] === 'issue' && args[1] === 'view') {
  const num = Number(args[2]);
  const file = join(dir, num + '.json');
  if (!existsSync(file)) { process.stderr.write('not found\\n'); process.exit(1); }
  const it = JSON.parse(readFileSync(file, 'utf8'));
  const q = flag('-q');
  if (q === '.state') process.stdout.write(it.state + '\\n');
  else if (q === '.body') process.stdout.write((it.body ?? '') + '\\n');
  else process.stdout.write(JSON.stringify(it) + '\\n');
} else if (args[0] === 'issue' && args[1] === 'create') {
  const existing = all();
  const num = Math.max(9900, ...existing.map((it) => it.number)) + 1;
  const it = { number: num, title: flag('--title') ?? '', body: flag('--body') ?? '', state: 'OPEN' };
  writeFileSync(join(dir, num + '.json'), JSON.stringify(it, null, 2));
  process.stdout.write('https://github.com/example/fixture/issues/' + num + '\\n');
} else {
  process.stderr.write('unsupported gh call: ' + args.join(' ') + '\\n');
  process.exit(1);
}
`;

const STUB_CARGO = `#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const args = process.argv.slice(2);
const cwd = process.cwd();
const cratesDir = join(cwd, 'crates');
const pkgs = existsSync(cratesDir) ? readdirSync(cratesDir).filter((d) => existsSync(join(cratesDir, d, 'Cargo.toml'))).map((d) => {
  const toml = readFileSync(join(cratesDir, d, 'Cargo.toml'), 'utf8');
  const name = toml.match(/^name = "(.+)"$/m)?.[1] ?? d;
  return { name, manifest_path: resolve(cratesDir, d, 'Cargo.toml'), dependencies: [], targets: [{ name: name.replaceAll('-', '_'), kind: ['lib'], src_path: resolve(cratesDir, d, 'src/lib.rs') }] };
}) : [];
if (args[0] === 'metadata') {
  process.stdout.write(JSON.stringify({ packages: pkgs, workspace_members: pkgs.map((p) => p.name), version: 1 }) + '\\n');
  process.exit(0);
}
if (args[0] === 'test') {
  const p = args.indexOf('-p');
  const selected = p >= 0 ? pkgs.filter((pkg) => pkg.name === args[p + 1]) : pkgs;
  const sep = args.indexOf('--');
  const exact = sep >= 0 ? args.slice(sep + 1).filter((a) => a !== '--exact') : [];
  let failed = 0;
  for (const pkg of selected) {
    const ident = pkg.name.replaceAll('-', '_');
    const tests = [
      { name: 'tests::passes', ok: true },
      { name: 'tests::fails_on_main', ok: false, msg: 'assertion failed: main broke' },
    ].filter((t) => !exact.length || exact.includes(t.name));
    process.stdout.write(\`     Running unittests src/lib.rs (target/debug/deps/\${ident}-0123456789abcdef)\\n\\nrunning \${tests.length} tests\\n\`);
    const bad = [];
    for (const t of tests) {
      process.stdout.write(\`test \${t.name} ... \${t.ok ? 'ok' : 'FAILED'}\\n\`);
      if (!t.ok) { bad.push(t); failed++; }
    }
    if (bad.length) {
      process.stdout.write('\\nfailures:\\n\\n');
      for (const t of bad) process.stdout.write(\`---- \${t.name} stdout ----\\nthread '\${t.name}' panicked at crates/\${pkg.name}/src/lib.rs:5:9:\\n\${t.msg}\\n\`);
      process.stdout.write('\\nfailures:\\n' + bad.map((t) => \`    \${t.name}\`).join('\\n') + '\\n');
    }
    process.stdout.write(\`\\ntest result: \${bad.length ? 'FAILED' : 'ok'}. \${tests.length - bad.length} passed; \${bad.length} failed; 0 ignored; 0 measured; 0 filtered out\\n\`);
  }
  process.exit(failed ? 101 : 0);
}
process.exit(0);
`;

const STUB_DEEP = `#!/bin/sh
if [ "\${1:-}" = "lease" ] && [ "\${2:-}" = "--" ]; then shift 2; exec "$@"; fi
exit 0
`;

const VITEST_CONFIG = `import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/**/*.test.ts'] } });
`;

function sandbox(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2818-')));
  const home = join(dir, 'home');
  const bin = join(dir, 'bin');
  const ghDir = join(dir, 'gh');
  mkdirSync(home);
  mkdirSync(bin);
  mkdirSync(ghDir);
  for (const [name, body] of [['gh', STUB_GH], ['cargo', STUB_CARGO], ['deep', STUB_DEEP]]) {
    writeFileSync(join(bin, name), body);
    chmodSync(join(bin, name), 0o755);
  }
  const env = { ...process.env, HOME: home, XDG_CACHE_HOME: join(home, '.cache'), TZ: 'UTC', STUB_GH_DIR: ghDir, PATH: `${bin}${delimiter}${process.env.PATH}` };
  for (const name of ENV_OUT) delete env[name];
  const box = { dir, home, bin, ghDir, env, children: [] };
  t.after(() => {
    for (const child of box.children) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
    }
    rmSync(dir, { recursive: true, force: true });
  });
  return box;
}

function run(box, argv, { cwd = box.dir, env = {} } = {}) {
  const child = spawn(argv[0], argv.slice(1), { cwd, env: { ...box.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let stdout = '', stderr = '';
  child.stdout.on('data', (c) => { stdout += c; });
  child.stderr.on('data', (c) => { stderr += c; });
  return new Promise((resolve) => child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr })));
}

const gitIn = (cwd, env) => (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, env, stdio: 'pipe', encoding: 'utf8' });

function writeFiles(cwd, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
  }
}

function stubLintScripts(cwd) {
  const code = `const lanes = await import(${JSON.stringify(pathToFileURL(join(cwd, 'scripts/lanes.mjs')).href)});
    const lint = lanes.checks.find(({ name }) => name === 'lint').commands.map(([, s]) => s).filter((s) => /^scripts\\/[^/]+\\.mjs$/.test(s ?? ''));
    console.log(JSON.stringify(lint));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  for (const script of JSON.parse(r.stdout.trim().split('\n').at(-1))) {
    if (script !== 'scripts/known-failures-check.mjs') writeFileSync(join(cwd, script), '// stubbed lint\n');
  }
}

function fixtureRepo(box, files, known) {
  const cwd = join(box.dir, 'repo');
  const bare = join(box.dir, 'origin.git');
  mkdirSync(cwd);
  mkdirSync(bare);
  cpSync(join(CHECKOUT, 'scripts'), join(cwd, 'scripts'), { recursive: true });
  stubLintScripts(cwd);
  mkdirSync(join(cwd, 'node_modules'));
  for (const entry of readdirSync(join(CHECKOUT, 'node_modules')).filter((e) => !e.startsWith('.vite'))) {
    symlinkSync(join(CHECKOUT, 'node_modules', entry), join(cwd, 'node_modules', entry));
  }
  const keys = people();
  writeFiles(cwd, {
    '.gitignore': 'node_modules\n',
    'vitest.config.mjs': VITEST_CONFIG,
    [APPROVERS]: keys.list,
    [KNOWN]: `${JSON.stringify({ failures: {}, lint: {}, lintIssues: {}, timing: [], timingIssues: {}, skips: [], ...known }, null, 2)}\n`,
    ...files,
  });
  const git = gitIn(cwd, box.env);
  gitIn(bare, box.env)('init', '-q', '--bare', '-b', 'main');
  git('init', '-q', '-b', 'main');
  git('remote', 'add', 'origin', bare);
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('push', '-q', 'origin', 'main');
  const head = git('rev-parse', 'HEAD').trim();
  return { cwd, head, git, keys };
}

const readIssues = (box) => readdirSync(box.ghDir).filter((f) => /^\d+\.json$/.test(f)).map((f) => JSON.parse(readFileSync(join(box.ghDir, f), 'utf8')));
const seedIssue = (box, issue) => writeFileSync(join(box.ghDir, `${issue.number}.json`), JSON.stringify(issue, null, 2));
const dump = (r) => `exit ${r.status}\nstdout:\n${r.stdout.slice(-3000)}\nstderr:\n${r.stderr.slice(-1500)}`;

test('#2818.c386fb21 records vitest, node and cargo failures with head, open issue and date, drops passing/renamed/deleted, preserves skips and unrun, and passes known-failures-check', LONG, async (t) => {
  const box = sandbox(t);
  seedIssue(box, { number: 9801, title: 'Untouched open issue', body: 'still open', state: 'OPEN' });
  const skipEntry = { id: 'tests/fixture-2818/untouched.test.mjs › untouched passes', note: '', reason: 'kept skip' };
  const { cwd, head } = fixtureRepo(box, {
    'tests/fixture-2818/sample.test.ts': `import { expect, test } from 'vitest';
test('vitest passes', () => { expect(1).toBe(1); });
test('vitest fails', () => { expect(1).toBe(2); });\n`,
    'tests/fixture-2818/sample.test.mjs': `import assert from 'node:assert/strict';
import test from 'node:test';
test('passes now', () => { assert.equal(1, 1); });
test('node fails', () => { assert.equal(1, 2); });\n`,
    'tests/fixture-2818/untouched.test.mjs': `import assert from 'node:assert/strict';
import test from 'node:test';
test('untouched passes', () => { assert.equal(1, 1); });\n`,
    'crates/fixture-2818/Cargo.toml': '[package]\nname = "fixture-2818"\nversion = "0.1.0"\nedition = "2021"\n',
    'crates/fixture-2818/src/lib.rs': '// fixture crate\n',
  }, {
    failures: {
      'tests/fixture-2818/sample.test.mjs › passes now': `fails on main 0000000: old (#9801, added ${today()})`,
      'tests/fixture-2818/sample.test.mjs › renamed away': `fails on main 0000000: old (#9801, added ${today()})`,
      'tests/fixture-2818/deleted.test.mjs › gone': `fails on main 0000000: old (#9801, added ${today()})`,
      'tests/fixture-2818/untouched.test.mjs › untouched fails': `fails on main 0000000: still there (#9801, added ${today()})`,
    },
    skips: [skipEntry],
  });

  // #1872 stays intact: affected.mjs --record must leave known-failures.json byte-for-byte unchanged.
  const beforeAffected = readFileSync(join(cwd, KNOWN));
  await run(box, [process.execPath, 'scripts/affected.mjs', '--record', 'tests/fixture-2818/sample.test.mjs'], { cwd });
  assert.ok(readFileSync(join(cwd, KNOWN)).equals(beforeAffected), 'affected.mjs --record must not modify known-failures.json (#1872)');

  const paths = ['tests/fixture-2818/sample.test.ts', 'tests/fixture-2818/sample.test.mjs', 'crates/fixture-2818/src/lib.rs'];
  const first = await run(box, [process.execPath, 'scripts/known-failures-record.mjs', ...paths], { cwd });
  assert.equal(first.status, 0, dump(first));

  const recorded = JSON.parse(readFileSync(join(cwd, KNOWN), 'utf8'));
  const expectedIds = [
    'cargo -p fixture-2818 --lib › tests::fails_on_main',
    'tests/fixture-2818/sample.test.mjs › node fails',
    'tests/fixture-2818/sample.test.ts › vitest fails',
    'tests/fixture-2818/untouched.test.mjs › untouched fails',
  ];
  assert.deepEqual(Object.keys(recorded.failures).sort(), expectedIds, `wrong failure keys:\n${JSON.stringify(recorded.failures, null, 2)}`);
  assert.deepEqual(recorded.skips, [skipEntry], 'skips must be preserved untouched');

  const issues = new Map(readIssues(box).map((it) => [it.number, it]));
  for (const id of expectedIds.filter((k) => !k.includes('untouched'))) {
    const note = recorded.failures[id];
    assert.ok(note.includes(head.slice(0, 7)), `note for ${id} lacks head ${head.slice(0, 10)}: ${note}`);
    const match = note.match(/\(#(\d+), added (\d{4}-\d{2}-\d{2})\)$/);
    assert.ok(match, `note for ${id} lacks (#issue, added date): ${note}`);
    assert.equal(match[2], today());
    const issue = issues.get(Number(match[1]));
    assert.equal(issue?.state, 'OPEN', `issue #${match[1]} must be OPEN`);
    const target = id.split(' › ')[0];
    assert.ok(`${issue.title}\n${issue.body}`.includes(target), `issue #${match[1]} does not name ${target}`);
  }

  const check = await run(box, [process.execPath, 'scripts/known-failures-check.mjs'], { cwd });
  assert.equal(check.status, 0, dump(check));

  // Running again reuses the open cause issues rather than filing duplicates.
  const countAfterFirst = readIssues(box).length;
  const second = await run(box, [process.execPath, 'scripts/known-failures-record.mjs', ...paths], { cwd });
  assert.equal(second.status, 0, dump(second));
  assert.equal(readIssues(box).length, countAfterFirst, 'second run must reuse open cause issues');

  // Every entry in this checkout's own scripts/known-failures.json names an ancestor commit and (#issue, added date).
  const realKnown = JSON.parse(readFileSync(join(CHECKOUT, KNOWN), 'utf8'));
  for (const [id, note] of Object.entries(realKnown.failures ?? {})) {
    assert.match(note, /\(#\d+, added \d{4}-\d{2}-\d{2}\)$/, `checkout entry ${id} lacks (#issue, added date): ${note}`);
    const hexes = [...note.matchAll(/\b[0-9a-f]{7,40}\b/g)].map((m) => m[0]);
    const valid = hexes.some((h) => spawnSync('git', ['merge-base', '--is-ancestor', h, 'HEAD'], { cwd: CHECKOUT }).status === 0);
    assert.ok(valid, `checkout entry ${id} names no ancestor commit at or before HEAD: ${note}`);
  }
});

test('#2818.c386fb21 --from-kept reads resumable preflight jsonl without rerunning passing files and replaces closed-issue entries', LONG, async (t) => {
  const box = sandbox(t);
  seedIssue(box, { number: 9800, title: 'Old closed issue', body: 'closed', state: 'CLOSED' });
  const sentinel = join(box.dir, 'pass-ran.txt');
  const counter = join(box.dir, 'kept-flaky.txt');
  const { cwd } = fixtureRepo(box, {
    'tests/fixture-2818/kept-pass.test.mjs': `import { writeFileSync } from 'node:fs';
import test from 'node:test';
test('already passed', () => { writeFileSync(${JSON.stringify(sentinel)}, 'ran'); });\n`,
    'tests/fixture-2818/kept-fail.test.mjs': `import assert from 'node:assert/strict';
import test from 'node:test';
test('still fails', () => { assert.equal(1, 2); });\n`,
    'tests/fixture-2818/kept-flaky.test.mjs': `import { writeFileSync } from 'node:fs';
import test from 'node:test';
test('passes alone', () => { writeFileSync(${JSON.stringify(counter)}, 'passed'); });\n`,
  }, {
    failures: {
      'tests/fixture-2818/kept-pass.test.mjs › already passed': `fails on main 0000000: old (#9800, added ${today()})`,
      'tests/fixture-2818/kept-fail.test.mjs › still fails': `fails on main 0000000: old (#9800, added ${today()})`,
    },
  });

  const keptPath = join(box.dir, 'kept.jsonl');
  writeFileSync(keptPath, [
    JSON.stringify({ job: 'unit 0', files: ['tests/fixture-2818/kept-pass.test.mjs'], tests: [{ id: 'tests/fixture-2818/kept-pass.test.mjs › already passed', state: 'PASS' }] }),
    JSON.stringify({ job: 'unit 1', files: ['tests/fixture-2818/kept-fail.test.mjs'], tests: [{ id: 'tests/fixture-2818/kept-fail.test.mjs › still fails', state: 'FAIL', note: 'expected 1 to equal 2' }] }),
    JSON.stringify({ job: 'unit 2', files: ['tests/fixture-2818/kept-flaky.test.mjs'], tests: [{ id: 'tests/fixture-2818/kept-flaky.test.mjs › passes alone', state: 'FAIL', note: 'transient' }] }),
  ].join('\n') + '\n');

  const res = await run(box, [process.execPath, 'scripts/known-failures-record.mjs', '--from-kept', keptPath], { cwd });
  assert.equal(res.status, 2, dump(res));
  assert.equal(existsSync(sentinel), false, 'passing file from kept record must not be rerun');
  assert.equal(existsSync(counter), true, 'flaky test from kept record must be rerun alone');

  const recorded = JSON.parse(readFileSync(join(cwd, KNOWN), 'utf8'));
  assert.deepEqual(Object.keys(recorded.failures), ['tests/fixture-2818/kept-fail.test.mjs › still fails']);
  assert.ok(!recorded.failures['tests/fixture-2818/kept-fail.test.mjs › still fails'].includes('#9800'), 'closed issue #9800 must be replaced');

  const check = await run(box, [process.execPath, 'scripts/known-failures-check.mjs'], { cwd });
  assert.equal(check.status, 0, dump(check));
});

test('#2818.c386fb21 missing --from-kept file exits BLOCKED and leaves scripts/known-failures.json untouched', LONG, async (t) => {
  const box = sandbox(t);
  const { cwd } = fixtureRepo(box, {}, { failures: { 'tests/a.test.mjs › a': `fails on main 0000000: x (#9801, added ${today()})` } });
  const before = readFileSync(join(cwd, KNOWN));
  const res = await run(box, [process.execPath, 'scripts/known-failures-record.mjs', '--from-kept', join(box.dir, 'missing.jsonl')], { cwd });
  assert.equal(res.status, 3, dump(res));
  assert.ok(res.stdout.includes('BLOCKED record:'), dump(res));
  assert.ok(readFileSync(join(cwd, KNOWN)).equals(before), 'known-failures.json must not change on BLOCKED');
});

test('#2818.1e81ba0c a failure that passes when run alone reads INCONCLUSIVE, is filed as Flaky: like main-watch.mjs, and is not listed', LONG, async (t) => {
  const box = sandbox(t);
  const counter = join(box.dir, 'flaky-count.txt');
  const { cwd, head } = fixtureRepo(box, {
    'tests/fixture-2818/flaky.test.mjs': `import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import test from 'node:test';
test('flaky once', () => {
  const n = existsSync(${JSON.stringify(counter)}) ? Number(readFileSync(${JSON.stringify(counter)}, 'utf8')) : 0;
  writeFileSync(${JSON.stringify(counter)}, String(n + 1));
  assert.ok(n >= 1, 'fails on first run only');
});\n`,
    'tests/fixture-2818/steady.test.mjs': `import assert from 'node:assert/strict';
import test from 'node:test';
test('always fails', () => { assert.equal(1, 2); });\n`,
  }, {});

  const res = await run(box, [process.execPath, 'scripts/known-failures-record.mjs', 'tests/fixture-2818/flaky.test.mjs', 'tests/fixture-2818/steady.test.mjs'], { cwd });
  assert.equal(res.status, 2, `flaky failure must make run INCONCLUSIVE (exit 2)\n${dump(res)}`);

  const flakyId = 'tests/fixture-2818/flaky.test.mjs › flaky once';
  const steadyId = 'tests/fixture-2818/steady.test.mjs › always fails';
  assert.ok(Number(readFileSync(counter, 'utf8')) >= 2, 'flaky test must have been rerun alone');
  assert.ok(`${res.stdout}\n${res.stderr}`.split('\n').some((l) => l.includes('INCONCLUSIVE') && l.includes(flakyId)), dump(res));

  const rawKnown = readFileSync(join(cwd, KNOWN), 'utf8');
  assert.ok(!rawKnown.includes(flakyId), `flaky ID must not appear in known-failures.json:\n${rawKnown}`);
  const recorded = JSON.parse(rawKnown);
  assert.ok(Object.hasOwn(recorded.failures, steadyId), 'steady failure must be listed');

  const flakyIssues = readIssues(box).filter((it) => it.title.startsWith('Flaky:'));
  assert.equal(flakyIssues.length, 1, `expected 1 Flaky issue, got ${JSON.stringify(flakyIssues)}`);
  assert.ok(flakyIssues[0].title.includes(flakyId));
  assert.ok(flakyIssues[0].body.includes('INCONCLUSIVE'));
  assert.ok(flakyIssues[0].body.includes(flakyId));
  assert.ok(flakyIssues[0].body.includes(head.slice(0, 7)));
  assert.ok(/^\s*[-*]\s*FAIL\b/m.test(flakyIssues[0].body) && /^\s*[-*]\s*PASS\b/m.test(flakyIssues[0].body), flakyIssues[0].body);
  assert.ok(!flakyIssues[0].title.includes(steadyId));
});

test('#2818.b6e45261 printed Approves: lines satisfy scripts/proof.mjs guard on the refreshed commit, while untagged refresh fails', LONG, async (t) => {
  const box = sandbox(t);
  const { cwd, git, keys } = fixtureRepo(box, {
    'tests/fixture-2818/steady.test.mjs': `import assert from 'node:assert/strict';
import test from 'node:test';
test('always fails', () => { assert.equal(1, 2); });\n`,
  }, {});
  const issuesDir = join(box.dir, 'proof-issues');
  writeFiles(issuesDir, { '9818.md': 'Fixture issue.\n\n### Acceptance criteria\n- [ ] Refresh\n' });
  git('checkout', '-q', '-b', 'refresh');

  const rec = await run(box, [process.execPath, 'scripts/known-failures-record.mjs', 'tests/fixture-2818/steady.test.mjs'], { cwd });
  assert.equal(rec.status, 0, dump(rec));
  const items = rec.stdout.split('\n').map((l) => l.match(/^Approves:\s+(.+)$/)?.[1]).filter(Boolean);
  assert.ok(items.includes(`${KNOWN} › tests/fixture-2818/steady.test.mjs › always fails`), dump(rec));

  git('add', KNOWN);
  git('commit', '-qm', 'Refresh known-failures.json\n\nPart of #9818');
  const sha = git('rev-parse', 'HEAD').trim();

  const untagged = await run(box, [process.execPath, join(CHECKOUT, 'scripts/proof.mjs'), 'guard'], { cwd, env: { DEEP_PROOF_ISSUES: issuesDir } });
  assert.notEqual(untagged.status, 0, dump(untagged));
  assert.ok(untagged.stdout.includes('FAIL guard:') && untagged.stdout.includes(KNOWN), dump(untagged));

  tag(cwd, 'deep/approved/2818-test', sha, items, keys.maintainer);
  const tagged = await run(box, [process.execPath, join(CHECKOUT, 'scripts/proof.mjs'), 'guard'], { cwd, env: { DEEP_PROOF_ISSUES: issuesDir } });
  assert.equal(tagged.status, 0, dump(tagged));
  assert.ok(tagged.stdout.includes('PASS guard:'), dump(tagged));
});
