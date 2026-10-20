// #47 acceptance: what the recorded corpus under adapters/corpus/ holds, read as files. Nothing here
// runs the code under test; replay.test.mjs does. Run: node --test 'tests/acceptance/47/*.test.mjs'
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';
import {
  AGENTS, allCases, apparentBytes, CORPUS, DESIGN_HOOKS, factsEvents, ID, patchPaths, readFacts, requireCorpus, root, scratch, sessions, sets,
  setDir, SIZE_LIMIT, taggedCases, userAsks,
} from './helpers.mjs';

const coveredSets = () => AGENTS.flatMap((agent) => readFacts(agent).facts.versions.map((version) => ({ agent, version, dir: setDir(agent, version) })));

test(`${ID.coverage} every hook event a facts file lists for a covered version has a recorded payload in that version's set, and the lists hold the design's hooks`, () => {
  requireCorpus();
  for (const { agent, version, dir } of coveredSets()) {
    const events = factsEvents(agent, version);
    for (const hook of DESIGN_HOOKS[agent]) assert.ok(hook in events, `adapters/${agent}.facts.json events for ${version} leave out ${hook}, which the design says the adapter handles`);
    assert.ok(existsSync(dir), `no recorded set for ${agent} ${version}: ${relative(root, dir)} does not exist`);
    const recorded = new Set(sessions({ agent, version, dir }).flatMap((session) => session.cases.map((found) => found.payload?.hook_event_name)));
    for (const hook of Object.keys(events)) assert.ok(recorded.has(hook), `${agent} ${version}: no recorded ${hook} payload in ${relative(root, dir)}`);
  }
});

// The desktop app runs its own bundled Claude Code, which updates apart from the terminal's, so a
// desktop session belongs in the set of the version it ran, whichever that is; no covered version
// is required to have one.
test(`${ID.coverage} Claude Code's corpus holds sessions recorded in the terminal and in the desktop app, each in the set of the version it ran`, () => {
  const recorded = sets().filter((set) => set.agent === 'claude-code').flatMap((set) => sessions(set).map((session) => ({ set, session })));
  for (const surface of ['terminal', 'desktop']) {
    const found = recorded.filter(({ session }) => session.meta.surface === surface);
    assert.ok(found.length > 0, `no Claude Code session recorded with surface "${surface}" (got ${[...new Set(recorded.map(({ session }) => session.meta.surface))].join(', ') || 'none'})`);
    for (const { set, session } of found) {
      const where = relative(root, session.dir);
      assert.equal(session.meta.version, set.version, `${where}/session.json is tagged ${session.meta.version}, its set is ${set.version}`);
      const ran = new Set(readFileSync(session.transcriptPath, 'utf8').split('\n').filter((text) => text.trim()).map((text) => JSON.parse(text).version).filter((version) => typeof version === 'string'));
      assert.deepEqual([...ran], [set.version], `${where}: the ${surface} session ran ${[...ran].join(', ') || 'no named version'}, but is filed under ${set.version}`);
    }
  }
});

test(`${ID.coverage} each recorded session is tagged with the agent version it ran, and its transcript says the same`, () => {
  const all = sets();
  assert.ok(all.length > 0, 'the corpus holds no recorded set');
  for (const set of all) {
    for (const session of sessions(set)) {
      const where = relative(root, session.dir);
      assert.equal(session.meta.schema, 'corpus.session@1', `${where}/session.json schema`);
      assert.equal(session.meta.agent, set.agent, `${where}/session.json agent`);
      assert.equal(session.meta.version, set.version, `${where}/session.json version`);
      assert.ok(existsSync(session.transcriptPath) && statSync(session.transcriptPath).size > 0, `${where} has no transcript.jsonl`);
      // Claude Code writes its version on each transcript entry; Codex writes cli_version in session_meta.
      const versions = new Set();
      for (const line of readFileSync(session.transcriptPath, 'utf8').split('\n').filter((text) => text.trim())) {
        let entry;
        try { entry = JSON.parse(line); } catch (error) { assert.fail(`${where}/transcript.jsonl has a line that is not JSON: ${error.message}`); }
        if (set.agent === 'claude-code' && typeof entry.version === 'string') versions.add(entry.version);
        if (set.agent === 'codex' && typeof entry.payload?.cli_version === 'string') versions.add(entry.payload.cli_version);
      }
      assert.ok(versions.size > 0, `${where}/transcript.jsonl names no agent version`);
      assert.deepEqual([...versions], [set.version], `${where}: the transcript ran ${[...versions].join(', ')}, the set is tagged ${set.version}`);
    }
  }
});

