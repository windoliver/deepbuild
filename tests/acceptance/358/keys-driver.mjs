// Issue #358, criterion d4ccff93: reads the record, builds once, drives a check over JSON lines and
// works out, independently of the check, what each reply must say. See KEYS.md.
import { AssertionError } from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drawValues, INSERT_AT, REBUILDS, rowText, writePanel } from './keys-panel.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const RECORD = 'docs/spikes/358/keys.json';
const REPLY_MS = 60_000;
const BUILD_MS = 30 * 60_000;

const blocked = (why) => new AssertionError({ message: `BLOCKED: ${why}` });
const isCommand = (c) => Array.isArray(c) && c.length > 0 && c.every((p) => typeof p === 'string' && p !== '');

export function loadRecord() {
  let text;
  try { text = readFileSync(join(REPO, RECORD), 'utf8'); } catch { throw blocked(`${RECORD} is missing`); }
  let record;
  try { record = JSON.parse(text); } catch (e) { throw blocked(`${RECORD} is not JSON: ${e.message}`); }
  for (const name of ['build', 'check', 'planted']) {
    if (!isCommand(record?.[name]?.command)) throw blocked(`${RECORD} has no ${name}.command`);
  }
  if (JSON.stringify(record.check.command) === JSON.stringify(record.planted.command)) {
    throw blocked(`${RECORD}: planted.command is the same as check.command`);
  }
  return record;
}

let built;
function build(record) {
  built ??= spawnSync(record.build.command[0], record.build.command.slice(1), { cwd: REPO, encoding: 'utf8', timeout: BUILD_MS, maxBuffer: 1 << 28 });
  if (built.error) throw blocked(`the build did not run: ${built.error.message}`);
  if (built.status !== 0) throw blocked(`the build exited ${built.status}: ${String(built.stderr).slice(-800)}`);
}

