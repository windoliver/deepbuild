// Shared by the #569 acceptance tests. The proof lanes are reached only by running
// `node scripts/proof.mjs [--release] [lane ...]` from this checkout with its cwd at a scratch git
// repository; preflight.test.mjs reaches the preflight on its own (README: Surfaces).
//
// Every tag of a planted issue is built at runtime from its criterion's text, so no file here carries
// a tag a real issue's trace lane could read as its own.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const BASE = '7fc4f14a65d10cb6ad4a3102de7980563cdd8a58'; // origin/main when these tests were drafted; no proof lanes
export const PROOF = join(root, 'scripts/proof.mjs');

// The planted issues. ISSUE is the one each change names; OTHER is an unrelated issue.
export const ISSUE = 9001;
export const OTHER = 9002;

export const GIT = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];
export const git = (cwd, ...args) => execFileSync('git', [...GIT, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** A criterion's ID: the first 8 hex digits of the SHA-256 of its text, trimmed, white space collapsed. */
export const criterionId = (issue, text) => `#${issue}.${createHash('sha256').update(text.trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 8)}`;

/** An issue body as GitHub holds it: prose, then `### Acceptance criteria` with one `- [ ] ` line each. */
export const issueBody = (criteria) =>
  `Planted for the #569 acceptance tests.\n\n### Scope\n- Nothing real.\n\n### Acceptance criteria\n${criteria.map((text) => `- [ ] ${text}`).join('\n')}\n\n### Proof\nOutput pasted.\n`;

export function scratch(t, prefix = 'deep-proof-569-') {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** Writes each file; a null content removes it. */
export function write(cwd, files) {
  for (const [path, content] of Object.entries(files)) {
    if (content === null) rmSync(join(cwd, path), { force: true });
    else {
      mkdirSync(dirname(join(cwd, path)), { recursive: true });
      writeFileSync(join(cwd, path), content);
    }
  }
}

/**
 * The maintainer's SSH key, listed in the approvers file (an SSH allowed-signers file), and a
 * stranger's key that isn't. DEEP_APPROVERS names the file.
 */
function keys(t) {
  const directory = scratch(t, 'deep-proof-569-keys-');
  for (const name of ['maintainer', 'stranger'])
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', `${name}@example.invalid`, '-f', join(directory, name)], { stdio: ['ignore', 'pipe', 'pipe'] });
  const approvers = join(directory, 'approvers');
  writeFileSync(approvers, `maintainer@example.invalid namespaces="git" ${readFileSync(join(directory, 'maintainer.pub'), 'utf8').trim()}\n`);
  return { approvers, key: (name) => join(directory, name) };
}

/**
 * Approves `commit` as a proposal: an annotated tag `deep/approved/<n>` pointing at it, whose
 * message holds one `Approves: <item>` line per item, SSH-signed with `signer`'s key (`maintainer`
 * or `stranger`), or left unsigned when `signer` is null.
 */
export function approve(scene, commit, items, signer = 'maintainer') {
  const name = `deep/approved/${++scene.approvals}`;
  const message = items.map((item) => `Approves: ${item}`).join('\n');
  if (signer) git(scene.cwd, '-c', 'gpg.format=ssh', '-c', `user.signingkey=${scene.keys.key(signer)}`, 'tag', '-s', '-m', message, name, commit);
  else git(scene.cwd, 'tag', '-a', '-m', message, name, commit);
  return name;
}

/**
 * A scratch repository: `base` committed on main as the merge base, with origin/main pointing at
 * it; then each of `commits` ({ files, message, approve: { items, signer } }) on branch `change`;
 * then `uncommitted` written to the worktree. `issues` ({ number: [criterion texts] }) are written
 * to the DEEP_PROOF_ISSUES folder; `link` links this checkout's node_modules in, hidden from git.
 */
export function repo(t, { base = {}, commits = [], uncommitted = {}, issues = {}, link = false } = {}) {
  const cwd = scratch(t);
  git(cwd, 'init', '-q', '-b', 'main');
  write(cwd, base);
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '--allow-empty', '-m', 'base');
  git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(cwd, 'checkout', '-q', '-b', 'change');
  if (link) {
    // A folder of links to each of this checkout's packages, so a tool's cache (vitest's .vite) lands
    // in the scratch folder, never in this checkout's node_modules.
    mkdirSync(join(cwd, 'node_modules'));
    for (const entry of readdirSync(join(root, 'node_modules')).filter((name) => !name.startsWith('.vite')))
      symlinkSync(join(root, 'node_modules', entry), join(cwd, 'node_modules', entry));
    appendFileSync(join(cwd, '.git/info/exclude'), 'node_modules\n');
  }
  const issuesDir = scratch(t, 'deep-proof-569-issues-');
  for (const [number, criteria] of Object.entries(issues)) writeFileSync(join(issuesDir, `${number}.md`), issueBody(criteria));
  const scene = { cwd, keys: keys(t), approvals: 0, commits: [] };
  scene.env = { DEEP_PROOF_ISSUES: issuesDir, DEEP_APPROVERS: scene.keys.approvers };
  for (const { files = {}, message = 'change', approve: approval } of commits) {
    write(cwd, files);
    git(cwd, 'add', '-A');
    git(cwd, 'commit', '-q', '--allow-empty', '-m', message);
    const sha = git(cwd, 'rev-parse', 'HEAD').trim();
    scene.commits.push(sha);
    if (approval) approve(scene, sha, approval.items, approval.signer === undefined ? 'maintainer' : approval.signer);
  }
  write(cwd, uncommitted);
  return scene;
}

/** Runs `node scripts/proof.mjs ...args` from this checkout with cwd at the scene's repository. */
export function proof(scene, args = [], env = {}) {
  assert.ok(existsSync(PROOF), 'scripts/proof.mjs does not exist: the proof lanes are not implemented');
  const environment = { ...process.env, ...scene.env, ...env };
  // Set by node --test for its children; a lane's own `node --test` runs must not inherit it.
  delete environment.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [PROOF, ...args], { cwd: scene.cwd, env: environment, encoding: 'utf8', timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
  const stdout = result.stdout ?? '';
  return { ...result, stdout, out: stdout + (result.stderr ?? ''), lines: stdout.split('\n') };
}

export const show = (result) => `exit ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;

const STATES = ['PASS', 'FAIL', 'BLOCKED', 'INVALID', 'INCONCLUSIVE'];
/** stdout lines that start with one of `states` and then `<lane>:`. */
export const linesOf = (result, states, lane) => result.lines.filter((line) => states.some((state) => line.startsWith(`${state} ${lane}:`)));
/** The lines that make a run fail. */
export const problems = (result, lane) => linesOf(result, ['FAIL', 'BLOCKED', 'INVALID', 'INCONCLUSIVE'], lane);

/** One stdout line of `states` for `lane` holding every one of `parts`; returns it. */
export function line(result, states, lane, ...parts) {
  const found = linesOf(result, states, lane).find((text) => parts.every((part) => text.includes(part)));
  assert.ok(found, `no ${states.join('/')} ${lane}: line holding ${parts.map((part) => JSON.stringify(part)).join(', ')}\n${show(result)}`);
  return found;
}

/** No problem line for `lane` mentions any of `parts`. */
export function noProblemNaming(result, lane, ...parts) {
  for (const text of problems(result, lane))
    for (const part of parts) assert.ok(!text.includes(part), `${lane} named ${JSON.stringify(part)}:\n${show(result)}`);
}

/** Every FAIL, BLOCKED, INVALID or INCONCLUSIVE line is followed by its `  Fix: ` line. */
export function assertFixLines(result) {
  result.lines.forEach((text, index) => {
    if (STATES.slice(1).some((state) => new RegExp(`^${state} \\S+:`).test(text)))
      assert.ok(result.lines[index + 1]?.startsWith('  Fix: '), `no Fix line after ${JSON.stringify(text)}\n${show(result)}`);
  });
}

/** The run failed: exit 1 and at least one problem line for `lane`, each with its Fix line. */
export function assertFails(result, lane) {
  assert.equal(result.status, 1, show(result));
  assert.ok(problems(result, lane).length, `no problem line for ${lane}\n${show(result)}`);
  assertFixLines(result);
}

/** The run passed: exit 0, no problem line for any lane, and the lane said it passed. */
export function assertPasses(result, lane) {
  assert.equal(result.status, 0, show(result));
  assert.deepEqual(problems(result, lane), [], show(result));
  assert.ok(!/^(?:FAIL|BLOCKED|INVALID|INCONCLUSIVE) /m.test(result.stdout), show(result));
  assert.ok(linesOf(result, ['PASS'], lane).length, `no PASS ${lane}: line\n${show(result)}`);
}

/** How a test is named in every line: its file's repo path, ` › `, and its full name. */
export const named = (path, name) => `${path} › ${name}`;

/** What `git` says about the repository's worktrees, refs and status: a proof run must leave it as it was. */
export const footprint = (cwd) => [git(cwd, 'worktree', 'list', '--porcelain'), git(cwd, 'for-each-ref'), git(cwd, 'status', '--porcelain', '--ignored')].join('\n--\n');

/** Whether a mutation tool is there for the lane to use, as README Reading 13 says the lane finds it. */
export const strykerPresent = () => existsSync(join(root, 'node_modules/.bin/stryker'));

// AGENTS.md as the merge base holds it, cut to the parts the guard reads around.
export const AGENTS = `# Rules for agents working in this repo

Read [docs/technical-design.md](docs/technical-design.md) before edits. Keep this file under one page.

## The four invariants

These hold in the core and every extension:

1. An agent's word is never evidence. Only check results are.
2. Nothing missing or unrun passes. It's \`BLOCKED\`, \`INVALID\` or \`INCONCLUSIVE\`, never \`PASS\`.
3. Agents can't change checks or decisions.
4. A person sees only what needs a person, and never the same question twice.

## Proof

- Acceptance tests come first, in \`tests/acceptance/<issue>/\`.
- Every behavior fix starts with a test failing for the expected reason.
`;

// A design document with a Decisions section and its Decided table, rows as the design holds them.
export const DESIGN = `# DeepBuild: technical design

## How we know version 0 works

Each version passes the same conformance tests before its platform ships.

## Decisions

One question is yours, only if you want it. Every other question is decided below with what would reopen it.

### Decided

| Question | Decision | Reopens if |
|---|---|---|
| Requests that name an action | A request you type authorizes exactly what it names, in that thread. | You say a request should cover more, or less |
| Work-in-progress commits | An agent may make a local WIP commit to set work aside, instead of a stash. Pushing it still needs your ask, and it's squashed or dropped before delivery. | Your rules reserve every commit |
| Dispatching workflows | No dispatch without approval, for every user. | A repo marks more workflows as free |

## Glossary

A claim is an agent's statement that work is done.
`;

/** The 1-based line of `text` in `content`. */
export const lineNumber = (content, text) => content.split('\n').findIndex((row) => row.includes(text)) + 1;
