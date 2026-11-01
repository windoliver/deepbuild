// Live regression tests for `deep-app panel-keys`, on what the blind key suite doesn't name: a check that wasn't
// exercised, a host that went away and panels of other shapes. Needs the release binaries of docs/spikes/358/keys.json.
// Run: node --test --test-concurrency=1 tests/panel-keys.live.test.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import test, { after } from 'node:test';

const record = JSON.parse(readFileSync('docs/spikes/358/keys.json', 'utf8'));

// `tree` is the script's render, with `gen` the rebuild count, and `row(k)` a keyed row of 20 px.
// A test that fails leaves its check open: none may outlive the file.
const started = new Set();
after(() => { for (const child of started) child.kill('SIGKILL'); });

const open = async (tree, which = 'check') => {
  const { command } = record[which];
  const dir = mkdtempSync(join(tmpdir(), 'deep-358-regress-'));
  writeFileSync(join(dir, 'gpui-shell.json'), JSON.stringify({ id: 'dev.deepbuild.regress', name: 'Regress', version: '1.0.0', entry: 'main.js' }));
  writeFileSync(join(dir, 'main.js'), `import { View, div } from "gpui-kit";
import { v_flex, InputState, Input } from "gpui-base";
import { rebuild_count, fold } from "deepbuild";
const row = (k) => div().id(k).h(20).child(k);
const keys = (from, to) => Array.from({ length: to - from }, (_, i) => "r" + (from + i));
export default class P extends View {
  init() { this.draft = InputState.new({}); }
  render() { const gen = rebuild_count(); return ${tree}; }
}
`);
  const child = spawn(command[0], [...command.slice(1), '--panel', dir], { stdio: ['pipe', 'pipe', 'ignore'] });
  started.add(child);
  const exited = new Promise((resolve) => child.on('close', resolve));
  child.stdin.on('error', () => {});
  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const next = async () => JSON.parse((await lines.next()).value);
  const ready = await next();
  const send = async (cmd) => { child.stdin.write(`${JSON.stringify(cmd)}\n`); return next(); };
  const finish = () => { child.stdin.end(); return exited; };
  return { child, ready, next, send, finish };
};

const list = (rows, styles = '.h(100)') => `v_flex().id("list")${styles}.overflow_y_scroll().children(${rows})`;
const whole = (rows = 'keys(0, 100).map(row)') => `v_flex().id("root").size_full()
  .child(${list(rows)})
  .child(fold("f", "head", "body"))
  .child(div().id("field").child(Input.new(this.draft)))`;

// Every kind of state in hand, then one rebuild.
const exercise = async ({ send }, compose = true) => {
  await send({ cmd: 'scroll', element: 'list', dy_px: 200 });
  await send({ cmd: 'focus', element: 'field' });
  await send({ cmd: 'fold', element: 'f', open: true });
  await send({ cmd: 'type', text: 'abc' });
  if (compose) await send({ cmd: 'compose', text: 'か' });
  return send({ cmd: 'rebuild' });
};

test('a panel with every kind of state exercised over a rebuild passes', async () => {
  const check = await open(whole());
  const reply = await exercise(check);
  assert.equal(reply.ok, true, JSON.stringify(reply));
  assert.equal((await check.send({ cmd: 'report' })).verdict, 'PASS');
  assert.equal(await check.finish(), 0);
});

test('a check that took no command told nothing', async () => {
  const check = await open(whole());
  assert.equal(await check.finish(), 2);
});

test('a report with no rebuild is no pass', async () => {
  const check = await open(whole());
  assert.equal((await check.send({ cmd: 'report' })).verdict, 'INCONCLUSIVE');
  assert.equal(await check.finish(), 2);
});

test('a kind of state never held across a rebuild is no pass', async () => {
  const check = await open(whole());
  await exercise(check, false);
  assert.equal((await check.send({ cmd: 'report' })).verdict, 'INCONCLUSIVE');
  assert.equal(await check.finish(), 2);
});

test('a panel with no list answers no state, and ends inconclusive', async () => {
  const check = await open('div().id("root").h(20)');
  assert.equal((await check.send({ cmd: 'rebuild' })).ok, false);
  assert.equal((await check.send({ cmd: 'report' })).verdict, 'INCONCLUSIVE');
  assert.equal(await check.finish(), 2);
});