// The repo's gitleaks rules (packages/evidence/gitleaks, v8.30.1) through the gitleaks binary.
function gitleaks(source, report) {
  const result = spawnSync('gitleaks', ['detect', '--no-git', '--source', source, '--config', join(root, 'packages/evidence/gitleaks/gitleaks.toml'),
    '--report-format', 'json', '--report-path', report, '--redact', '--no-banner', '--exit-code', '3'], { encoding: 'utf8', timeout: 300_000 });
  if (result.error) assert.fail(`BLOCKED: gitleaks did not run: ${result.error.message}; install gitleaks (brew install gitleaks)`);
  if (![0, 3].includes(result.status)) assert.fail(`BLOCKED: gitleaks exited ${result.status}: ${result.stderr.slice(-1000)}`);
  const findings = existsSync(report) ? JSON.parse(readFileSync(report, 'utf8') || '[]') : [];
  return { status: result.status, findings: findings.map(({ RuleID, File, StartLine }) => `${RuleID} ${relative(source, File)}:${StartLine}`) };
}

test(`${ID.secrets} a secret scan over the corpus finds nothing, and the same scan finds a key planted in a copy of a corpus transcript`, (t) => {
  requireCorpus();
  const directory = scratch(t);
  const clean = gitleaks(CORPUS, join(directory, 'corpus.json'));
  t.diagnostic(`gitleaks over adapters/corpus: exit ${clean.status}, ${clean.findings.length} findings`);
  assert.deepEqual(clean.findings, [], 'gitleaks found secrets in the corpus (values redacted)');
  assert.equal(clean.status, 0);
  // The twin: the scan isn't vacuous on the corpus's own file types. The key is generated here and
  // never written into the repo.
  const transcript = allCases()[0]?.session.transcriptPath;
  assert.ok(transcript, 'the corpus holds no session to copy');
  const planted = join(directory, 'planted');
  mkdirSync(planted);
  copyFileSync(transcript, join(planted, 'transcript.jsonl'));
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const key = `AKIA${Array.from({ length: 16 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')}`;
  writeFileSync(join(planted, 'transcript.jsonl'), `${readFileSync(transcript, 'utf8')}${JSON.stringify({ type: 'user', message: { content: `export AWS_ACCESS_KEY_ID=${key}` } })}\n`);
  const caught = gitleaks(planted, join(directory, 'planted.json'));
  assert.equal(caught.status, 3, 'gitleaks must report the planted key');
  assert.ok(caught.findings.some((finding) => finding.includes('transcript.jsonl')), caught.findings.join('\n'));
});

test(`${ID.secrets} no corpus file holds this machine's home folder or the git user's email`, () => {
  requireCorpus();
  const email = spawnSync('git', ['config', 'user.email'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const needles = [homedir(), email].filter((needle) => needle && needle.length > 3);
  const walk = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]));
  for (const file of walk(CORPUS)) {
    const text = readFileSync(file, 'utf8');
    for (const needle of needles) assert.ok(!text.includes(needle), `${relative(root, file)} holds personal data (a home folder or an email); redact it`);
  }
});

test(`${ID.expected} every recorded payload is stored with the events it must map to, where they were written from, and who reviewed them`, () => {
  const cases = allCases();
  assert.ok(cases.length > 0, 'the corpus holds no recorded payload');
  for (const { ref, case: recorded } of cases) {
    assert.equal(typeof recorded.payload?.hook_event_name, 'string', `${ref}: payload is the agent's hook JSON, with its hook_event_name`);
    assert.ok(Array.isArray(recorded.expect) && recorded.expect.length > 0, `${ref}: no expected events`);
    for (const event of recorded.expect) {
      assert.equal(typeof event?.kind, 'string', `${ref}: an expected event has no kind: ${JSON.stringify(event)}`);
      assert.ok(event.data && typeof event.data === 'object' && !Array.isArray(event.data), `${ref}: an expected ${event.kind} has no data object`);
    }
    assert.match(String(recorded.source ?? ''), /^https:\/\/\S+$/, `${ref}: source names the agent's documentation or schema the expected events were written from`);
    assert.ok(typeof recorded.reviewed === 'string' && recorded.reviewed.trim(), `${ref}: reviewed says who reviewed the expected events, and when`);
  }
});

