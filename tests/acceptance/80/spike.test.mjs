// Fast acceptance tests for issue #80: the desktop hooks spike, read from what it leaves in the
// repo (spikes/80/decision.json, its hook logs and its throwaway hook scripts). No agent starts,
// no desktop app opens and nothing is spent.
// Run: node --test tests/acceptance/80/spike.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { extname, join, relative } from 'node:path';
import test from 'node:test';
import {
  CRITERIA, checks, configCommands, DESKTOP, id, idOf, loadSpike, PHASES, proofProblems, recordingProblems, repoFiles, root, sha256, spikeDir, STATUSES, SURFACES, transcriptProblems, walk, without,
} from './helpers.mjs';

const ALL = Object.keys(CRITERIA).map(id).join(' ');
const findingsOf = (record) => Object.entries(record.criteria ?? {}).flatMap(([key, entry]) => (Array.isArray(entry?.findings) ? entry.findings : []).map((finding) => ({ key, finding })));

// ---------------------------------------------------------------- the record itself

test(`${ALL} the decision record names every criterion once, each surface with the versions tested, and only throwaway hook scripts`, () => {
  const spike = loadSpike();
  const { record, logs } = spike;
  assert.equal(record.issue, 80);
  assert.match(record.baseCommit ?? '', /^[0-9a-f]{40}$/, 'the record names the base commit the spike ran on');
  assert.equal(spawnSync('git', ['merge-base', '--is-ancestor', record.baseCommit, 'HEAD'], { cwd: root }).status, 0, `${record.baseCommit} is not an ancestor of HEAD`);

  // Each surface: which agent, its version and, for an app, the app's version; and the hook
  // config the spike installed there, whose every command is one of its throwaway scripts.
  assert.ok(Array.isArray(record.hooks) && record.hooks.length > 0, 'the record lists its throwaway hook scripts');
  for (const hook of record.hooks) {
    assert.match(hook, /^hooks\/[^/]/, `hook scripts live under spikes/80/hooks/: ${hook}`);
    assert.ok(existsSync(join(spikeDir, hook)), `the hook script ${hook} is in the repo`);
    assert.doesNotMatch(readFileSync(join(spikeDir, hook), 'utf8'), /deep-hook|packages\/|adapters\//, `${hook} is a throwaway script, not deep-hook or the adapter`);
  }
  for (const surface of SURFACES) {
    const s = record.surfaces?.[surface];
    assert.ok(s, `the record has the ${surface} surface`);
    assert.equal(s.agent, surface.startsWith('claude') ? 'claude' : 'codex', `${surface}.agent`);
    assert.match(String(s.agentVersion), /^\d+\.\d+\.\d+/, `${surface} names the agent version tested`);
    if (DESKTOP.includes(surface)) assert.match(String(s.appVersion), /\d/, `${surface} names the app version tested`);
    else assert.equal(s.appVersion, null, `${surface} runs in a terminal, with no app version`);
    const commands = configCommands(s.config);
    assert.ok(commands.length > 0, `${surface} records the hook config the spike installed`);
    for (const command of commands) {
      assert.ok(record.hooks.some((hook) => String(command).includes(`spikes/80/${hook}`)), `${surface} runs ${command}, which is none of the spike's hook scripts`);
      assert.doesNotMatch(String(command), /deep-hook/, `${surface} runs deep-hook; the spike uses throwaway scripts`);
    }
  }

  assert.deepEqual(Object.keys(record.criteria ?? {}).sort(), Object.keys(CRITERIA).map(id).sort(), 'one entry per acceptance criterion, keyed by its ID');
  for (const [key, [hex, wording]] of Object.entries(CRITERIA)) {
    assert.equal(idOf(wording), hex, `the ID of ${key} is the hash of its text`);
    const entry = record.criteria[id(key)];
    assert.equal(entry.criterion.trim().replace(/\s+/g, ' '), wording, `${id(key)} quotes its criterion`);
    assert.ok(STATUSES.includes(entry.status), `${id(key)} has one of the five statuses: ${entry.status}`);
    assert.ok(Array.isArray(entry.findings), `${id(key)} lists its findings`);
  }
  for (const { key, finding } of findingsOf(record)) {
    assert.ok(SURFACES.includes(finding.surface), `${key}: a finding names its surface: ${JSON.stringify(finding)}`);
    if (finding.log !== undefined) assert.ok(logs.has(finding.log), `${key} on ${finding.surface} cites ${finding.log}, which is no log under spikes/80/logs/`);
    // The proof is screen recordings from Codex Desktop and, on the Claude desktop app, a recording
    // or entries copied from the session's transcript (owner decision, October 19). Only a route the
    // spike didn't find, and the ConfigChange findings, may rest on the version tested alone.
    const where = `${key} on ${finding.surface}`;
    const exempt = (key === id('route') && finding.route === null) || key === id('configChange');
    assert.ok(finding.transcript === undefined || finding.surface === 'claude-desktop', `${where}: only claude-desktop findings rest on a copied transcript`);
    if (DESKTOP.includes(finding.surface) && !exempt) assert.deepEqual(proofProblems(spike, finding, where), []);
    else if (finding.recording !== undefined) assert.deepEqual(recordingProblems(finding.recording, where), []);
    if (finding.transcript !== undefined) assert.deepEqual(transcriptProblems(spike, finding, where), []);
  }

  assert.ok(logs.size > 0, 'the spike keeps its hook logs under spikes/80/logs/');
  for (const [log, lines] of logs) for (const line of lines) {
    const where = `${log} line ${line.$index + 1}`;
    assert.equal(line.$unparsed, undefined, `${where} is not JSON`);
    assert.ok(Number.isFinite(line.at), `${where} has an epoch-ms time`);
    assert.ok(SURFACES.includes(line.surface), `${where} names its surface`);
    // A line copied from a transcript or rollout has no hook process, so no invocation.
    for (const field of ['session', 'event', ...(line.phase === 'copied' ? [] : ['invocation'])]) assert.equal(typeof line[field], 'string', `${where} has a ${field}`);
    assert.ok(PHASES.includes(line.phase), `${where} has a phase among ${PHASES.join(', ')}`);
  }
});

// ---------------------------------------------------------------- one test per criterion

// The criterion holds on the spike's own logs, the record says PASS, and the finding rests on the
// lines it cites: drop them and the same check fails, so a finding with no log line behind it
// can't pass.
function proven(key) {
  const spike = loadSpike();
  const result = checks[key](spike);
  assert.deepEqual(result.problems, [], `${id(key)} isn't shown by the spike's logs and record`);
  assert.equal(result.entry.status, 'PASS', `${id(key)} holds, so the record says PASS`);
  if (result.cited.length) assert.notDeepEqual(checks[key](without(spike, result.cited)).problems, [], `${id(key)}: without the log lines it cites, the check must fail`);
}

const titles = {
  held: 'a Stop held with decision: block reaches the agent with its reason, in the Claude desktop app and in Codex Desktop',
  wake: 'an idle interactive Claude Code session, never claude -p, wakes on an answer from its waiter in the terminal and in the desktop app, or its fallback shows the delay the record states',
  typed: 'a message typed while a tool call runs in the Claude desktop app shows up as an ask at the next hook, not as a new turn',
  verdict: 'a one-line verdict from a hook reply shows in the Claude desktop app and in Codex Desktop, with the recording',
  window: 'whether the Claude desktop app runs the status line command and Codex Desktop writes token events with rate_limits is shown by the logs, and an app that does neither has its first window reading named',
  codexHold: 'a Codex stop held by a hook with a 45-minute timeout continues with its reason after 45 minutes in the CLI and in Codex Desktop, or the cut is recorded, and the slow lane holds at least 5 s less',
  cap: 'nine send-backs in a row with no tool call show where Claude Code ends the turn, and the decision plans around at most that cap',
  codexApp: "whether any ~/.codex/hooks.json entry fires in Codex Desktop agrees with its log, and when none fires its sessions are watch-only",
  budgets: 'hook overhead p95 in both desktop apps matches its samples, and each held stop adds under 20 ms beyond its checks, on the reference Mac against the merge base',
  route: 'for the terminal and each app, a line during a 60 s tool call and anything fired before a session was deleted are shown by the log and a recording, or recorded as none',
  configChange: "whether ConfigChange fires when a Bash call's child edits ~/.claude/settings.json agrees with the logs, in the terminal and the desktop app",
};
for (const [key, title] of Object.entries(titles)) test(`${id(key)} ${title}`, () => proven(key));

// ---------------------------------------------------------------- invariants and evidence rules

test(`${ALL} nothing unproven is PASS: a criterion whose evidence doesn't hold is FAIL, BLOCKED, INVALID or INCONCLUSIVE`, () => {
  const spike = loadSpike();
  for (const key of Object.keys(CRITERIA)) {
    const result = checks[key](spike);
    assert.ok(STATUSES.includes(result.entry?.status), `${id(key)} has one of the five statuses`);
    if (result.problems.length) assert.notEqual(result.entry.status, 'PASS', `${id(key)} says PASS, but: ${result.problems.join('; ')}`);
  }
});

test(`${ALL} the spike's files hold no personal data, and its recordings stay outside the repo, named by hash`, () => {
  assert.ok(existsSync(spikeDir), 'BLOCKED: there is no spikes/80/ folder');
  const { record } = loadSpike();
  const git = (key) => spawnSync('git', ['config', key], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const personal = [homedir(), git('user.name'), git('user.email'), userInfo().username].filter((value) => value && value.length >= 3);
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const path of walk(spikeDir)) {
    const where = relative(root, path);
    assert.ok(!['.mp4', '.mov', '.m4v'].includes(extname(path).toLowerCase()), `${where} is a recording; recordings stay outside the repo, named by hash`);
    const bytes = readFileSync(path);
    assert.notEqual(bytes.toString('latin1', 4, 8), 'ftyp', `${where} is a recording; recordings stay outside the repo, named by hash`);
    const body = bytes.toString('utf8');
    for (const value of personal) assert.doesNotMatch(body, new RegExp(`(?<![\\w.-])${escape(value)}(?![\\w-])`, 'i'), `${where} holds this machine's user, home folder or git identity; redact it (home as ~)`);
    assert.doesNotMatch(body, /(?<![\w.-])(?:\/Users\/(?!Shared\/)|\/home\/)[\w.-]+\//, `${where} holds a home path; write it as ~`);
    for (const email of body.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []) assert.match(email, /@example\.(?:com|org|net|invalid)$/, `${where} holds an email address`);
  }
  const hashes = new Set(findingsOf(record).map(({ finding }) => finding.recording?.sha256).filter(Boolean));
  for (const path of repoFiles()) if (statSync(join(root, path)).size > 0) assert.ok(!hashes.has(sha256(join(root, path))), `${path} is a recording the record names; it stays outside the repo`);
});

test(`${id('configChange')} the Claude Code adapter adds a ConfigChange entry only where the decision says ConfigChange fires`, () => {
  const { record } = loadSpike();
  const entry = record.criteria?.[id('configChange')];
  assert.ok(entry, `the decision has no entry for ${id('configChange')}`);
  const fires = (entry.findings ?? []).filter((finding) => finding.observed === true).map((finding) => finding.surface);
  const adapterFiles = repoFiles().filter((path) => /^(?:adapters|packages|crates|scripts)\//.test(path) && !/node_modules\//.test(path))
    .filter((path) => statSync(join(root, path)).size < 2_000_000 && readFileSync(join(root, path), 'utf8').includes('ConfigChange'));
  if (!fires.length) assert.deepEqual(adapterFiles, [], 'the decision says ConfigChange fires nowhere, yet these files add or name a ConfigChange entry');
  assert.ok(entry.findings?.length >= 2, 'the decision records ConfigChange in the terminal and in the desktop app');
});
