// #47 acceptance: the corpus replayed through the adapters, as `node scripts/corpus.mjs replay` and
// `check`. Planted corpora and facts are copies in a scratch folder; the real ones are never edited.
// Run: node --test 'tests/acceptance/47/*.test.mjs'
import assert from 'node:assert/strict';
import { closeSync, cpSync, ftruncateSync, openSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  AGENTS, allCases, assertReplayFails, assertReplayPasses, check, copyAgent, copySetAs, CORPUS, factsEvents, firstLeaf, ID,
  patchPaths, plantedVersion, plantFacts, plantSession, readFacts, replay, requireCorpus, scratch, sessionRef, sessions, setDir, setPath, show, SIZE_LIMIT, taggedCases,
  userAsks, writeCases,
} from './helpers.mjs';

const covered = (agent) => readFacts(agent).facts.versions;
const inCovered = (found) => covered(found.agent).includes(found.version);

/** Plants the session holding a case, applies edit(cases, recorded) to its events, replays the copy. */
function replayPlanted(t, found, edit) {
  const planted = plantSession(t, found);
  const cases = planted.session.cases;
  const recorded = cases.find(({ line }) => line === found.case.line);
  edit(recorded, cases);
  writeCases(planted.dir, cases);
  return replay(planted.corpus);
}

test(`${ID.expected} the whole corpus replays through the adapters and matches its stored events, payload by payload`, () => {
  requireCorpus();
  const cases = allCases();
  const run = replay();
  assertReplayPasses(run, 'the recorded corpus replays clean');
  for (const { ref } of cases) {
    const line = run.payload(ref);
    assert.ok(line, `the replay reports ${ref}\n${show(run.result)}`);
    assert.equal(line.result, 'match', `${ref}: ${JSON.stringify(line)}`);
    assert.equal(line.verified, true, `${ref}: ${JSON.stringify(line)}`);
  }
  assert.equal(run.lines.filter((line) => line.type === 'payload').length, cases.length, 'one payload line per recorded payload');
  for (const line of run.lines.filter((printed) => printed.type === 'session')) {
    assert.equal(line.verified, true, JSON.stringify(line));
    assert.equal(line.holds, 'active', JSON.stringify(line));
  }
});

test(`${ID.expected} the replay compares the stored events with the adapter's field by field: a changed, added or removed field, a missing event or no stored events fails, naming the payload`, (t) => {
  requireCorpus();
  const found = allCases().find(({ case: recorded }) => Object.keys(recorded.expect?.[0]?.data ?? {}).length > 0);
  assert.ok(found, 'no recorded payload with an expected event that has data');
  const leaf = firstLeaf(found.case.expect[0].data);
  assert.ok(leaf, `${found.ref}: no string or number in its first expected event's data`);
  const changed = assertReplayFails(replayPlanted(t, found, (recorded) => {
    setPath(recorded.expect[0].data, leaf.path, typeof leaf.value === 'number' ? leaf.value + 1 : `${leaf.value}-planted`);
  }), found.ref, `data.${leaf.path.join('.')} changed`);
  assert.ok((changed.diffs ?? []).some((diff) => String(diff.path).includes(String(leaf.path.at(-1)))), `the diff names the field ${leaf.path.join('.')}: ${JSON.stringify(changed)}`);
  assertReplayFails(replayPlanted(t, found, (recorded) => { recorded.expect[0].data.planted_extra = 'planted'; }), found.ref, 'a field added to the stored event');
  const [firstKey] = Object.keys(found.case.expect[0].data);
  assertReplayFails(replayPlanted(t, found, (recorded) => { delete recorded.expect[0].data[firstKey]; }), found.ref, `data.${firstKey} removed from the stored event`);
  assertReplayFails(replayPlanted(t, found, (recorded) => { recorded.expect.pop(); }), found.ref, 'a stored event removed');
  assertReplayFails(replayPlanted(t, found, (recorded) => { delete recorded.expect; }), found.ref, 'no stored events at all');
});