test('a script that throws at a rebuild is no pass, and no later rebuild is taken as an answer', async () => {
  const check = await open(`(() => { if (gen === 2) throw new Error("no"); return ${whole()}; })()`);
  assert.equal((await exercise(check)).ok, true);
  assert.equal((await check.send({ cmd: 'rebuild' })).ok, false);
  assert.equal((await check.send({ cmd: 'rebuild' })).ok, false);
  assert.equal((await check.send({ cmd: 'report' })).verdict, 'INCONCLUSIVE');
  assert.equal(await check.finish(), 2);
});

test('a host that died since the last rebuild is no pass', async () => {
  const check = await open(whole());
  await exercise(check);
  process.kill(check.ready.host_pid, 'SIGKILL');
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal((await check.send({ cmd: 'report' })).verdict, 'INCONCLUSIVE');
  assert.equal(await check.finish(), 2);
});

test('a line that isn\'t text is refused, and the commands after it are still answered', async () => {
  const check = await open(whole());
  check.child.stdin.write(Buffer.from([0xff, 0x0a]));
  assert.equal((await check.next()).ok, false);
  assert.equal((await exercise(check)).ok, true);
  assert.equal((await check.send({ cmd: 'report' })).verdict, 'INCONCLUSIVE');
  assert.equal(await check.finish(), 2);
});

test('a fold inside a row leaves later rows measured where they are', async () => {
  const rows = 'keys(0, 100).map((k) => k === "r0" ? div().id(k).h(20).child(fold("f0", "a", "b")) : row(k))';
  const check = await open(whole(rows));
  await check.send({ cmd: 'fold', element: 'f0', open: true });
  const scrolled = await check.send({ cmd: 'scroll', element: 'list', dy_px: 200 });
  assert.equal(scrolled.scroll.anchor_key, 'r10');
  const reply = await check.send({ cmd: 'rebuild' });
  assert.deepEqual(reply.scroll, { anchor_key: 'r10', offset_px: 200 });
  assert.equal(reply.visible[0].key, 'r10');
  await check.finish();
});

test('a key on two elements is refused: state can\'t follow it', async () => {
  const check = await open(whole('keys(0, 100).map((k) => row(gen >= 1 && k === "r30" ? "r5" : k))'));
  assert.equal((await check.send({ cmd: 'rebuild' })).ok, false);
  assert.equal(await check.finish(), 2);
});

test('a row with no key is refused: there is nothing to follow', async () => {
  const check = await open(whole('keys(0, 100).map((k) => gen >= 1 ? div().h(20).child(k) : row(k))'));
  assert.equal((await check.send({ cmd: 'rebuild' })).ok, false);
  assert.equal(await check.finish(), 2);
});

test('the visible rows come from the list\'s laid out box, not a height it declares', async () => {
  const tree = `v_flex().id("root").size_full().child(div().h(100).w(400).relative().child(${list('keys(0, 100).map(row)', '.size_full()')}))
    .child(fold("f", "head", "body")).child(div().id("field").child(Input.new(this.draft)))`;
  const check = await open(tree);
  const reply = await check.send({ cmd: 'rebuild' });
  assert.deepEqual(reply.visible.map((each) => each.key), ['r0', 'r1', 'r2', 'r3', 'r4']);
  await check.finish();
});

test('a list laid out in a way the scrolled rows wouldn\'t keep is refused', async () => {
  const tree = `v_flex().id("root").size_full().child(gen >= 1 ? ${list('keys(0, 100).map(row)', '.h(100).gap(10)')} : ${list('keys(0, 100).map(row)')})`;
  const check = await open(tree);
  assert.equal((await check.send({ cmd: 'rebuild' })).ok, false);
  assert.equal(await check.finish(), 2);
});

test('a row\'s text is found below its first level, and a fold\'s is what it shows', async () => {
  const rows = '[div().id("a").h(20).child(div().child("deep")), div().id("b").h(20).child(fold("f0", "head", "body"))]';
  const check = await open(whole(rows));
  const reply = await check.send({ cmd: 'rebuild' });
  assert.deepEqual(reply.visible, [{ key: 'a', text: 'deep' }, { key: 'b', text: 'head' }]);
  await check.finish();
});

test('a list never scrolled follows its first row: a row above it isn\'t a lost scroll', async () => {
  const check = await open(whole('(gen >= 1 ? ["new"] : []).concat(keys(0, 100)).map(row)'));
  const reply = await check.send({ cmd: 'rebuild' });
  assert.deepEqual(reply.scroll, { anchor_key: 'r0', offset_px: 20 });
  assert.deepEqual((await check.send({ cmd: 'report' })).failures, []);
  await check.finish();
});

test('a scroll partway into a row keeps its place in the row', async () => {
  const check = await open(whole());
  await check.send({ cmd: 'scroll', element: 'list', dy_px: 210 });
  const reply = await check.send({ cmd: 'rebuild' });
  assert.deepEqual(reply.scroll, { anchor_key: 'r10', offset_px: 210 });
  await check.finish();
});

