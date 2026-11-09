// #1334 AC5 (README: The scenes, Contract): the same session, played through this checkout's deep-hook, twice. Against
// a hub of this checkout it works a turn in a trusted repo whose spec's one check passes, and its claim reads PASS:
// so the session can pass. Against a hub planted one contract major ahead (DEEP_HUB_PLANT=contract-major-ahead), the
// session's deep-hook is older than the hub's contract: every hook run must tell the session so, naming the contract,
// a call a fail_closed guard entry matches is denied as with the hub away, and after the turn, a restart of the hub
// (which replays deep-hook's spool) and a quiet record, no verdict reads PASS.
import { after, before, test } from 'node:test';
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  AHEAD, CHECKOUT, CLI, DEEP_HOOK, LONG, NODE, assert, entry, events, hello, hook, late, loadReading, sandbox, session, sessionOf, shown, spoiled, stopHub, until, wait,
} from './helpers.mjs';

const SPEC = 'claims:\n  done:\n    checks: [unit]\nchecks:\n  unit: { type: command, run: "node --test tests/unit.test.js", min_tests: 1 }\n';
const ADD = 'module.exports = { add: (a, b) => a + b };\n';
const UNIT = "const test = require('node:test');\nconst assert = require('node:assert');\nconst { add } = require('../src/add.js');\ntest('adds two numbers', () => assert.strictEqual(add(2, 3), 5));\n";
/**
 * The prompt the session types, and the definition its task is handed by that text (DEEP_HUB_TEST_DRAFTS, the kernel's
 * test fixture): one requirement of yours, judged by a drafted check under .deepbuild/checks/ that passes on the base
 * and after the edit. A task with no definition handed waits, and its claim is never judged.
 */
const PROMPT = 'make add take its numbers in either order, and keep the unit test passing';
const CHECK = '.deepbuild/checks/add.sh';
const DRAFTS = { drafts: [{ ask: PROMPT, deliverables: ['src/add.js'], budget: null, requirements: [{ id: 'R1', text: 'add takes its numbers in either order', source_line: 'ask#L1', refuted_by: 'a run where add(2, 3) is not 5', check: CHECK, on_base: 'passes', asserts: [], depth: 'unit', oracle: 'code', near_misses: [] }] }] };
const CHECK_TEST = "const test = require('node:test');\nconst assert = require('node:assert');\ntest('add takes either order', () => assert.strictEqual(require('../../src/add.js').add(2, 3), 5));\n";
/** A call the shipped default guards deny with the hub away: a kill by name, never run, only offered to the hook. */
const KILL = 'pkill -f d1334-fixture-never-runs';

