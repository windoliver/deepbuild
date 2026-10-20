// Live acceptance tests for #47: real Claude Code and Codex sessions on your own sign-in. They spend
// plan usage, so they run only by hand:
//   DEEP_CORPUS_LIVE=1 node --test --test-concurrency=1 tests/acceptance/47/corpus.live.test.mjs
// A missing opt-in, binary, sign-in, hub or precondition fails the test with BLOCKED in its message;
// nothing skips.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { corpusScript, factsEvents, ID, readFacts, replay, root, scratch, sessions, setDir, show } from './helpers.mjs';

const BINARY = { 'claude-code': 'claude', codex: 'codex' };
const SIGN_IN = { 'claude-code': ['auth', 'status'], codex: ['login', 'status'] };

function requireLive(agent) {
  if (process.env.DEEP_CORPUS_LIVE !== '1') assert.fail('BLOCKED: live tests spend plan usage; run them by hand with DEEP_CORPUS_LIVE=1');
  const version = spawnSync(BINARY[agent], ['--version'], { encoding: 'utf8', timeout: 30_000 });
  if (version.error || version.status !== 0) assert.fail(`BLOCKED: ${BINARY[agent]} is not runnable on PATH: ${version.error?.message ?? `exit ${version.status}`}`);
  // Sign-in output can carry part of a key, so it is only checked by exit code, never shown.
  const signIn = spawnSync(BINARY[agent], SIGN_IN[agent], { encoding: 'utf8', timeout: 30_000 });
  if (signIn.error || signIn.status !== 0) assert.fail(`BLOCKED: ${BINARY[agent]} is not signed in (exit ${signIn.status})`);
  const installed = version.stdout.match(/\d+\.\d+\.\d+(?:[-+][\w.]+)?/)?.[0];
  if (!installed) assert.fail(`BLOCKED: no version in ${BINARY[agent]} --version`);
  return installed;
}

const deep = (...args) => spawnSync(process.execPath, [join(root, 'packages/cli/src/main.ts'), ...args], { cwd: root, encoding: 'utf8', timeout: 120_000 });
function deepJson(...args) {
  const result = deep(...args, '--json');
  if (result.status !== 0 || /Unsupported command/.test(result.stderr)) assert.fail(`BLOCKED: deep ${args.join(' ')} --json does not answer (the hub, the runner or the command is missing)\n${show(result)}`);
  return JSON.parse(result.stdout);
}

const corpusStatus = () => spawnSync('git', ['status', '--porcelain', '--', 'adapters'], { cwd: root, encoding: 'utf8' }).stdout;

for (const agent of ['claude-code', 'codex']) {
  test(`${ID.newVersion} live: recording a fresh ${agent} set tags it with the installed version, covers every event the adapter handles, writes no expected events, leaks nothing, and leaves the corpus to your diff`, (t) => {
    const version = requireLive(agent);
    const before = corpusStatus();
    const out = scratch(t);
    const run = corpusScript(['record', '--agent', agent, '--out', out], { timeout: 30 * 60_000 });
    assert.equal(run.result.status, 0, show(run.result));
    const dir = setDir(agent, version, out);
    assert.ok(existsSync(dir), `the fresh set is at <out>/${agent}/${version}`);
    const recorded = sessions({ agent, version, dir });
    assert.ok(recorded.length > 0, 'the fresh set holds sessions');
    const { facts } = readFacts(agent);
    const handled = Object.keys(factsEvents(agent, facts.versions.at(-1), facts));
    const hooks = new Set();
    for (const session of recorded) {
      assert.equal(session.meta.version, version, `${session.name}: tagged with the installed version`);
      assert.ok(existsSync(session.transcriptPath), `${session.name}: has its transcript`);
      for (const found of session.cases) {
        hooks.add(found.payload.hook_event_name);
        // Expected events are written from the agent's documentation and reviewed, never by the recorder.
        assert.ok(!('expect' in found), `${session.name} events.jsonl:${found.line}: the recorder wrote expected events`);
      }
    }
    for (const hook of handled) assert.ok(hooks.has(hook), `the fresh set records ${hook}`);
    // Nothing missing passes: a set with no expected events doesn't replay clean.
    const fresh = replay(out);
    assert.notEqual(fresh.result.status, 0, `a set with no expected events must not replay clean\n${show(fresh.result)}`);
    // No secret and no home folder in what was recorded.
    const scan = spawnSync('gitleaks', ['detect', '--no-git', '--source', out, '--config', join(root, 'packages/evidence/gitleaks/gitleaks.toml'), '--redact', '--no-banner', '--exit-code', '3'], { encoding: 'utf8' });
    if (scan.error) assert.fail(`BLOCKED: gitleaks did not run: ${scan.error.message}`);
    assert.equal(scan.status, 0, `gitleaks found secrets in the fresh set (exit ${scan.status})`);
    for (const session of recorded) {
      for (const file of ['session.json', 'events.jsonl', 'transcript.jsonl']) assert.ok(!readFileSync(join(session.dir, file), 'utf8').includes(homedir()), `${session.name}/${file} holds your home folder`);
    }
    assert.equal(corpusStatus(), before, 'recording changes nothing under adapters/, the corpus and the facts: a fresh set joins only through a diff you approve');
  });
}