test('an input inside a row leaves later rows measured where they are', async () => {
  const rows = 'keys(0, 100).map((k) => k === "r0" ? div().id(k).h(20).child(Input.new(this.draft)) : row(k))';
  const check = await open(`v_flex().id("root").size_full().child(${list(rows)})`);
  await check.send({ cmd: 'scroll', element: 'list', dy_px: 200 });
  const reply = await check.send({ cmd: 'rebuild' });
  assert.deepEqual(reply.scroll, { anchor_key: 'r10', offset_px: 200 });
  assert.equal(reply.visible[0].key, 'r10');
  await check.finish();
});

test('two open folds that swap places are still both open', async () => {
  const folds = '(gen >= 1 ? ["g", "f"] : ["f", "g"]).map((k) => fold(k, "head", "body"))';
  const check = await open(`v_flex().id("root").size_full().child(${list('keys(0, 100).map(row)')}).children(${folds})`);
  await check.send({ cmd: 'fold', element: 'f', open: true });
  await check.send({ cmd: 'fold', element: 'g', open: true });
  await check.send({ cmd: 'rebuild' });
  assert.deepEqual((await check.send({ cmd: 'report' })).failures, []);
  await check.finish();
});

test('a list never scrolled hasn\'t held a scroll: no pass', async () => {
  const check = await open(whole());
  await check.send({ cmd: 'focus', element: 'field' });
  await check.send({ cmd: 'fold', element: 'f', open: true });
  await check.send({ cmd: 'type', text: 'abc' });
  await check.send({ cmd: 'compose', text: 'か' });
  await check.send({ cmd: 'rebuild' });
  assert.equal((await check.send({ cmd: 'report' })).verdict, 'INCONCLUSIVE');
  assert.equal(await check.finish(), 2);
});

test('a list with no height of its own is refused: its rows would give it none', async () => {
  const tree = `v_flex().id("root").size_full().child(gen >= 1 ? ${list('keys(0, 100).map(row)', '')} : ${list('keys(0, 100).map(row)')})`;
  const check = await open(tree);
  assert.equal((await check.send({ cmd: 'rebuild' })).ok, false);
  assert.equal(await check.finish(), 2);
});

test('a row placed by hand is refused: the anchor is read from where the flow puts it', async () => {
  const rows = 'keys(0, 100).map((k) => gen >= 1 ? div().id(k).absolute().top(500).h(20).child(k) : row(k))';
  const check = await open(whole(rows));
  assert.equal((await check.send({ cmd: 'rebuild' })).ok, false);
  assert.equal(await check.finish(), 2);
});

test('a fold above the anchor opening keeps the same row at the top, in the reply and the next rebuild', async () => {
  const rows = '[fold("f0", "head", "body")].concat(keys(1, 100).map(row))';
  const check = await open(whole(rows));
  const before = await check.send({ cmd: 'scroll', element: 'list', dy_px: 200 });
  const opened = await check.send({ cmd: 'fold', element: 'f0', open: true });
  assert.equal(opened.scroll.anchor_key, before.scroll.anchor_key);
  assert.equal(opened.visible[0].key, before.scroll.anchor_key);
  const rebuilt = await check.send({ cmd: 'rebuild' });
  assert.deepEqual(rebuilt.scroll, opened.scroll);
  await check.finish();
});

test('an input below its keyed wrapper\'s first level is still that field', async () => {
  const check = await open(`v_flex().id("root").size_full().child(${list('keys(0, 100).map(row)')})
    .child(div().id("field").child(div().child(Input.new(this.draft))))`);
  await check.send({ cmd: 'focus', element: 'field' });
  const reply = await check.send({ cmd: 'type', text: 'ab' });
  assert.deepEqual(reply.field, { key: 'field', value: 'ab', caret: 2 });
  await check.finish();
});

test('a second input is refused: state follows one field', async () => {
  const check = await open(`v_flex().id("root").size_full().children(gen >= 1 ? [div().id("new").child(Input.new(this.draft))] : [])
    .child(${list('keys(0, 100).map(row)')}).child(div().id("field").child(Input.new(this.draft)))`);
  assert.equal((await check.send({ cmd: 'rebuild' })).ok, false);
  assert.equal(await check.finish(), 2);
});

