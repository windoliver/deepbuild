// #246 acceptance: `node scripts/repo-rules.mjs`, run as a process in scratch git repositories
// (and once, read-only, in this checkout).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { accessSync, chmodSync, constants, mkdirSync, readFileSync, statSync, symlinkSync, unlinkSync, writeFileSync, copyFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import test from 'node:test';
import {
  BASE, FIX, NPM12, PLANTS, assertLine, assertNoState, assertNotLeaked, findings, git, placed, plant, repo, root, rules,
  rulesFile, scratch, sha256, show, write,
} from './helpers.mjs';

const SECRETS_PASS = /^PASS secrets: (\d+) files? scanned, (\d+) lockfiles? and (\d+) binary files? skipped, (\d+) allowed$/m;
const DEPS_PASS = /^PASS deps: (\d+) package\.json files? and (\d+) crates? match scripts\/repo-rules\.json$/m;
const SIZE = /^NOTE size: (?:\+\d+ -\d+ handwritten lines against merge base [0-9a-f]{7,40}, lockfiles and binary files excluded(?: \(guideline: about 400\)|; over the guideline of about 400, so the PR says why it can't be split)|not measured: no origin\/main to compare with \(git fetch origin main\))$/;
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const listed = (cwd) => git(cwd, 'ls-files', '--cached', '--others', '--exclude-standard').split('\n').filter(Boolean);
const nextIsFix = (result, line) => {
  const lines = result.stdout.split('\n');
  const index = lines.indexOf(line);
  assert.notEqual(index, -1, `missing line ${JSON.stringify(line)}\n${show(result)}`);
  assert.match(lines[index + 1] ?? '', /^  Fix: \S/, `the line after ${JSON.stringify(line)} is not a Fix line\n${show(result)}`);
};

// --- On this checkout -------------------------------------------------------------------------

test('on this checkout, every check passes on one line saying what it read, and git status is unchanged', () => {
  const status = () => execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
  const before = status();
  const result = rules(root);
  assert.equal(status(), before, 'repo-rules changed git status --porcelain');
  assert.equal(result.status, 0, show(result));
  assert.equal(result.lines.length, 5, `expected one line per check\n${show(result)}`);
  assert.equal(result.lines[0], 'PASS workflows: .github/workflows/ has no entries');
  assert.equal(result.lines[1], 'PASS agent-hooks: no hooks, plugins or hook switch-off in .claude settings, no .codex/ folder');
  assert.match(result.lines[2], SECRETS_PASS);
  assert.ok(Number(result.lines[2].match(SECRETS_PASS)[1]) > 0, result.lines[2]);
  assert.match(result.lines[3], DEPS_PASS);
  assert.match(result.lines[4], SIZE);
});

// --- workflows ---------------------------------------------------------------------------------

test('a file at .github/workflows/ci.yml fails the workflows check with its fix', (t) => {
  const cwd = repo(t, { files: { '.github/workflows/ci.yml': 'on: push\njobs: {}\n' } });
  const result = rules(cwd);
  assert.equal(result.status, 1, show(result));
  assertLine(result, 'FAIL workflows: .github/workflows/ci.yml', FIX.workflows);
  assertNoState(result, 'PASS', 'workflows');
});

// --- agent-hooks -------------------------------------------------------------------------------

const HOOKS = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'true' }] }] } };
const hookCases = [
  ['a hooks key in .claude/settings.json', { tracked: { '.claude/settings.json': json(HOOKS) } }, 'FAIL agent-hooks: .claude/settings.json has a hooks key'],
  ['a hooks key in a git-ignored .claude/settings.local.json', { tracked: { '.gitignore': '.claude/settings.local.json\n' }, files: { '.claude/settings.local.json': json(HOOKS) }, ignored: '.claude/settings.local.json' }, 'FAIL agent-hooks: .claude/settings.local.json has a hooks key'],
  ['a hooks key in packages/cli/.claude/settings.json', { tracked: { 'packages/cli/.claude/settings.json': json(HOOKS) } }, 'FAIL agent-hooks: packages/cli/.claude/settings.json has a hooks key'],
  ['an enabledPlugins key in .claude/settings.json', { files: { '.claude/settings.json': json({ enabledPlugins: { 'helper@market': true } }) } }, 'FAIL agent-hooks: .claude/settings.json enables plugins'],
  ['"disableAllHooks": true in .claude/settings.json', { tracked: { '.claude/settings.json': json({ disableAllHooks: true }) } }, 'FAIL agent-hooks: .claude/settings.json switches hooks off'],
  ['a file at .codex/config.toml', { files: { '.codex/config.toml': 'model = "fixture"\n' } }, 'FAIL agent-hooks: .codex/config.toml is Codex config in the repo'],
];
for (const [name, { tracked, files, ignored }, line] of hookCases) {
  test(`agent-hooks fails on its own for ${name}`, (t) => {
    const cwd = repo(t, { tracked, files });
    if (ignored) git(cwd, 'check-ignore', '-q', ignored); // throws unless git ignores it
    const result = rules(cwd);
    assert.equal(result.status, 1, show(result));
    assertLine(result, line, FIX.hooks);
    assertNoState(result, 'PASS', 'agent-hooks');
  });
}