// The prompt cases: each is a UserPromptSubmit with its session's transcript, stored with exactly
// one user.ask carrying the origin the design's ask rule gives it, and no ask event.
function assertPrompt(tag, agent, from) {
  const found = taggedCases(tag, agent);
  assert.ok(found.length > 0, `the corpus holds no ${agent} payload tagged "${tag}"`);
  for (const { ref, session, case: recorded } of found) {
    assert.equal(recorded.payload.hook_event_name, 'UserPromptSubmit', `${ref} is a prompt payload`);
    assert.ok(existsSync(session.transcriptPath) && statSync(session.transcriptPath).size > 0, `${ref}: its session has no transcript`);
    const asks = userAsks(recorded);
    assert.equal(asks.length, 1, `${ref}: stored with exactly one user.ask: ${JSON.stringify(recorded.expect)}`);
    assert.equal(asks[0].data.from, from, `${ref}: user.ask from`);
    for (const event of recorded.expect) assert.doesNotMatch(event.kind, /^ask\./, `${ref}: a ${from} prompt opens no ask`);
  }
  return found;
}

test(`${ID.prompts} the corpus holds a Claude Code /loop iteration, a background subagent's report and a message from another session as UserPromptSubmit payloads with their transcripts, none of them from you`, () => {
  assertPrompt('loop-iteration', 'claude-code', 'scheduled');
  assertPrompt('subagent-report', 'claude-code', 'subagent');
  assertPrompt('other-session-message', 'claude-code', 'session');
});

test(`${ID.prompts} the corpus holds a Codex patch with indented markers and one sent through the shell tool, each stored with the edit and every path it touches`, () => {
  for (const tag of ['patch-indented-markers', 'patch-via-shell']) {
    const found = taggedCases(tag, 'codex');
    assert.ok(found.length > 0, `the corpus holds no codex payload tagged "${tag}"`);
    for (const { ref, case: recorded } of found) {
      assert.equal(recorded.payload.hook_event_name, 'PreToolUse', `${ref} is a PreToolUse payload`);
      const { paths, indented } = patchPaths(recorded.payload);
      assert.ok(paths.length > 0, `${ref}: no *** Add/Update/Delete File or Move to line in its tool_input`);
      if (tag === 'patch-indented-markers') assert.ok(indented.length > 0, `${ref}: no marker line is indented`);
      if (tag === 'patch-via-shell') {
        assert.doesNotMatch(String(recorded.payload.tool_name), /^apply_?patch$/i, `${ref} goes through the shell tool, not apply_patch`);
        assert.match(JSON.stringify(recorded.payload.tool_input), /\bapply_?patch\b/, `${ref}: the shell command runs apply_patch or applypatch`);
      }
      const edits = recorded.expect.filter((event) => event.kind === 'tool.before' && event.data.kind === 'edit');
      assert.equal(edits.length, 1, `${ref}: stored with one tool.before of kind edit: ${JSON.stringify(recorded.expect)}`);
      assert.deepEqual([...edits[0].data.paths].sort(), paths, `${ref}: the stored paths are every path line, resolved against the session's folder`);
    }
  }
});

test(`${ID.continuation} the corpus holds a Codex goal's continuation, a Codex heartbeat and the Claude desktop app's resume prompt, each stored with a user.ask from continuation`, () => {
  assertPrompt('goal-continuation', 'codex', 'continuation');
  assertPrompt('heartbeat', 'codex', 'continuation');
  for (const { ref, session } of assertPrompt('desktop-resume-prompt', 'claude-code', 'continuation')) {
    assert.equal(session.meta.surface, 'desktop', `${ref} was recorded in the desktop app`);
  }
});

test(`${ID.budgets} the corpus stays under 200 MB`, (t) => {
  requireCorpus();
  const bytes = apparentBytes(CORPUS);
  t.diagnostic(`adapters/corpus: ${bytes} bytes`);
  assert.ok(bytes > 0, 'the corpus is empty');
  assert.ok(bytes < SIZE_LIMIT, `adapters/corpus is ${bytes} bytes; the budget is under ${SIZE_LIMIT}`);
});