// The ask rule on recorded data: a planted corpus whose stored user.ask says `person` stands in for an
// adapter that maps the prompt to `person`, since the replay compares the two either way.
function assertPersonFails(t, tag, agent) {
  const found = taggedCases(tag, agent);
  assert.ok(found.length > 0, `the corpus holds no ${agent} payload tagged "${tag}"`);
  for (const one of found) {
    assert.equal(userAsks(one.case).length, 1, `${one.ref}: stored with one user.ask`);
    const run = replayPlanted(t, one, (recorded) => { userAsks(recorded)[0].data.from = 'person'; });
    assertReplayFails(run, one.ref, `${tag} read as from: person`);
  }
}

test(`${ID.prompts} the recorded /loop iteration, subagent report, other session's message and both Codex patches replay clean, and reading any prompt as yours fails the replay, naming the payload`, (t) => {
  requireCorpus();
  const run = replay();
  for (const tag of ['loop-iteration', 'subagent-report', 'other-session-message', 'patch-indented-markers', 'patch-via-shell']) {
    const found = taggedCases(tag);
    assert.ok(found.length > 0, `the corpus holds no payload tagged "${tag}"`);
    for (const { ref } of found) assert.equal(run.payload(ref)?.result, 'match', `${ref} (${tag}) replays clean: ${JSON.stringify(run.payload(ref))}\n${show(run.result)}`);
  }
  for (const tag of ['loop-iteration', 'subagent-report', 'other-session-message']) assertPersonFails(t, tag, 'claude-code');
  // An adapter that skips an indented marker line misses its path: stored without it, the replay fails.
  for (const found of taggedCases('patch-indented-markers', 'codex')) {
    const [path] = patchPaths(found.case.payload).indented;
    const planted = replayPlanted(t, found, (recorded) => {
      const edit = recorded.expect.find((event) => event.kind === 'tool.before');
      edit.data.paths = edit.data.paths.filter((stored) => stored !== path);
    });
    assertReplayFails(planted, found.ref, `the indented path ${path} left out`);
  }
});

test(`${ID.continuation} the payloads opening a Codex goal's continuation, a Codex heartbeat and the desktop app's resume prompt replay as continuations, and an adapter that reads any as yours fails the replay, naming the payload`, (t) => {
  requireCorpus();
  const run = replay();
  for (const [tag, agent] of [['goal-continuation', 'codex'], ['heartbeat', 'codex'], ['desktop-resume-prompt', 'claude-code']]) {
    const found = taggedCases(tag, agent);
    assert.ok(found.length > 0, `the corpus holds no ${agent} payload tagged "${tag}"`);
    for (const { ref } of found) assert.equal(run.payload(ref)?.result, 'match', `${ref} (${tag}) replays clean: ${JSON.stringify(run.payload(ref))}\n${show(run.result)}`);
    assertPersonFails(t, tag, agent);
  }
});

// ---- Drift: a recorded PreToolUse, changed, replayed as a live event of its covered version --------

function preToolUse(agent) {
  const found = allCases().find((one) => one.agent === agent && inCovered(one) && one.case.payload.hook_event_name === 'PreToolUse'
    && typeof one.case.payload.tool_input?.command === 'string' && typeof one.case.payload.session_id === 'string');
  assert.ok(found, `the corpus holds no ${agent} PreToolUse, of a covered version, with a session_id and a string tool_input.command`);
  return found;
}

function assertDrift(run, found, field, what) {
  const ref = sessionRef(found.agent, found.version, found.session.name);
  assert.notEqual(run.result.status, 0, `${what}: the replay fails\n${show(run.result)}`);
  assert.equal(run.payload(found.ref)?.verified, false, `${what}: ${found.ref} reads unverified: ${JSON.stringify(run.payload(found.ref))}\n${show(run.result)}`);
  const session = run.session(ref);
  assert.ok(session, `${what}: the replay reports the session ${ref}\n${show(run.result)}`);
  assert.equal(session.verified, false, `${what}: the session's events read unverified: ${JSON.stringify(session)}`);
  assert.equal(session.holds, 'watch-only', `${what}: the session's holds go watch-only: ${JSON.stringify(session)}`);
  assert.ok((session.readings ?? []).some((reading) => reading.field === field), `${what}: a reading names ${field}: ${JSON.stringify(session.readings)}`);
  return session;
}