test('a .claude/settings.json with permissions and "disableAllHooks": false passes, and node_modules/ and target/ are not read', (t) => {
  const cwd = repo(t, {
    tracked: { '.gitignore': 'node_modules/\ntarget/\n', '.claude/settings.json': json({ permissions: { allow: ['Bash(ls)'] }, disableAllHooks: false }) },
    files: { 'node_modules/pkg/.claude/settings.json': json(HOOKS), 'target/.claude/settings.json': json({ enabledPlugins: { 'x@y': true } }) },
  });
  const result = rules(cwd);
  assert.equal(result.status, 0, show(result));
  assert.match(result.stdout, /^PASS agent-hooks: \S/m, show(result));
  assertNoState(result, 'FAIL', 'agent-hooks');
});

// --- secrets -----------------------------------------------------------------------------------

function plantFiles(directory) {
  const files = {}, expected = [];
  PLANTS.forEach(([value, kind], index) => {
    const path = `${directory}/plant-${index}.md`, line = 2 + (index % 4), column = 1 + ((index * 7) % 30);
    files[path] = placed(value, line, column);
    expected.push(`${path}:${line}:${column}: ${kind}`);
  });
  return { files, expected: expected.sort() };
}

test('a value of each kind in a tracked file fails with its path, line, column and kind, never its text', (t) => {
  const single = plant.macHome('erin');
  const one = rules(repo(t, { tracked: { 'notes/plan.md': placed(single, 3, 12) } }));
  assert.equal(one.status, 1, show(one));
  assertLine(one, 'FAIL secrets: notes/plan.md:3:12: home path', FIX.secrets);
  assertNotLeaked(one, [single]);

  const { files, expected } = plantFiles('tracked');
  const result = rules(repo(t, { tracked: files }));
  assert.equal(result.status, 1, show(result));
  assert.deepEqual(findings(result.stdout), expected, show(result));
  assert.match(result.stdout, /^FAIL secrets: /m, show(result));
  assert.ok(result.stdout.split('\n').includes(FIX.secrets), show(result));
  assertNoState(result, 'PASS', 'secrets');
  assertNotLeaked(result, PLANTS.map(([value]) => value));
});

test('a value of each kind in a new untracked file fails with its path, line, column and kind, never its text', (t) => {
  const { files, expected } = plantFiles('untracked');
  const result = rules(repo(t, { files }));
  assert.equal(result.status, 1, show(result));
  assert.deepEqual(findings(result.stdout), expected, show(result));
  assert.ok(result.stdout.split('\n').includes(FIX.secrets), show(result));
  assertNoState(result, 'PASS', 'secrets');
  assertNotLeaked(result, PLANTS.map(([value]) => value));
});