test('an input holding a list is refused: it draws no children', async () => {
  const tree = `v_flex().id("root").size_full().child(div().id("field").child(gen >= 1 ? Input.new(this.draft).child(${list('keys(0, 100).map(row)')}) : Input.new(this.draft)))`;
  const check = await open(tree);
  assert.equal((await check.send({ cmd: 'rebuild' })).ok, false);
  assert.equal(await check.finish(), 2);
});

test('a value lost with its caret at 0 is a lost state', async () => {
  const tree = `v_flex().id("root").size_full().children(gen >= 1 ? [div().id("new")] : [])
    .child(div().id("field").child(Input.new(this.draft))).child(${list('keys(0, 100).map(row)')})`;
  const check = await open(tree, 'planted');
  await check.send({ cmd: 'focus', element: 'field' });
  await check.send({ cmd: 'type', text: 'abc' });
  await check.send({ cmd: 'caret_left', count: 3 });
  await check.send({ cmd: 'focus', element: 'root' });
  await check.send({ cmd: 'rebuild' });
  const { verdict, failures } = await check.send({ cmd: 'report' });
  assert.equal(verdict, 'FAIL');
  assert.ok(failures.some((each) => each.kind === 'caret'), JSON.stringify(failures));
  assert.equal(await check.finish(), 1);
});

test('a place inside the anchor lost with the anchor kept is a lost scroll', async () => {
  const tree = `v_flex().id("root").size_full().children(gen >= 1 ? [div().id("new")] : []).child(${list('keys(0, 100).map(row)')})`;
  const check = await open(tree, 'planted');
  await check.send({ cmd: 'scroll', element: 'list', dy_px: 10 });
  await check.send({ cmd: 'rebuild' });
  const { verdict, failures } = await check.send({ cmd: 'report' });
  assert.equal(verdict, 'FAIL');
  assert.ok(failures.some((each) => each.kind === 'scroll' && each.element === 'r0'), JSON.stringify(failures));
  assert.equal(await check.finish(), 1);
});

test('state that first appears at a rebuild was never lost', async () => {
  const check = await open(`v_flex().id("root").size_full().child(${list('(gen >= 1 ? keys(0, 100) : []).map(row)')})
    .children(gen >= 1 ? [div().id("field").child(Input.new(this.draft))] : [])`);
  await check.send({ cmd: 'rebuild' });
  assert.deepEqual((await check.send({ cmd: 'report' })).failures, []);
  await check.finish();
});

test('a row\'s text is all it draws, what was typed included', async () => {
  const rows = '[div().id("a").h(20).child(Input.new(this.draft)), div().id("b").h(20).child("one").child("two"), row("c")]';
  const check = await open(`v_flex().id("root").size_full().child(${list(rows)})`);
  await check.send({ cmd: 'focus', element: 'a' });
  const reply = await check.send({ cmd: 'type', text: 'hello' });
  assert.deepEqual(reply.visible, [{ key: 'a', text: 'hello' }, { key: 'b', text: 'onetwo' }, { key: 'c', text: 'c' }]);
  await check.finish();
});

test('a field nothing was typed in hasn\'t held a value: no pass', async () => {
  const check = await open(whole());
  await check.send({ cmd: 'scroll', element: 'list', dy_px: 200 });
  await check.send({ cmd: 'focus', element: 'field' });
  await check.send({ cmd: 'fold', element: 'f', open: true });
  await check.send({ cmd: 'compose', text: 'か' });
  await check.send({ cmd: 'rebuild' });
  assert.equal((await check.send({ cmd: 'report' })).verdict, 'INCONCLUSIVE');
  assert.equal(await check.finish(), 2);
});

test('rows replaced under a list never scrolled lose no scroll', async () => {
  const check = await open(whole('keys(gen, gen + 100).map(row)'));
  await check.send({ cmd: 'rebuild' });
  assert.deepEqual((await check.send({ cmd: 'report' })).failures, []);
  await check.finish();
});

test('rows past the panel\'s edge aren\'t visible', async () => {
  const check = await open(`div().id("root").size_full().child(div().absolute().top(950).w(400).h(100).child(${list('keys(0, 100).map(row)', '.size_full()')}))`);
  const reply = await check.send({ cmd: 'rebuild' });
  assert.deepEqual(reply.visible.map((each) => each.key), ['r0', 'r1']);
  await check.finish();
});

test('keyed rows inside a keyed row are refused: the scroll would follow the wrapper, not them', async () => {
  const rows = 'gen >= 1 ? [v_flex().id("content").children(keys(0, 100).map(row))] : keys(0, 100).map(row)';
  const check = await open(whole(rows));
  assert.equal((await check.send({ cmd: 'rebuild' })).ok, false);
  assert.equal(await check.finish(), 2);
});