const DRIFTS = [
  ['tool_input renamed', 'tool_input', (payload) => { payload.input = payload.tool_input; delete payload.tool_input; }],
  ['session_id removed', 'session_id', (payload) => { delete payload.session_id; }],
  ['tool_input.command turned into an array', 'tool_input.command', (payload) => { payload.tool_input.command = ['bash', '-lc', payload.tool_input.command]; }],
  ['an unknown hook_event_name', 'hook_event_name', (payload) => { payload.hook_event_name = 'PreToolCall'; }],
];

test(`${ID.shape} a changed payload shape fails the adapter's replay, naming the field, for each adapter`, (t) => {
  requireCorpus();
  for (const agent of AGENTS) {
    const found = preToolUse(agent);
    const [what, field, edit] = DRIFTS[0];
    assertDrift(replayPlanted(t, found, (recorded) => edit(recorded.payload)), found, field, `${agent}: ${what}`);
  }
});

test(`${ID.drift} for each adapter, a recorded PreToolUse with a renamed, removed or retyped field or an unknown event name reads unverified with holds watch-only, naming the field; an added unknown field changes nothing`, (t) => {
  requireCorpus();
  for (const agent of AGENTS) {
    const found = preToolUse(agent);
    // An adapter that reads tool_input.command with a default maps the renamed field to an empty
    // command and a verified event; the first case fails it, naming tool_input.
    for (const [what, field, edit] of DRIFTS) assertDrift(replayPlanted(t, found, (recorded) => edit(recorded.payload)), found, field, `${agent}: ${what}`);
    const added = replayPlanted(t, found, (recorded) => { recorded.payload.deepbuild_planted_field = 'planted'; });
    assertReplayPasses(added, `${agent}: an added unknown field changes nothing`);
    assert.equal(added.payload(found.ref)?.result, 'match', JSON.stringify(added.payload(found.ref)));
    assert.equal(added.payload(found.ref)?.verified, true, JSON.stringify(added.payload(found.ref)));
    const session = added.session(sessionRef(found.agent, found.version, found.session.name));
    assert.equal(session?.verified, true, JSON.stringify(session));
    assert.equal(session?.holds, 'active', JSON.stringify(session));
  }
});

test(`${ID.range} a recorded Stop with stop_hook_active removed, replayed as a live event of a covered version, records the stop unverified with one health reading naming the field and the version`, (t) => {
  requireCorpus();
  let tried = 0;
  for (const agent of AGENTS) {
    const found = allCases().find((one) => one.agent === agent && inCovered(one) && one.case.payload.hook_event_name === 'Stop' && 'stop_hook_active' in one.case.payload);
    if (!found) {
      assert.notEqual(agent, 'claude-code', 'the corpus holds no Claude Code Stop payload with stop_hook_active, of a covered version');
      continue;
    }
    tried++;
    const run = replayPlanted(t, found, (recorded) => { delete recorded.payload.stop_hook_active; });
    const session = assertDrift(run, found, 'stop_hook_active', `${agent}: Stop without stop_hook_active`);
    assert.equal(session.readings.length, 1, `${agent}: one health reading: ${JSON.stringify(session.readings)}`);
    assert.equal(session.readings[0].version, found.version, `${agent}: the reading names the version: ${JSON.stringify(session.readings[0])}`);
  }
  assert.ok(tried > 0);
});

// ---- The check: coverage, new versions, the facts range and size ---------------------------------

const failLines = (run) => run.result.stdout.split('\n').filter((line) => /^FAIL corpus: /.test(line));

test(`${ID.coverage} the check passes the recorded corpus, and fails a covered version whose set lacks an event the facts list, naming the version and the event`, (t) => {
  requireCorpus();
  const clean = check();
  assert.equal(clean.result.status, 0, show(clean.result));
  assert.match(clean.result.stdout, /^PASS corpus/m, show(clean.result));
  const agent = 'claude-code';
  const version = covered(agent).at(-1);
  const corpus = join(scratch(t), 'corpus');
  copyAgent(agent, corpus);
  for (const session of sessions({ agent, version, dir: setDir(agent, version, corpus) })) {
    writeCases(session.dir, session.cases.filter((one) => one.payload.hook_event_name !== 'PreToolUse'));
  }
  const run = check(corpus, plantFacts(t, agent));
  assert.notEqual(run.result.status, 0, show(run.result));
  assert.ok(failLines(run).some((line) => line.includes(version) && line.includes('PreToolUse')), `a FAIL line names ${version} and PreToolUse\n${show(run.result)}`);
});