test('the clean twins pass: excluded paths, near misses, lockfiles, binary files and ignored files', (t) => {
  const slash = (...parts) => parts.join('/'), back = (...parts) => parts.join('\\'), doubled = (...parts) => parts.join('\\\\');
  const twins = [
    '~/', '~/dev/project/', slash('', 'Users', '<name>', ''), slash('', 'home', '$USER', ''), back('C:', 'Users', '<name>', ''),
    doubled('C:', 'Users', '<name>', ''), slash('', 'Users', 'Shared', ''), back('C:', 'Users', 'Public', ''),
    slash('', 'home', '{user}', ''), slash('', 'Users', '${USER}', ''),
    'task-runner', plant.aws('KIA', 'ABCDEFGHIJKLMNO'), plant.aws('SIA', 'ABC123'),
    `ta${plant.apiKey()}`, `_${plant.apiKey('y')}`, `-${plant.apiKey('w')}`, `9${plant.apiKey('v')}`,
  ];
  const text = `${twins.map((twin) => `see ${twin} here`).join('\n')}\n`;
  const values = PLANTS.map(([value]) => value);
  const cwd = repo(t, {
    tracked: {
      '.gitignore': 'ignored/\n*.secret\n',
      'notes/twins.md': text,
      'package-lock.json': json({ name: 'fixture', lockfileVersion: 3, note: values.join(' ') }),
      'Cargo.lock': `version = 4\n${values.map((value) => `# ${value}`).join('\n')}\n`,
      'notes/early-nul.dat': `header\0\n${values.join('\n')}\n`,
      'notes/edge-nul.dat': `${'x'.repeat(7999)}\0\n${values.join('\n')}\n`,
    },
    files: { 'notes/twins-new.md': text, 'ignored/notes.md': `${values.join('\n')}\n`, 'keys.secret': `${values.join('\n')}\n` },
  });
  for (const path of ['ignored/notes.md', 'keys.secret']) git(cwd, 'check-ignore', '-q', path);
  const clean = rules(cwd);
  assert.equal(clean.status, 0, show(clean));
  assert.deepEqual(findings(clean.stdout), [], show(clean));
  const [, scanned, lockfiles, binary, allowed] = clean.stdout.match(SECRETS_PASS) ?? assert.fail(show(clean));
  assert.deepEqual([Number(scanned), Number(lockfiles), Number(binary), Number(allowed)], [listed(cwd).length - 4, 2, 2, 0], show(clean));
  assertNotLeaked(clean, values);

  // The same scan still finds a value beside the twins, and in a file whose NUL comes after 8,000 bytes.
  write(cwd, {
    'notes/real.md': placed(plant.github('p', 'c'), 2, 5),
    'notes/late-nul.txt': `${'y'.repeat(8100)}\0\n${plant.apiKey('z')}\n`,
  });
  const contrast = rules(cwd);
  assert.equal(contrast.status, 1, show(contrast));
  assert.deepEqual(findings(contrast.stdout), ['notes/late-nul.txt:2:1: API key', 'notes/real.md:2:5: GitHub token'], show(contrast));
});

// --- allowedFindings ---------------------------------------------------------------------------

const TOKEN = plant.github('p', 'a'); // the issue's fake token: ghp_ and 36 a's
const entry = (extra = {}) => ({ path: 'tests/fixtures/token.txt', kind: 'GitHub token', sha256: sha256(TOKEN), why: 'Fixture for the token rule.', ...extra });

test('an allowedFindings entry skips exactly its value in its file and is counted', (t) => {
  const cwd = repo(t, { tracked: { 'tests/fixtures/token.txt': placed(TOKEN, 1, 1), 'scripts/repo-rules.json': rulesFile({ allowedFindings: [entry()] }) } });
  const allowed = rules(cwd);
  assert.equal(allowed.status, 0, show(allowed));
  assert.match(allowed.stdout, /^PASS secrets: .*, 1 allowed$/m, show(allowed));
  assert.deepEqual(findings(allowed.stdout), [], show(allowed));

  // The same value in another file, and a different value of the same kind in the same file, still fail.
  const other = plant.github('p', 'd');
  write(cwd, { 'notes/other.txt': placed(TOKEN, 2, 3), 'tests/fixtures/token.txt': `${TOKEN} end\nplain\n  ${other}\n` });
  const result = rules(cwd);
  assert.equal(result.status, 1, show(result));
  assert.deepEqual(findings(result.stdout), ['notes/other.txt:2:3: GitHub token', 'tests/fixtures/token.txt:3:3: GitHub token'], show(result));
  assertNotLeaked(result, [TOKEN, other]);
});

