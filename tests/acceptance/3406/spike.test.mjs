// Fast acceptance tests for issue #3406: the spike on a Claude Code session's own inbox as a
// delivery route, read from what it leaves in the repo (docs/spikes/3406/: its record, its report,
// its throwaway hook scripts, settings and hook logs; and the recordings it adds to the corpus).
// No agent starts, no app opens, nothing is posted to any inbox and nothing is spent.
// Run: node --test tests/acceptance/3406/spike.test.mjs
//
// One test per criterion carries its ID, and passes only when the whole criterion is shown: the
// trace lane reads a criterion as proven when any test tagged with it passes. The three tests on
// the record, on statuses and on personal data carry no ID, since they pass while a criterion is open.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';
import {
  baseProblems, checks, CRITERIA, id, idOf, lineProblems, loadSpike, MODES, OUTCOMES, PLACES, recordingFiles, root, sessionEvidence, SPIKE, spikeDir, STATES, STATUSES, WAYS, without,
} from './helpers.mjs';

// Each check runs once per run of this file, on the spike as the repo holds it.
let spike;
const results = new Map();
function result(key) {
  spike ??= loadSpike();
  if (!results.has(key)) results.set(key, checks[key](spike));
  return results.get(key);
}

// The criterion holds on what the spike left, the record says PASS, and each finding rests on the
// log lines it cites: drop them and the same check fails, so a finding with no line behind it
// can't pass. A place, mode or post that wasn't run reads BLOCKED and keeps its criterion open.
function proven(key) {
  const found = result(key);
  if (found.problems.length) assert.fail(`${found.problems.every((problem) => /^(?:BLOCKED|INCONCLUSIVE)\b/.test(problem)) ? `${found.problems[0].split(':')[0]}: ` : ''}${id(key)} is not shown by what the spike left:\n- ${found.problems.join('\n- ')}`);
  assert.equal(found.entry.status, 'PASS', `${id(key)} holds, so the record says PASS`);
  if (found.cited.length) assert.notDeepEqual(checks[key](without(spike, found.cited), { scans: false }).problems, [], `${id(key)}: without the log lines it cites, the check must fail`);
}

// The tags, written out so the proof lanes find this file and read each test's name from it.
const AC1 = '#3406.aee36c46', AC2 = '#3406.5fbeee00', AC3 = '#3406.79aefda5', AC4 = '#3406.3e30684e', AC5 = '#3406.76bfb799', AC6 = '#3406.62e7fbf4', AC7 = '#3406.1fb06894';
const TAGS = { places: AC1, latency: AC2, quotes: AC3, wakes: AC4, inbound: AC5, decision: AC6, issues: AC7 };

test(`${AC1} for the terminal, the desktop app, the editor extension and claude -p, in each mode and by each way to post, the session's own hook log and transcript show the post delivered, held or refused, or its version shows no route; a place or mode not run keeps this open`, () => proven('places'));
test(`${AC2} an idle session woke on at least 20 posts and, beside them, on its waiter at least 20 times, in one session; each time is the one its log shows from the post to the next hook, and p50 and p95 are those of the samples`, () => proven('latency'));
test(`${AC3} what the model received and the transcript entry's origin fields are quoted from a recording the spike added to the corpus; no recording holds a token's value, and the corpus recorder's redaction and its gitleaks scan pass on each`, () => proven('quotes'));
test(`${AC4} whether a claude -p session and a desktop app session woke on a post made after their stop agrees with each one's recording`, () => proven('wakes'));
test(`${AC5} a session whose settings set crossSessionInbound to hold, and one set to refuse, never received the post, and the record and the report say the route then reads absent`, () => proven('inbound'));
test(`${AC6} the token decision is a question whose every answer says what it costs, with nothing chosen, and this change puts the token's name in nothing it builds`, () => proven('decision'));
test(`${AC7} the report ends with the issues it proposes, each with its depends-on, and this change touches no package, crate or adapter file and builds nothing on the inbox`, () => proven('issues'));

// ---------------------------------------------------------------- the record, statuses, personal data