/** A home whose root holds the shipped default guards, and a git repository Claude Code's own trust marks trusted. */
function world(box) {
  mkdirSync(box.root, { recursive: true, mode: 0o700 });
  copyFileSync(join(CHECKOUT, 'crates', 'deep-hook', 'default-rules.json'), join(box.root, 'rules.json'));
  const repo = join(box.dir, 'shop');
  for (const [path, text] of Object.entries({ [CHECK]: '#!/bin/sh\nnode --test .deepbuild/checks/add.test.cjs\n', '.deepbuild/checks/add.test.cjs': CHECK_TEST, '.deepbuild/done.yaml': SPEC, 'src/add.js': ADD, 'tests/unit.test.js': UNIT, 'package.json': '{ "name": "shop", "version": "1.0.0" }\n' })) {
    mkdirSync(join(repo, path, '..'), { recursive: true });
    writeFileSync(join(repo, path), text);
  }
  const git = (...args) => execFileSync('git', args, { cwd: repo, env: box.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'base');
  const real = realpathSync(repo);
  mkdirSync(join(box.home, '.claude'), { recursive: true });
  writeFileSync(join(box.home, '.claude', 'settings.json'), '{}\n');
  writeFileSync(join(box.home, '.claude.json'), `${JSON.stringify({ numStartups: 3, projects: { [real]: { allowedTools: [], hasTrustDialogAccepted: true } } }, null, 2)}\n`);
  writeFileSync(join(box.dir, 'drafts.json'), `${JSON.stringify(DRAFTS, null, 2)}\n`);
  return { repo: real, git };
}

/** `deep hub run` in the sandbox, with DEEP_HUB_PLANT when given: why it didn't print its ready line, or undefined once it did. */
async function startHub(box, plant) {
  const env = { ...box.env, DEEP_HUB_TEST_DRAFTS: join(box.dir, 'drafts.json'), ...(plant ? { DEEP_HUB_PLANT: plant } : {}) };
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: box.dir, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  box.children.push(child);
  let out = '', err = '';
  child.stderr.on('data', (d) => { err += d; });
  const ready = await Promise.race([
    new Promise((done) => child.stdout.on('data', (d) => { out += d; if (out.includes('\n')) done(true); })),
    new Promise((done) => child.on('exit', () => done(false))),
    wait(180_000).then(() => false),
  ]);
  return ready ? undefined : `the hub${plant ? ` with DEEP_HUB_PLANT=${plant}` : ''} didn't start: ${err.slice(-1500)}`;
}

/**
 * The session's turn in the repo: a prompt you typed, an edit to its source with the edit made and committed, a kill by
 * name offered, the final message and the stop.
 */
async function play(box, w, s, binary) {
  const runs = [];
  const prompt = randomUUID();
  const run = async (event, extra = {}) => { const r = await hook(box, s, event, { ...(event === 'SessionStart' ? {} : { prompt_id: prompt }), ...extra }, { binary }); runs.push(r); return r; };
  const call = async (input, response, effect) => {
    entry(s, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: input.tool_use_id, name: input.tool_name, input: input.tool_input }], stop_reason: 'tool_use' } });
    const before = await run('PreToolUse', input);
    if (before.status !== 0) return before;
    effect?.();
    entry(s, { promptId: prompt, type: 'user', message: { role: 'user', content: [{ tool_use_id: input.tool_use_id, type: 'tool_result', content: JSON.stringify(response) }] }, toolUseResult: response });
    await run('PostToolUse', { ...input, tool_response: response });
    return before;
  };
  await run('SessionStart');
  const text = PROMPT;
  entry(s, { promptId: prompt, type: 'user', message: { role: 'user', content: text }, turnPosition: { promptIndex: 0, turnIndex: 1 }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
  await run('UserPromptSubmit', { prompt: text });
  const file = join(w.repo, 'src', 'add.js');
  await call({ tool_name: 'Edit', tool_input: { file_path: file, old_string: '(a, b) => a + b', new_string: '(a, b) => b + a' }, tool_use_id: `toolu_${randomUUID().slice(0, 8)}e` },
    { filePath: file, oldString: '(a, b) => a + b', newString: '(a, b) => b + a' },
    () => { writeFileSync(file, `// ${s.id}\nmodule.exports = { add: (a, b) => b + a };\n`); w.git('commit', '-qam', 'add: either order'); });
  const kill = await call({ tool_name: 'Bash', tool_input: { command: KILL }, tool_use_id: `toolu_${randomUUID().slice(0, 8)}k` }, { stdout: '', stderr: '', interrupted: false });
  const done = 'Done: add takes its numbers in either order, and the unit test passes.';
  entry(s, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: done }], stop_reason: 'end_turn' } });
  await run('Stop', { last_assistant_message: done });
  return { runs, kill };
}
const passes = (all) => all.filter((e) => e.kind === 'verdict.made' && e.data?.outcome === 'PASS');

let o;
const cleanups = [];
after(async () => { for (const cleanup of cleanups) await cleanup(); });
before(async () => {
  o = {};
  // The control: this checkout's hub and deep-hook, which match.
  const a = await sandbox({ after: (cleanup) => cleanups.push(cleanup) });
  const wa = world(a);
  o.blockedA = await startHub(a);
  if (o.blockedA) return;
  // Up to three sessions, each in a fresh clone state of the repo, while a session's hooks are lost to the load rule.
  o.controls = [];
  for (let k = 0; k < 3; k++) {
    const sa = session(a, wa.repo);
    o.control = await play(a, wa, sa, DEEP_HOOK);
    o.controls.push({ late: o.control.runs.filter(late).map((r) => r.event) });
    // Until the session's claim has a verdict that isn't pending, or 5 minutes.
    o.controlEvents = await until(async () => { const all = await events(a).catch(() => undefined); return all && (passes(all).length || all.some((e) => e.kind === 'verdict.made' && sessionOf(e) === sa.id)) ? all : undefined; }, 300_000, 2000) ?? await events(a).catch(() => []);
    if (passes(o.controlEvents).length || !o.controls.at(-1).late.length) break;
  }
  // The hub one contract major ahead: this checkout's deep-hook is older than its contract.
  const b = await sandbox({ after: (cleanup) => cleanups.push(cleanup) });
  const wb = world(b);
  o.blockedB = await startHub(b, AHEAD);
  if (o.blockedB) return;
  o.hello = await hello(b, 5000);
  const sb = session(b, wb.repo);
  o.older = await play(b, wb, sb, DEEP_HOOK);
  // The hub restarts, so whatever deep-hook spooled is replayed, and the record is read once it's quiet.
  await wait(5000);
  await stopHub(b);
  o.blockedB = await startHub(b, AHEAD);
  if (o.blockedB) return;
  let last = -1;
  o.olderEvents = await until(async () => { const all = await events(b).catch(() => undefined); if (!all) return undefined; const n = all.length; const quiet = n === last; last = n; return quiet ? all : undefined; }, 120_000, 5000) ?? await events(b).catch(() => []);
  o.sb = sb;
}, LONG);