test('an allowedFindings entry that matches nothing fails', (t) => {
  const cwd = repo(t, { tracked: { 'tests/fixtures/token.txt': 'no token here\n', 'scripts/repo-rules.json': rulesFile({ allowedFindings: [entry()] }) } });
  const result = rules(cwd);
  assert.equal(result.status, 1, show(result));
  const line = "FAIL secrets: scripts/repo-rules.json allows a GitHub token in tests/fixtures/token.txt that isn't there";
  assertLine(result, line);
  nextIsFix(result, line);
  assertNoState(result, 'PASS', 'secrets');
});

test('an allowedFindings entry without why is INVALID', (t) => {
  const { why, ...withoutWhy } = entry();
  const cwd = repo(t, { tracked: { 'tests/fixtures/token.txt': placed(TOKEN, 1, 1), 'scripts/repo-rules.json': rulesFile({ allowedFindings: [withoutWhy] }) } });
  const result = rules(cwd);
  assert.equal(result.status, 1, show(result));
  const line = 'INVALID secrets: scripts/repo-rules.json: allowedFindings[0] has no why';
  assertLine(result, line);
  nextIsFix(result, line);
  assertNoState(result, 'PASS', 'secrets');
});

// --- deps: npm ---------------------------------------------------------------------------------

function npmRepo(t) {
  return repo(t, { tracked: {
    'package.json': json({ name: 'fixture', private: true, devDependencies: NPM12 }),
    'scripts/repo-rules.json': rulesFile({ deps: { 'package.json': { devDependencies: NPM12 } } }),
  } });
}

test("with #12's three devDependencies listed, an unlisted, re-specified or undeclared one fails", (t) => {
  const cwd = npmRepo(t);
  const listedOnly = rules(cwd);
  assert.equal(listedOnly.status, 0, show(listedOnly));
  assert.match(listedOnly.stdout, /^PASS deps: 1 package\.json files? and 0 crates? match scripts\/repo-rules\.json$/m, show(listedOnly));

  const cases = [
    [{ ...NPM12, 'left-pad': '1.3.0' }, 'FAIL deps: package.json devDependencies left-pad 1.3.0 is not in scripts/repo-rules.json'],
    [{ ...NPM12, typescript: 'npm:other@5.9.3' }, 'FAIL deps: package.json devDependencies typescript is npm:other@5.9.3; scripts/repo-rules.json allows 5.9.3'],
    [{ '@types/node': NPM12['@types/node'], typescript: NPM12.typescript }, "FAIL deps: scripts/repo-rules.json lists package.json devDependencies vitest, which package.json doesn't declare"],
  ];
  for (const [devDependencies, line] of cases) {
    writeFileSync(join(cwd, 'package.json'), json({ name: 'fixture', private: true, devDependencies }));
    const result = rules(cwd);
    assert.equal(result.status, 1, show(result));
    assertLine(result, line, FIX.deps);
    assertNoState(result, 'PASS', 'deps');
  }
});

test('a new packages/x/package.json with a dependencies entry fails, and one with none passes', (t) => {
  const cwd = npmRepo(t);
  write(cwd, { 'packages/x/package.json': json({ name: 'x', private: true, dependencies: { 'left-pad': '1.3.0' } }) });
  const result = rules(cwd);
  assert.equal(result.status, 1, show(result));
  assertLine(result, 'FAIL deps: packages/x/package.json dependencies left-pad 1.3.0 is not in scripts/repo-rules.json', FIX.deps);

  write(cwd, { 'packages/x/package.json': json({ name: 'x', private: true }) });
  const none = rules(cwd);
  assert.equal(none.status, 0, show(none));
  assert.match(none.stdout, /^PASS deps: 2 package\.json files and 0 crates? match scripts\/repo-rules\.json$/m, show(none));
});

for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'overrides']) {
  test(`package.json ${section} is read`, (t) => {
    const cwd = npmRepo(t);
    write(cwd, { 'packages/x/package.json': json({ name: 'x', private: true, [section]: { 'left-pad': '1.3.0' } }) });
    const result = rules(cwd);
    assert.equal(result.status, 1, show(result));
    assertLine(result, `FAIL deps: packages/x/package.json ${section} left-pad 1.3.0 is not in scripts/repo-rules.json`, FIX.deps);
  });
}

// --- deps: Rust --------------------------------------------------------------------------------

const crate = (tables) => `[package]\nname = "fx"\nversion = "0.0.0"\nedition = "2021"\n\n${tables}`;

