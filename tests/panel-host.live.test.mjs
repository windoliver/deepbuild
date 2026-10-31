// Live regression tests for the #358 panel host, on what its blind suite doesn't name: hostile panels and a client
// that talks across a panel's own timers. Builds the release host and app through the record's command; macOS only.
// Run: node --test --test-concurrency=1 tests/panel-host.live.test.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { scratch, writePanel } from './acceptance/358/panels.mjs';
import { binaries, check, run, serve, sleep } from './acceptance/358/run.mjs';
import { loadRecord } from './acceptance/358/validate.mjs';

const area = [100, 100, 400, 300];
const panel = (render, members = '') => `import { View, div } from "gpui-kit";
import { Button } from "gpui-base";
export default class P extends View {
  ${members}
  render() { return ${render}; }
}
`;
const spike = () => { const record = loadRecord(); return { record, bins: binaries(record) }; };
const report = (out) => JSON.parse(readFileSync(out, 'utf8'));
const kinds = (out) => report(out).violations.map((each) => each.kind);

async function checked(source, options = {}) {
  const { record, bins } = spike();
  const dir = scratch();
  const out = join(dir, 'report.json');
  const result = await check(record, bins, writePanel(source, options.manifest), { area, updates: 1, out, ...options });
  return { result, out };
}

test('a shorthand git dependency is refused like an object one, and the host never starts', async () => {
  const { result, out } = await checked(panel('div().size_full()'), { manifest: { id: 'com.example.short', name: 'Short', version: '1.0.0', entry: 'main.js', dependencies: { dep: 'http://127.0.0.1:9/dep.git' } } });
  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(kinds(out), ['git_dependency']);
  assert.equal(report(out).hostPid, null);
});

test('text in a box of no width, which a box measure skips, fails when it spills out of the panel', async () => {
  const { result, out } = await checked(panel('div().size_full().child(div().absolute().left(10).top(290).w(0).h(0).child("spills"))'));
  assert.equal(result.status, 1, result.stderr);
  assert.ok(kinds(out).includes('outside_panel'), JSON.stringify(report(out)));
});

test('text that fits its box passes', async () => {
  const { result, out } = await checked(panel('div().size_full().child(div().absolute().left(10).top(10).w(200).h(40).child("fits"))'));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(kinds(out), []);
});

test('a state style is refused: it would move a node the app never measured', async () => {
  const { result, out } = await checked(panel('div().size_full().hover((style) => style.left(9999))'));
  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(kinds(out), ['unknown_element']);
});

test('an action id can\'t hide the styles after it from the check', async () => {
  const { result, out } = await checked(panel(
    'div().size_full().child(div().on_action(\'"\', () => {}).absolute().left(-5000).w(500).h(500).on_action(\'"\', () => {}))',
  ));
  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(kinds(out), ['unknown_element']);
});

test('a panel that tracks focus and stays in bounds passes', async () => {
  const { result, out } = await checked(panel(
    'div().size_full().track_focus(this.a).on_action("deep.go", () => {})',
    'init(_props, cx) { this.a = cx.focus_handle(); }',
  ));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(kinds(out), []);
});

test('a check that stops on a later update keeps the failure it already found', async () => {
  const { result, out } = await checked(panel(
    'div().size_full()',
    'render() { if (this.n++ >= 1) throw new Error("late"); return div().absolute().left(-500).top(0).w(50).h(50); } n = 0;',
  ).replace('  render() { return div().size_full(); }\n', ''), { updates: 2 });
  assert.equal(result.status, 1, result.stderr);
  assert.deepEqual(kinds(out), ['outside_panel']);
  assert.equal(report(out).result, 'fail');
});

test('a check that stops with nothing found leaves no earlier pass beside it', async () => {
  const { record, bins } = spike();
  const out = join(scratch(), 'report.json');
  const good = writePanel(panel('div().size_full()'));
  assert.equal((await check(record, bins, good, { area, updates: 1, out })).status, 0);
  const bad = writePanel(panel('div()', 'render() { throw new Error("no"); }').replace('  render() { return div(); }\n', ''));
  assert.equal((await check(record, bins, bad, { area, updates: 1, out })).status, 2);
  assert.equal(report(out).result, 'inconclusive');
});

test('trees served after the first report reach it when the client closes', async () => {
  const { session, out } = await opened(panel('div().size_full()'));
  assert.ok((await session.send({ cmd: 'invalidate' }))?.tree);
  session.child.stdin.end();
  assert.equal(await session.exited, 0);
  assert.equal(report(out).trees.length, 2);
});

const nested = (levels) => `(() => { let node = div(); for (let i = 0; i < ${levels}; i++) node = div().child(node); return node; })()`;