class Check {
  constructor(command, panel) {
    this.lines = [];
    this.waiting = null;
    this.buffer = '';
    this.stderr = '';
    this.child = spawn(command[0], [...command.slice(1), '--panel', panel], { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
    this.exited = new Promise((resolve) => {
      this.child.on('error', (e) => { this.failure = blocked(`${command[0]} did not start: ${e.message}`); this.wake(); resolve({ code: null }); });
      this.child.on('close', (code) => { this.closed = true; this.wake(); resolve({ code }); });
    });
    this.child.stdin.on('error', () => {});
    this.child.stderr.on('data', (d) => { this.stderr = (this.stderr + d).slice(-800); });
    this.child.stdout.on('data', (d) => {
      this.buffer += d;
      const parts = this.buffer.split('\n');
      this.buffer = parts.pop();
      this.lines.push(...parts.filter((l) => l.trim() !== ''));
      this.wake();
    });
  }

  wake() { const w = this.waiting; this.waiting = null; w?.(); }

  async next(what) {
    const deadline = Date.now() + REPLY_MS;
    while (this.lines.length === 0) {
      if (this.failure) throw this.failure;
      if (this.closed) throw blocked(`the check exited before answering ${what}: ${this.stderr}`);
      const left = deadline - Date.now();
      if (left <= 0) throw blocked(`no reply to ${what} in ${REPLY_MS} ms: ${this.stderr}`);
      await new Promise((resolve) => {
        const t = setTimeout(resolve, left);
        this.waiting = () => { clearTimeout(t); resolve(); };
      });
    }
    const line = this.lines.shift();
    try { return JSON.parse(line); } catch { throw new Error(`the reply to ${what} is not JSON: ${line.slice(0, 200)}`); }
  }

  async send(command) {
    this.child.stdin.write(`${JSON.stringify(command)}\n`);
    const what = JSON.stringify(command);
    const reply = await this.next(what);
    if (reply?.ok !== true) throw new Error(`the check refused ${what}: ${JSON.stringify(reply).slice(0, 300)}`);
    return reply;
  }

  async finish() {
    this.child.stdin.end();
    const timer = setTimeout(() => this.child.kill('SIGKILL'), REPLY_MS);
    const { code } = await this.exited;
    clearTimeout(timer);
    return code;
  }
}

// One run of the scenario. `until` is the last rebuild driven. Returns what the check said and what the
// test's own model expected at each rebuild.
export async function drive(which, until = REBUILDS) {
  const record = loadRecord();
  build(record);
  const v = drawValues();
  const panel = writePanel(v);
  const check = new Check(record[which].command, panel);
  try {
    const ready = await check.next('the start');
    const steps = [];
    let index = v.startIndex;
    let value = [];
    let caret = 0;
    let composition = null;
    const insert = (text) => {
      const points = [...text];
      value = [...value.slice(0, caret), ...points, ...value.slice(caret)];
      caret += points.length;
    };
    const alphabet = [...'abcdefghijklmnopqrstuvwxyz0123456789é'];
    const char = () => alphabet[randomInt(alphabet.length)];
    const composing = [...'かきくけこ'];
    const kana = () => composing[randomInt(composing.length)];

    await check.send({ cmd: 'scroll', element: v.list, dy_px: index * v.rowH });
    await check.send({ cmd: 'focus', element: v.field });
    await check.send({ cmd: 'fold', element: v.foldOpen, open: true });

    for (let n = 1; n <= until; n += 1) {
      let delta = randomInt(1, 4) * (randomInt(2) ? 1 : -1);
      if (index + delta < 200) delta = Math.abs(delta);
      if (index + delta > 900) delta = -Math.abs(delta); // far from either end, so a scroll is never clamped
      await check.send({ cmd: 'scroll', element: v.list, dy_px: delta * v.rowH });
      index += delta;

      if (n === 48) { composition = kana(); await check.send({ cmd: 'compose', text: composition }); }
      else if (n === 49) { composition += kana(); await check.send({ cmd: 'compose', text: composition }); }
      else if (n === 53) {
        const text = kana();
        await check.send({ cmd: 'commit', text });
        insert(text);
        composition = null;
      } else if (composition === null) {
        const c = char();
        await check.send({ cmd: 'type', text: c });
        insert(c);
        if (n === 17) { await check.send({ cmd: 'caret_left', count: 3 }); caret -= 3; }
      }

      const before = { index, anchor: (n > INSERT_AT ? v.after : v.before)[index] };
      const reply = await check.send({ cmd: 'rebuild' });
      if (n === INSERT_AT) index += 1;
      const rows = n >= INSERT_AT ? v.after : v.before;
      steps.push({
        n, before, reply,
        expected: { index, anchor: rows[index], offset: index * v.rowH, value: value.join(''), caret, composition },
      });
    }
    const report = await check.send({ cmd: 'report' });
    const exit = await check.finish();
    return { v, ready, steps, report, exit };
  } finally {
    if (check.child.exitCode === null && !check.closed) check.child.kill('SIGKILL');
    rmSync(panel, { recursive: true, force: true });
  }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// What a host that follows keys must say after this rebuild. An empty list means it did.
export function scrollProblems(v, { n, reply, expected }) {
  const problems = [];
  const at = `rebuild ${n}`;
  if (reply.rebuilds !== n) problems.push(`${at}: the check counted ${reply.rebuilds} rebuilds`);
  if (reply.scroll?.anchor_key !== expected.anchor) problems.push(`${at}: the scroll is anchored to ${reply.scroll?.anchor_key}, not ${expected.anchor}`);
  if (reply.scroll?.offset_px !== expected.offset) problems.push(`${at}: the scroll offset of ${expected.anchor} is ${reply.scroll?.offset_px}, not ${expected.offset}`);
  problems.push(...visibleProblems(v, n, reply, expected.index));
  return problems;
}

// The rows drawn are the script's rows of this rebuild, starting at the row at `index`.
export function visibleProblems(v, n, reply, index) {
  const rows = n >= INSERT_AT ? v.after : v.before;
  const visible = reply.visible;
  const at = `rebuild ${n}`;
  if (!Array.isArray(visible)) return [`${at}: the reply has no visible rows`];
  const fits = v.listH / v.rowH;
  if (visible.length < Math.floor(fits) || visible.length > Math.ceil(fits) + 1) {
    return [`${at}: ${visible.length} rows visible, in a list that fits ${fits.toFixed(1)}`];
  }
  const wanted = rows.slice(index, index + visible.length).map((key) => ({ key, text: rowText(v, key, n) }));
  return same(visible, wanted) ? [] : [`${at}: the visible rows are ${JSON.stringify(visible.slice(0, 2))}…, not ${JSON.stringify(wanted.slice(0, 2))}…`];
}

export function fieldProblems(v, { n, reply, expected }) {
  const problems = [];
  const at = `rebuild ${n}`;
  if (reply.focus_key !== v.field) problems.push(`${at}: focus is on ${reply.focus_key}, not ${v.field}`);
  if (reply.field?.key !== v.field) problems.push(`${at}: the field reported is ${reply.field?.key}, not ${v.field}`);
  if (reply.field?.value !== expected.value) problems.push(`${at}: ${v.field} holds ${JSON.stringify(reply.field?.value)}, not ${JSON.stringify(expected.value)}`);
  if (reply.field?.caret !== expected.caret) problems.push(`${at}: the caret of ${v.field} is at ${reply.field?.caret}, not ${expected.caret}`);
  const composition = expected.composition === null ? null : { key: v.field, text: expected.composition };
  if (!same(reply.composition ?? undefined, composition ?? undefined) || reply.composition === undefined) {
    problems.push(`${at}: the composition is ${JSON.stringify(reply.composition)}, not ${JSON.stringify(composition)}`);
  }
  return problems;
}

export function foldProblems(v, { n, reply }) {
  return same(reply.open_folds, [v.foldOpen]) ? [] : [`rebuild ${n}: the open folds are ${JSON.stringify(reply.open_folds)}, not [${v.foldOpen}]`];
}
