// Live acceptance tests for #47: real Claude Code and Codex sessions on your own sign-in. They spend
// plan usage, so they run only by hand:
//   DEEP_CORPUS_LIVE=1 node --test --test-concurrency=1 tests/acceptance/47/corpus.live.test.mjs
// A missing opt-in, binary or sign-in fails the test with BLOCKED in its message;
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