test('a tree too deep is a check that could not tell', async () => {
  const { result } = await checked(panel(nested(200)));
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /levels deep/);
});

test('a tree at the depth limit lays out without taking the app down', async () => {
  const { result, out } = await checked(panel(nested(128)));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(kinds(out), []);
});

test('a check of nothing is no pass', async () => {
  const { record, bins } = spike();
  const dir = scratch();
  const none = await check(record, bins, writePanel(panel('div()')), { area, updates: 0, out: join(dir, 'none.json') });
  assert.equal(none.status, 2);
  const nan = await run([bins.app, 'panel-check', '--host', bins.host, '--panel', writePanel(panel('div()')), '--origin', 'agent_built', '--window', '800x600', '--panel-area', '0,0,10,10', '--card', 'nan,0,10,10', '--updates', '1', '--out', join(dir, 'nan.json')]);
  assert.equal(nan.status, 2);
});

const opened = async (source, options = {}) => {
  const { record, bins } = spike();
  const out = join(scratch(), 'report.json');
  const session = serve(record, bins, writePanel(source), { area, updates: 1, out, ...options });
  const ready = await session.next(60_000);
  assert.equal(ready?.ready, true);
  return { session, out };
};
const button = 'Button.new("go").w(100).h(40).child("go")';

test('a press that moved nothing leaves no serial for a timer to use later', async () => {
  // The first press takes focus to the button; the second, with focus there already, moves nothing and starts a timer.
  const { session } = await opened(panel(
    `div().size_full().child(div().w(10).h(10).track_focus(this.a)).child(${button}.on_click(() => { if (++this.n === 2) this.cx.timer.after(800, () => this.a.focus()); }))`,
    'init(_props, cx) { this.cx = cx; this.n = 0; this.a = cx.focus_handle(); }',
  ));
  try {
    await session.send({ cmd: 'press', id: 'go' });
    const second = await session.send({ cmd: 'press', id: 'go' });
    assert.ok(Number.isInteger(second?.serial), JSON.stringify(second));
    await session.send({ cmd: 'blur' });
    await sleep(1500);
    assert.equal((await session.send({ cmd: 'focus_owner' }))?.owner, 'app');
    const { moves } = await session.send({ cmd: 'focus_log' });
    assert.deepEqual(moves.at(-1), { serial: second.serial, result: 'refused' });
  } finally { await session.close(); }
});

test('a press on an element that is gone is an error, and the panel lives on', async () => {
  const { session } = await opened(panel(`div().size_full().child(${button})`));
  try {
    assert.ok((await session.send({ cmd: 'press', id: 'nothing-here' }))?.error);
    assert.ok(Number.isInteger((await session.send({ cmd: 'press', id: 'go' }))?.serial));
  } finally { await session.close(); }
});

test('a panel holding focus can\'t move it on to another of its elements unasked', async () => {
  const { session } = await opened(panel(
    'div().size_full().child(div().w(10).h(10).track_focus(this.b)).child(Button.new("go").w(100).h(40).child("go").track_focus(this.a).on_click(() => { this.a.focus(); this.cx.timer.after(400, () => this.b.focus()); }))',
    'init(_props, cx) { this.cx = cx; this.a = cx.focus_handle(); this.b = cx.focus_handle(); }',
  ));
  try {
    const pressed = await session.send({ cmd: 'press', id: 'go' });
    assert.equal((await session.send({ cmd: 'focus_owner' }))?.owner, 'panel');
    await sleep(1000);
    assert.equal((await session.send({ cmd: 'focus_owner' }))?.owner, 'app');
    const { moves } = await session.send({ cmd: 'focus_log' });
    assert.deepEqual(moves, [{ serial: pressed.serial, result: 'moved' }, { serial: pressed.serial, result: 'refused' }]);
  } finally { await session.close(); }
});