test('the record names the issue, its base commit, only throwaway hook scripts, each session with its place, version and settings, every post once, and one entry per criterion', () => {
  const left = loadSpike();
  const { record, logs } = left;
  assert.equal(record.issue, 3406);
  assert.deepEqual(baseProblems(record), []);

  assert.ok(Array.isArray(record.hooks) && record.hooks.length > 0, 'the record lists its throwaway hook scripts');
  for (const hook of record.hooks) {
    assert.match(String(hook), /^hooks\/[\w.-]+$/, `hook scripts live under ${SPIKE}/hooks/: ${hook}`);
    assert.ok(existsSync(join(spikeDir, hook)), `the hook script ${hook} is in the repo`);
    assert.doesNotMatch(readFileSync(join(spikeDir, hook), 'utf8'), /deep-hook|packages\/|adapters\//, `${hook} is a throwaway script, not deep-hook or the adapter`);
  }
  assert.ok(existsSync(join(spikeDir, 'README.md')), `the report is ${SPIKE}/README.md`);

  assert.deepEqual(Object.keys(record.criteria ?? {}).sort(), Object.keys(CRITERIA).map(id).sort(), 'one entry per acceptance criterion, keyed by its ID');
  for (const [key, [hex, wording]] of Object.entries(CRITERIA)) {
    assert.equal(idOf(wording), hex, `the ID of ${key} is the hash of its text`);
    assert.equal(TAGS[key], id(key), `the test of ${key} carries its criterion's ID`);
    const entry = record.criteria[id(key)];
    assert.equal(String(entry.criterion).trim().replace(/\s+/g, ' '), wording, `${id(key)} quotes its criterion`);
    assert.ok(STATUSES.includes(entry.status), `${id(key)} has one of the five statuses: ${entry.status}`);
  }

  assert.ok(logs.size > 0, `the spike keeps its hook logs under ${SPIKE}/logs/`);
  const lines = [...logs.values()].flat();
  assert.deepEqual(lines.flatMap(lineProblems).slice(0, 10), []);
  // A nonce is followed through a session by its text, so none may sit inside another.
  const nonces = [...new Set(lines.map((line) => line.nonce).filter((nonce) => typeof nonce === 'string'))];
  for (const nonce of nonces) assert.ok(!nonces.some((other) => other !== nonce && other.includes(nonce)), `the nonce ${nonce} is part of another nonce`);

  assert.ok(record.sessions && Object.keys(record.sessions).length > 0, 'the record lists the sessions it rests on');
  for (const session of Object.keys(record.sessions)) assert.deepEqual(sessionEvidence(left, session).problems, []);

  assert.ok(Array.isArray(record.posts) && record.posts.length > 0, 'the record lists its posts');
  const ids = record.posts.map((post) => post?.id), used = record.posts.map((post) => post?.nonce).filter((nonce) => nonce !== undefined);
  assert.equal(new Set(ids).size, ids.length, 'each post has an ID of its own');
  assert.equal(new Set(used).size, used.length, 'each post has a nonce of its own');
  for (const post of record.posts) {
    const where = `post ${JSON.stringify(post)}`;
    assert.match(String(post.id), /^[a-z0-9][a-z0-9-]*$/, `${where}: an ID in lower-case letters, digits and hyphens`);
    assert.ok(PLACES.includes(post.place), `${where}: its place`);
    assert.ok(STATES.includes(post.outcome), `${where}: its outcome, one of ${STATES.join(', ')}`);
    assert.ok(post.mode == null || MODES.includes(post.mode), `${where}: its mode, one of ${MODES.join(', ')}, or null for every mode`);
    assert.ok(post.way == null || WAYS.includes(post.way), `${where}: its way, one of ${WAYS.join(', ')}, or null for both`);
    assert.ok(post.inbound === undefined || ['hold', 'refuse'].includes(post.inbound), `${where}: inbound is hold or refuse, on a post under that setting only`);
    if (OUTCOMES.includes(post.outcome)) assert.ok(MODES.includes(post.mode) && WAYS.includes(post.way) && typeof post.session === 'string' && typeof post.nonce === 'string', `${where}: a post that was made names its mode, way, session and nonce`);
    else if (post.outcome === 'no-route') assert.ok(typeof post.session === 'string' && typeof post.reason === 'string' && post.reason.trim(), `${where}: no route names the session that shows it, and why`);
    else assert.ok(typeof post.reason === 'string' && post.reason.trim(), `${where}: it says why (reason)`);
  }
});

test("nothing unproven is PASS: a criterion whose evidence doesn't hold, or whose place, mode or post wasn't run, is FAIL, BLOCKED, INVALID or INCONCLUSIVE", () => {
  for (const key of Object.keys(CRITERIA)) {
    const found = result(key);
    assert.ok(STATUSES.includes(found.entry?.status), `${id(key)} has one of the five statuses`);
    if (found.problems.length) assert.notEqual(found.entry.status, 'PASS', `${id(key)} says PASS, but: ${found.problems.join('; ')}`);
  }
});

test("the spike's files and its corpus entries hold no personal data: no home folder, user name, git identity or email address", () => {
  if (!existsSync(spikeDir)) assert.fail(`BLOCKED: there is no ${SPIKE}/ folder`);
  const { logs, corpus, rest } = recordingFiles(loadSpike());
  const git = (key) => spawnSync('git', ['config', key], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const personal = [homedir(), git('user.name'), git('user.email'), userInfo().username].filter((value) => value && value.length >= 3 && value !== 'user');
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const path of [...logs, ...corpus, ...rest]) {
    const where = relative(root, path), body = readFileSync(path, 'utf8');
    for (const value of personal) assert.doesNotMatch(body, new RegExp(`(?<![\\w.-])${escape(value)}(?![\\w-])`, 'i'), `${where} holds this machine's user, home folder or git identity; redact it (home as ~)`);
    assert.doesNotMatch(body, /(?<![\w.-])(?:\/Users\/(?!Shared\/|user\/)|\/home\/(?!user\/))[\w.-]+\//, `${where} holds a home path; write it as ~`);
    // An address as the corpus recorder's redaction reads one (scripts/corpus-redact.mjs).
    for (const email of body.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []) assert.match(email, /@example\.(?:com|org|net|invalid)$/, `${where} holds an email address`);
  }
});