test(`${ID.newVersion} the facts range widens only to a version whose recorded set replays clean, naming the version when it doesn't`, (t) => {
  requireCorpus();
  for (const agent of AGENTS) {
    const versions = covered(agent);
    const latest = versions.at(-1);
    const next = plantedVersion(versions);
    const events = factsEvents(agent, latest);
    const widen = (facts) => { facts.versions.push(next); facts.events.versions[next] = structuredClone(events); };
    const plant = () => {
      const corpus = join(scratch(t), 'corpus');
      copyAgent(agent, corpus);
      copySetAs(agent, latest, next, corpus);
      return corpus;
    };
    // Widened over a set that passes: the check passes.
    const widened = check(plant(), plantFacts(t, agent, widen));
    assert.equal(widened.result.status, 0, `${agent}: range widened to ${next} over a passing set\n${show(widened.result)}`);
    // Widened over a set that fails its replay: the check fails, naming the version.
    const corpus = plant();
    const broken = allCases(corpus).find((one) => one.version === next && Object.keys(one.case.expect?.[0]?.data ?? {}).length > 0);
    assert.ok(broken, `${agent} ${next}: no payload to break`);
    const leaf = firstLeaf(broken.case.expect[0].data);
    const cases = broken.session.cases;
    setPath(cases.find(({ line }) => line === broken.case.line).expect[0].data, leaf.path, typeof leaf.value === 'number' ? leaf.value + 1 : `${leaf.value}-planted`);
    writeCases(broken.session.dir, cases);
    const failing = check(corpus, plantFacts(t, agent, widen));
    assert.notEqual(failing.result.status, 0, `${agent}: range widened to ${next} over a set that fails\n${show(failing.result)}`);
    assert.ok(failLines(failing).some((line) => line.includes(next)), `a FAIL line names ${next}\n${show(failing.result)}`);
  }
});

test(`${ID.range} the check fails a facts range that covers a version with no recorded set, naming the version`, (t) => {
  requireCorpus();
  for (const agent of AGENTS) {
    const versions = covered(agent);
    const next = plantedVersion(versions);
    const corpus = join(scratch(t), 'corpus');
    copyAgent(agent, corpus);
    const events = factsEvents(agent, versions.at(-1));
    const facts = plantFacts(t, agent, (planted) => { planted.versions.push(next); planted.events.versions[next] = structuredClone(events); });
    const run = check(corpus, facts);
    assert.notEqual(run.result.status, 0, `${agent}: ${next} covered with no recorded set\n${show(run.result)}`);
    assert.ok(failLines(run).some((line) => line.includes(next)), `a FAIL line names ${next}\n${show(run.result)}`);
  }
});

test(`${ID.budgets} the check fails a corpus of 200 MB or more, naming the size`, (t) => {
  requireCorpus();
  const corpus = join(scratch(t), 'corpus');
  cpSync(CORPUS, corpus, { recursive: true });
  const [first] = allCases(corpus);
  assert.ok(first, 'the corpus holds no session');
  // A sparse file: its apparent size counts, though it takes no disk.
  const descriptor = openSync(join(first.session.dir, 'padding.bin'), 'w');
  ftruncateSync(descriptor, SIZE_LIMIT);
  closeSync(descriptor);
  const run = check(corpus);
  assert.notEqual(run.result.status, 0, show(run.result));
  const size = run.lines.find((line) => line.type === 'size');
  assert.ok(size && size.bytes >= SIZE_LIMIT && size.limit === SIZE_LIMIT, `the check prints the corpus size and its limit: ${JSON.stringify(size)}`);
  assert.ok(failLines(run).some((line) => /200 ?MB|200,?000,?000/.test(line)), `a FAIL line names the 200 MB limit\n${show(run.result)}`);
});