test('a command crossing a panel\'s timer move still happens, and its reply is its own', async () => {
  // The host alone, so the press is on its stdin, deterministically, before the verdict on the timer's move.
  const { bins } = spike();
  const dir = writePanel(panel(
    'div().size_full().child(div().w(10).h(10).track_focus(this.a)).child(`clicks:${this.clicks}`).child(Button.new("go").w(100).h(40).child("go").on_click(() => { this.clicks += 1; }))',
    'init(_props, cx) { this.clicks = 0; this.a = cx.focus_handle(); cx.timer.after(50, () => this.a.focus()); }',
  ));
  const host = spawn(bins.host, ['serve', '--panel', dir, '--draw'], { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = createInterface({ input: host.stdout })[Symbol.asyncIterator]();
  const next = async () => JSON.parse((await lines.next()).value);
  const send = (value) => host.stdin.write(`${JSON.stringify(value)}\n`);
  try {
    assert.equal((await next()).ready, true);
    send({ cmd: 'invalidate' });
    assert.ok((await next()).tree);
    assert.deepEqual(await next(), { move: { serial: null } });
    send({ cmd: 'press', id: 'go', serial: 1 });
    send({ granted: false });
    // A button takes focus as it's clicked, on the press's own serial.
    assert.deepEqual(await next(), { move: { serial: 1 } });
    send({ granted: true });
    assert.deepEqual(await next(), { pressed: true });
    send({ cmd: 'invalidate' });
    assert.match((await next()).tree, /clicks:1/);
  } finally { host.kill(); }
});

test('a tree served later is checked: its violations come back, the report fails and the exit is 1', async () => {
  const { session, out } = await opened(panel(
    'this.n++ >= 1 ? div().absolute().left(-500).top(0).w(50).h(50) : div().size_full()',
    'n = 0;',
  ));
  assert.equal(report(out).result, 'pass');
  const reply = await session.send({ cmd: 'invalidate' });
  assert.equal(reply?.violations?.[0]?.kind, 'outside_panel', JSON.stringify(reply));
  assert.equal(report(out).result, 'fail');
  session.child.stdin.end();
  assert.equal(await session.exited, 1);
});

test('a served panel that stays in bounds exits 0 when its client closes', async () => {
  const { session } = await opened(panel('div().size_full()'));
  session.child.stdin.end();
  assert.equal(await session.exited, 0);
});

test('a served tree that couldn\'t be checked ends inconclusive, never in a pass', async () => {
  const { session, out } = await opened(panel(
    'div().size_full()',
    'render() { if (this.n++ >= 1) throw new Error("late"); return div().size_full(); } n = 0;',
  ).replace('  render() { return div().size_full(); }\n', ''));
  assert.equal(report(out).result, 'pass');
  assert.ok((await session.send({ cmd: 'invalidate' }))?.error);
  assert.equal(report(out).result, 'inconclusive');
  session.child.stdin.end();
  assert.equal(await session.exited, 2);
});

test('a host that dies leaves the check inconclusive, and a command crossing its death is still answered', async () => {
  const { record, bins } = spike();
  const out = join(scratch(), 'report.json');
  const session = serve(record, bins, writePanel(panel('div().size_full()')), { area, updates: 1, out });
  const ready = await session.next(60_000);
  process.kill(ready.hostPid, 'SIGKILL');
  assert.equal((await session.send({ cmd: 'invalidate' }, 5000))?.error, 'host_gone');
  session.child.stdin.end();
  assert.equal(await session.exited, 2);
  assert.equal(report(out).result, 'inconclusive');
});

test('closing stdin right after a command still checks what that command brings', async () => {
  const { session, out } = await opened(panel(
    'this.n++ >= 1 ? div().absolute().left(-500).top(0).w(50).h(50) : div().size_full()',
    'n = 0;',
  ));
  session.child.stdin.end(`${JSON.stringify({ cmd: 'invalidate' })}\n`);
  assert.equal(await session.exited, 1);
  const written = report(out);
  assert.equal(written.result, 'fail');
  assert.deepEqual(written.trees.at(-1).bounds, written.violations[0].bounds);
});

test('a card with no question, a window of no size and an area outside the window are refused', async () => {
  const { bins } = spike();
  const dir = writePanel(panel('div()'));
  const argv = (extra) => [bins.app, 'panel-check', '--host', bins.host, '--panel', dir, '--origin', 'agent_built', '--updates', '1', '--out', join(scratch(), 'r.json'), ...extra];
  const size = ['--window', '800x600'];
  for (const extra of [
    [...size, '--panel-area', '0,0,10,10', '--card', '20,20,10,10'],
    ['--window', 'NaNxNaN', '--panel-area', '0,0,10,10'],
    [...size, '--panel-area', '700,0,200,10'],
  ]) assert.equal((await run(argv(extra))).status, 2, extra.join(' '));
});

test('a ping is answered while the host is busy with a render', async () => {
  const { session } = await opened(panel(
    'div().size_full()',
    'render() { if (this.n++ >= 1) { const end = Date.now() + 1500; while (Date.now() < end) {} } return div().size_full(); } n = 0;',
  ).replace('  render() { return div().size_full(); }\n', ''));
  try {
    session.child.stdin.write(`${JSON.stringify({ cmd: 'invalidate' })}\n`);
    await sleep(300);
    const started = performance.now();
    const pong = await session.send({ cmd: 'ping', seq: 7 }, 1000);
    assert.equal(pong?.pong, 7, JSON.stringify(pong));
    assert.ok(performance.now() - started < 1000);
    assert.ok((await session.next(5000))?.tree);
  } finally { await session.close(); }
});