test('#1334.33ca60cb a session whose deep-hook is older than the hub\'s contract gets a clear refusal, and nothing is recorded as a PASS', LONG, () => {
  assert.equal(o.blockedA, undefined, `BLOCKED: ${o.blockedA}`);
  assert.ok(passes(o.controlEvents).length > 0 || !o.controls.every((c) => c.late.length), `INCONCLUSIVE: in each control session the hub took some hooks late, past deep-hook's 50 ms budget, so they were spooled and the turn can't be judged live (${JSON.stringify(o.controls)}), at ${loadReading()}`);
  assert.ok(passes(o.controlEvents).length > 0, `BLOCKED: with this checkout's hub and deep-hook the session's claim never read PASS, so the planted hub's record proves nothing (a run whose sandbox refused a library this Node links, such as Homebrew's node@24 linking libuv from another keg, reads uncounted: run the suite on the official Node 24.22 build, README: How to run): ${JSON.stringify(o.controlEvents.filter((e) => ['claim.made', 'verdict.made', 'run.finished', 'sandbox.denied'].includes(e.kind)).map((e) => [e.kind, e.data?.outcome ?? e.data?.target]))}`);
  assert.equal(o.blockedB, undefined, `the hub planted one contract major ahead must run (DEEP_HUB_PLANT=${AHEAD}, which the implementer adds to packages/hub/src/plant.ts): ${o.blockedB}`);
  const contract = o.hello?.contract;
  assert.ok(typeof contract === 'string' && /^\d+\.\d+$/.test(contract), `the hub's hello must name its contract, major.minor: ${JSON.stringify(o.hello)}`);
  for (const r of o.older.runs) {
    const text = `${r.stdout}\n${r.stderr}`;
    const told = /contract/i.test(text) && text.includes(contract);
    // A run that names no contract and that deep-hook spooled because the hub was late never saw the hub's answer.
    assert.ok(told || !late(r), `INCONCLUSIVE: the hub took the older session's ${r.event} late, past deep-hook's 50 ms budget, so whether it would have refused it can't be read, at ${loadReading()}: ${shown(r)}`);
    assert.ok(told, `deep-hook's ${r.event} run must tell the session it is older than the hub's contract ${contract}, naming it: ${shown(r)}`);
  }
  const dropped = o.older.runs.filter(spoiled).map((r) => r.event);
  assert.deepEqual(dropped, [], `INCONCLUSIVE: deep-hook lost the older session's ${dropped.join(', ')} to its own 50 ms budget at ${loadReading()}, so the record's silence proves nothing`);
  const passed = passes(o.olderEvents);
  assert.deepEqual(passed.map((e) => e.subject), [], 'nothing from a session whose deep-hook is older than the hub\'s contract may be recorded as a PASS, its spooled requests replayed included');
});

test('a contract mismatch fails closed with its reason: a call a fail_closed guard entry matches is denied, as with the hub away', LONG, () => {
  assert.equal(o.blockedB, undefined, `the hub planted one contract major ahead must run (DEEP_HUB_PLANT=${AHEAD}): ${o.blockedB}`);
  const kill = o.older.kill;
  assert.equal(kill.status, 2, `deep-hook must deny the kill by name, which the shipped kill:by-name entry holds fail_closed, when the hub refuses its contract: ${shown(kill)}`);
  assert.match(kill.stderr, /by name or port/i, 'the denial is the entry\'s own words');
  const contract = o.hello?.contract ?? '(the hub named none)';
  assert.ok(/contract/i.test(`${kill.stdout}\n${kill.stderr}`) && `${kill.stdout}\n${kill.stderr}`.includes(contract), `with its reason: the denial must also say the hub refused this deep-hook's older contract (${contract}): ${shown(kill)}`);
  assert.equal(o.control.kill.status, 2, `with matching contracts the hub denies the same call: ${shown(o.control.kill)}`);
});