test('a Rust dependency fails in each section that declares it, and passes once listed with spec ^1', (t) => {
  const cwd = repo(t, { tracked: { 'crates/fx/Cargo.toml': crate('[dependencies]\nserde = "1"\n'), 'crates/fx/src/lib.rs': '' } });
  const plain = rules(cwd);
  assert.equal(plain.status, 1, show(plain));
  assertLine(plain, 'FAIL deps: crates/fx/Cargo.toml dependencies serde ^1 is not in scripts/repo-rules.json', FIX.deps);

  const sectionOf = (tables) => {
    writeFileSync(join(cwd, 'crates/fx/Cargo.toml'), crate(tables));
    const result = rules(cwd);
    assert.equal(result.status, 1, show(result));
    const match = result.stdout.match(/^FAIL deps: crates\/fx\/Cargo\.toml (.+) serde \^1 is not in scripts\/repo-rules\.json$/m);
    assert.ok(match, show(result));
    nextIsFix(result, match[0]);
    return match[1];
  };
  assert.match(sectionOf('[dev-dependencies]\nserde = "1"\n'), /dev-dependencies/);
  assert.match(sectionOf("[target.'cfg(unix)'.dependencies]\nserde = \"1\"\n"), /cfg\(unix\)/);

  write(cwd, {
    'crates/fx/Cargo.toml': crate('[dependencies]\nserde = "1"\n'),
    'scripts/repo-rules.json': rulesFile({ deps: { 'crates/fx/Cargo.toml': { dependencies: { serde: '^1' } } } }),
  });
  const listedSerde = rules(cwd);
  assert.equal(listedSerde.status, 0, show(listedSerde));
  assert.match(listedSerde.stdout, /^PASS deps: \d+ package\.json files? and 1 crate match scripts\/repo-rules\.json$/m, show(listedSerde));
});