// ---- Criterion 13: Claude Code updated past its facts --------------------------------------------
// Preconditions: the installed Claude Code is a version adapters/claude-code.facts.json doesn't cover,
// DeepBuild's hooks are set up at user level and the hub answers `deep status --json`.

function uncovered() {
  const version = requireLive('claude-code');
  const { facts } = readFacts('claude-code');
  if (facts.versions.includes(version)) assert.fail(`BLOCKED: Claude Code ${version} is covered by adapters/claude-code.facts.json; this runs after an update the facts don't cover`);
  return version;
}

function startSession(t) {
  const folder = scratch(t, 'deep-corpus-47-session-');
  const result = spawnSync('claude', ['-p', 'Reply with the word ok.', '--model', 'haiku', '--output-format', 'json'], { cwd: folder, encoding: 'utf8', timeout: 300_000 });
  assert.equal(result.status, 0, `claude -p exited ${result.status}`);
  const id = JSON.parse(result.stdout).session_id;
  assert.ok(id, 'claude -p reported its session ID');
  return id;
}

async function row(id, until, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = deepJson('status').sessions?.find((session) => session.id === id);
    if (last && until(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  assert.fail(`session ${id}'s row never reached the expected state: ${JSON.stringify(last)}`);
}

const approved = (status) => (status.standingApprovals ?? []).some((approval) => approval.agent === 'claude-code' && approval.kind === 'smoke-test');

test(`${ID.update} live: without the standing approval, the first session on an uncovered Claude Code says the smoke test waits for you, and its holds stay watch-only`, async (t) => {
  const version = uncovered();
  if (approved(deepJson('status'))) assert.fail('BLOCKED: a standing approval for the Claude Code smoke test is in place; withdraw it to run this case');
  const id = startSession(t);
  const session = await row(id, (found) => found.smokeTest, 60_000);
  assert.equal(session.version, version);
  assert.equal(session.smokeTest.state, 'waiting-for-you', JSON.stringify(session));
  assert.equal(session.holds, 'watch-only', JSON.stringify(session));
});

test(`${ID.update} live: with the standing approval, the first session on an uncovered Claude Code starts the smoke test through the runner, its payloads come as one diff, the range doesn't widen and holds stay watch-only until you approve`, async (t) => {
  const version = uncovered();
  if (!approved(deepJson('status'))) assert.fail('BLOCKED: no standing approval for the Claude Code smoke test; give it to run this case');
  const first = await row(startSession(t), (found) => found.smokeTest?.state === 'diff-ready', 15 * 60_000);
  assert.equal(first.smokeTest.version, version, JSON.stringify(first));
  assert.ok(first.smokeTest.diff, `one diff for you: ${JSON.stringify(first.smokeTest)}`);
  assert.ok(String(first.smokeTest.job ?? '').startsWith(join(homedir(), '.deepbuild', 'jobs') + '/'), `the smoke test ran through the runner, in a job folder under ~/.deepbuild/jobs/: ${JSON.stringify(first.smokeTest)}`);
  assert.ok(first.smokeTest.withinReserve === true, `the smoke test ran inside your plan reserve: ${JSON.stringify(first.smokeTest)}`);
  assert.equal(first.holds, 'watch-only', `holds stay watch-only until you approve the diff for ${version}: ${JSON.stringify(first)}`);
  // A runner that widened the range on the smoke test's own run gates the next session.
  assert.ok(!readFacts('claude-code').facts.versions.includes(version), `the facts range widened to ${version} before you approved the diff`);
  const second = await row(startSession(t), (found) => found.smokeTest, 60_000);
  assert.equal(second.holds, 'watch-only', `the next session on ${version} is gated before you approved the diff: ${JSON.stringify(second)}`);
  assert.equal(second.smokeTest.diff, first.smokeTest.diff, `one smoke test per version, not one per session: ${JSON.stringify(second.smokeTest)}`);
});