test('a path dependency is listed relative to its manifest, and no absolute path is printed or listed', (t) => {
  const cwd = repo(t, { tracked: {
    'crates/fx/Cargo.toml': crate('[dependencies]\nhelper = { path = "../helper" }\n'),
    'crates/fx/src/lib.rs': '',
    'crates/helper/Cargo.toml': '[package]\nname = "helper"\nversion = "0.0.0"\nedition = "2021"\n',
    'crates/helper/src/lib.rs': '',
  } });
  const result = rules(cwd);
  assert.equal(result.status, 1, show(result));
  const match = result.stdout.match(/^FAIL deps: crates\/fx\/Cargo\.toml dependencies helper (.+) is not in scripts\/repo-rules\.json$/m);
  assert.ok(match, show(result));
  const spec = match[1];
  assert.match(spec, /\.\.\/helper/);
  assert.doesNotMatch(spec, /(?:^|[\s"'=:])\/[A-Za-z]/, `the spec holds an absolute path: ${spec}`);
  // Neither the real path nor macOS's /var alias of the scratch folder may be printed.
  for (const absolute of [cwd, cwd.replace(/^\/private\//, '/')]) assert.ok(!result.out.includes(absolute), show(result));

  write(cwd, { 'scripts/repo-rules.json': rulesFile({ deps: { 'crates/fx/Cargo.toml': { dependencies: { helper: spec } } } }) });
  const listedHelper = rules(cwd);
  assert.equal(listedHelper.status, 0, show(listedHelper));
  assert.match(listedHelper.stdout, /^PASS deps: \d+ package\.json files? and 2 crates match scripts\/repo-rules\.json$/m, show(listedHelper));
});

// --- INVALID and BLOCKED -----------------------------------------------------------------------

test('a scratch repository whose only files are lockfiles is INVALID secrets: 0 files scanned', (t) => {
  const cwd = scratch(t);
  git(cwd, 'init', '-q');
  write(cwd, { 'package-lock.json': json({ name: 'fixture', lockfileVersion: 3 }), 'Cargo.lock': 'version = 4\n' });
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', 'lockfiles only');
  // The script runs from scripts/, which git is told to exclude, so git lists only the lockfiles.
  mkdirSync(join(cwd, 'scripts'));
  try { copyFileSync(join(root, 'scripts/repo-rules.mjs'), join(cwd, 'scripts/repo-rules.mjs')); } catch {}
  write(cwd, { '.git/info/exclude': '/scripts/\n' });
  assert.deepEqual(listed(cwd).sort(), ['Cargo.lock', 'package-lock.json']);
  const result = rules(cwd);
  assert.equal(result.status, 1, show(result));
  const line = result.lines.find((text) => /^INVALID secrets: 0 files scanned\b/.test(text));
  assert.ok(line, show(result));
  nextIsFix(result, line);
  assertNoState(result, 'PASS', 'secrets');
});

test('a checkout with no package.json or Cargo.toml is INVALID deps', (t) => {
  const cwd = repo(t, { defaults: false, tracked: { 'scripts/repo-rules.json': rulesFile(), 'notes/a.md': 'hello\n' } });
  const result = rules(cwd);
  assert.equal(result.status, 1, show(result));
  const line = 'INVALID deps: no package.json or Cargo.toml was read';
  assertLine(result, line);
  nextIsFix(result, line);
  assertNoState(result, 'PASS', 'deps');
});

test('a missing scripts/repo-rules.json is INVALID deps, and a malformed one names the parse error', (t) => {
  const missing = rules(repo(t, { defaults: false, tracked: { 'package.json': '{ "name": "fixture", "private": true }\n' } }));
  assert.equal(missing.status, 1, show(missing));
  assertLine(missing, 'INVALID deps: scripts/repo-rules.json is missing');
  nextIsFix(missing, 'INVALID deps: scripts/repo-rules.json is missing');
  assertNoState(missing, 'PASS', 'deps');

  const malformed = rules(repo(t, { defaults: false, tracked: { 'package.json': '{ "name": "fixture", "private": true }\n', 'scripts/repo-rules.json': '{ "deps": \n' } }));
  assert.equal(malformed.status, 1, show(malformed));
  const line = malformed.lines.find((text) => /^INVALID deps: scripts\/repo-rules\.json\b.*(?:JSON|Unexpected|Expected|position)/.test(text));
  assert.ok(line, show(malformed));
  nextIsFix(malformed, line);
  assertNoState(malformed, 'PASS', 'deps');
});

test('a tracked file with mode 000 is BLOCKED secrets, and a tracked file deleted from the tree is skipped', (t) => {
  const cwd = repo(t, { tracked: { 'notes/locked.md': 'hello\n', 'notes/gone.md': 'bye\n' } });
  chmodSync(join(cwd, 'notes/locked.md'), 0o000);
  t.after(() => { try { chmodSync(join(cwd, 'notes/locked.md'), 0o600); } catch {} });
  unlinkSync(join(cwd, 'notes/gone.md'));
  const result = rules(cwd);
  assert.equal(result.status, 1, show(result));
  const line = 'BLOCKED secrets: notes/locked.md cannot be read (EACCES)';
  assertLine(result, line);
  nextIsFix(result, line);
  assertNoState(result, 'PASS', 'secrets');
  assert.ok(!result.out.includes('gone.md'), show(result));
});

function onPath(name) {
  for (const directory of (process.env.PATH ?? '').split(':').filter(Boolean)) {
    const candidate = join(directory, name);
    try { accessSync(candidate, constants.X_OK); if (statSync(candidate).isFile()) return candidate; } catch {}
  }
  throw Error(`${name} is not on PATH`);
}

test('a Cargo.toml with only git on PATH is BLOCKED deps: cargo metadata could not run', (t) => {
  const cwd = repo(t, { tracked: { 'crates/fx/Cargo.toml': crate(''), 'crates/fx/src/lib.rs': '' } });
  const bin = scratch(t, 'deep-rules-246-path-');
  symlinkSync(onPath('git'), join(bin, 'git'));
  symlinkSync(process.execPath, join(bin, 'node'));
  const result = rules(cwd, { env: { ...process.env, PATH: bin } });
  assert.equal(result.status, 1, show(result));
  const line = 'BLOCKED deps: cargo metadata could not run (spawn cargo ENOENT)';
  assertLine(result, line);
  nextIsFix(result, line);
  assertNoState(result, 'PASS', 'deps');
});

// --- size --------------------------------------------------------------------------------------

const numbered = (count, word = 'line') => Array.from({ length: count }, (_, index) => `${word} ${index + 1}`).join('\n') + '\n';

test('a 450-line handwritten file beside a 1,000-line lockfile change is over the guideline, and the run still exits 0', (t) => {
  const cwd = repo(t, { origin: true, tracked: { 'package-lock.json': json({ name: 'fixture', lockfileVersion: 3, packages: {} }) } });
  write(cwd, {
    'notes/big.md': numbered(450),
    'package-lock.json': json({ name: 'fixture', lockfileVersion: 3, lines: Array.from({ length: 1000 }, (_, index) => `entry ${index}`) }),
    'notes/blob.bin': Buffer.from(Array.from({ length: 300 }, (_, index) => (index % 3 ? 0 : 10))),
  });
  const result = rules(cwd);
  assert.equal(result.status, 0, show(result));
  const match = result.stdout.match(/^NOTE size: \+450 -0 handwritten lines against merge base ([0-9a-f]{7,40}), lockfiles and binary files excluded; over the guideline of about 400, so the PR says why it can't be split$/m);
  assert.ok(match, show(result));
  assert.ok(git(cwd, 'merge-base', 'HEAD', 'origin/main').trim().startsWith(match[1]), `${match[1]} is not the merge base`);
});

test('committed, uncommitted and new untracked lines all count, under the guideline', (t) => {
  const cwd = repo(t, { origin: true, tracked: { 'notes/a.md': 'one\n' } });
  write(cwd, { 'notes/committed.md': numbered(60, 'committed') });
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-qm', 'after the merge base');
  write(cwd, { 'notes/a.md': `one\n${numbered(40, 'uncommitted')}`, 'notes/new.md': numbered(20, 'untracked') });
  const result = rules(cwd);
  assert.equal(result.status, 0, show(result));
  const match = result.stdout.match(/^NOTE size: \+120 -0 handwritten lines against merge base ([0-9a-f]{7,40}), lockfiles and binary files excluded \(guideline: about 400\)$/m);
  assert.ok(match, show(result));
  assert.ok(git(cwd, 'rev-parse', 'origin/main').trim().startsWith(match[1]), `${match[1]} is not the merge base`);
});

test('without origin/main, size is not measured and the run still exits 0', (t) => {
  const result = rules(repo(t, { tracked: { 'notes/a.md': 'one\n' } }));
  assert.equal(result.status, 0, show(result));
  assertLine(result, 'NOTE size: not measured: no origin/main to compare with (git fetch origin main)');
});

// --- no dependency added -----------------------------------------------------------------------

test("no dependency is added: manifests keep #12's sections and repo-rules.mjs imports only node: modules", () => {
  const source = readFileSync(join(root, 'scripts/repo-rules.mjs'), 'utf8');
  const specifiers = [...source.matchAll(/\bimport\s*(?:[^'"()]*?\bfrom\s*)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]|\brequire\s*\(\s*['"]([^'"]+)['"]/g)]
    .map((match) => match[1] ?? match[2] ?? match[3]);
  assert.ok(specifiers.length > 0, 'repo-rules.mjs imports nothing');
  assert.deepEqual(specifiers.filter((specifier) => !specifier.startsWith('node:')), []);
  assert.doesNotMatch(source, /\b(?:import|require)\s*\(\s*[^'"\s)]/, 'repo-rules.mjs has a computed import');

  const sections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'overrides'];
  const pick = (manifest) => Object.fromEntries(sections.filter((section) => manifest[section] !== undefined).map((section) => [section, manifest[section]]));
  const inBase = (path) => { try { return execFileSync('git', ['show', `${BASE}:${path}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; } };
  const manifests = listed(root).filter((path) => ['package.json', 'Cargo.toml'].includes(basename(path)));
  assert.ok(manifests.includes('package.json') && manifests.includes('Cargo.toml'), manifests.join(', '));
  for (const path of manifests) {
    const now = readFileSync(join(root, path), 'utf8'), then = inBase(path);
    if (basename(path) === 'package.json') assert.deepEqual(pick(JSON.parse(now)), then ? pick(JSON.parse(then)) : {}, path);
    // #12's Cargo.toml files declare no dependency table, so none may appear.
    else assert.doesNotMatch(now, /^\s*\[(?:workspace\.|target\.[^\]]*\.)?(?:dev-|build-)?dependencies\b/m, path);
  }
});
