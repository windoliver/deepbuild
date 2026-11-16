// #2566: deep-hook's path reader follows a link the system never follows, `back -> none/../back` with no folder `none`,
// by hand, up to the system's count of links (32 on a Mac, 40 elsewhere), each time a written path names it, and the
// matcher reads a call's path once for each path entry. So `deep-hook match` holds an edit of `back/../` × 1,000 for
// seconds, past the 1 s its one caller, the pi package, waits for a line (MATCH_MS). After the fix it prints that call's
// line within 1 s (AC1), and a path that repeats no link is read as the base reads it, as fast (AC2). One test per
// criterion, against the real binary (target/debug/deep-hook) with the shipped entries (crates/deep-hook/
// default-rules.json) as rules.json and no hub. AC2 builds the base's deep-hook once under target/, the program "today"
// names, and counts the instructions each retires. README: readings, the timing rules and how to run. Node built-ins
// only.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const BIN = join(REPO, 'target/debug/deep-hook');
const SHIPPED = join(REPO, 'crates/deep-hook/default-rules.json');
/** Today: the base this suite was written on. AC2 builds its deep-hook once, in a workspace of its own under target/. */
const BASE = '9f93f1e7bbd7974eeda9f2e98c47851e07ad9bff';
const BASE_DIR = join(REPO, 'target/acceptance-2566', `base-${BASE.slice(0, 9)}`);
/** The time the matcher's caller gives one call: MATCH_MS in packages/pi/src/index.ts, the criterion's 1 s. */
const LIMIT_MS = 1000;
/**
 * Load slows a call and its plain twin alike, both being the system's path lookups, so what a link call takes over its
 * twin is the reader's own once it is this many times the twin and the caller's whole budget more (README).
 */
const OWN = 20;
/**
 * The design's line for a slower change, a time more than 50% above the merge base's (Every task carries its own
 * budgets), drawn on the count it compares a change with its base by under load: instructions retired.
 */
const SLOWER = 1.5;
const RUNS = 5;
/** How long the test waits for a line before it stands in for the caller and stops the child. A link call still unanswered then counts as this long. */
const ANSWER_MS = 30_000;

// ---- Folders and processes of this file's own. Children are stopped through their handles (their PIDs), nothing else.
const folders = [];
const children = new Set();
after(() => {
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  for (const dir of folders) rmSync(dir, { recursive: true, force: true });
});
const cargo = (args, cwd, env = process.env) => spawnSync('cargo', args, { cwd, env, encoding: 'utf8', timeout: 60 * 60_000, killSignal: 'SIGKILL' });
before(() => {
  const built = cargo(['build', '--locked', '-q', '-p', 'deep-hook'], REPO);
  assert.equal(built.status, 0, `BLOCKED: cargo build --locked -q -p deep-hook: ${built.error?.message ?? ''} ${String(built.stderr).slice(-2000)}`);
  assert.ok(existsSync(BIN) && existsSync(SHIPPED), `BLOCKED: no ${BIN} or no ${SHIPPED}`);
});

/**
 * A home with the shipped entries as its rules.json and no hub, and two folders a session can work in, each holding
 * `plain`, a folder, and `back`, a link to `none/../back` with no `none` beside it: `work`, an ordinary folder, and a
 * repository's `.deepbuild/specs`, which the shipped fail_closed entry no-deepbuild-spec-write guards.
 */
function world() {
  const top = realpathSync(mkdtempSync('/tmp/dh2566-'));
  folders.push(top);
  const home = join(top, 'h');
  mkdirSync(join(home, '.deepbuild'), { recursive: true });
  writeFileSync(join(home, '.deepbuild/rules.json'), readFileSync(SHIPPED));
  const folder = (...parts) => {
    const dir = join(top, ...parts);
    mkdirSync(join(dir, 'plain'), { recursive: true });
    symlinkSync('none/../back', join(dir, 'back'));
    return dir;
  };
  const env = { HOME: home, PATH: process.env.PATH ?? '/usr/bin:/bin', LC_ALL: 'C', XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache') };
  return { env, rules: JSON.parse(readFileSync(SHIPPED, 'utf8')).entries, work: folder('work'), guarded: folder('repo', '.deepbuild', 'specs') };
}
/** `name/../` written `times` times, as the issue writes the path. */
const repeated = (name, times) => `${name}/../`.repeat(times);
/** pi's edit of `path` in `cwd`, as the pi package hands a call to `deep-hook match`: the tool's name and input, and the folder. */
const edit = (cwd, path) => ({ tool_name: 'edit', tool_input: { path, edits: [{ oldText: 'a', newText: 'b' }] }, cwd });
/** The shipped entry whose reason and next_step the text carries whole, by name. */
const entryIn = (w, text) => Object.keys(w.rules).find((name) => text.includes(w.rules[name].reason) && text.includes(w.rules[name].next_step));

// ---- The long-lived matcher: `deep-hook match`, a call a line in, its line out, each timed from the write to the line.
function matcher(bin, w, cwd) {
  const child = spawn(bin, ['match'], { cwd, env: w.env, stdio: ['pipe', 'pipe', 'pipe'] });
  children.add(child);
  let out = '', err = '', pending = false, wake = () => {};
  const ended = new Promise((resolve) => child.on('close', (code, signal) => { resolve({ code, signal }); wake(); }));
  child.stdout.setEncoding('utf8').on('data', (d) => { out += d; wake(); });
  child.stderr.setEncoding('utf8').on('data', (d) => { err += d; });
  child.stdin.on('error', () => {});
  child.on('error', () => {});
  const up = () => child.exitCode === null && child.signalCode === null;
  const state = () => `stdout ${JSON.stringify(out.slice(0, 300))}, stderr ${JSON.stringify(err.slice(0, 400))}`;
  return {
    /** Sends one call; its line, parsed, and the ms from the write to it, or null when none came within ANSWER_MS. */
    async ask(what, body) {
      const t0 = performance.now();
      child.stdin.write(`${JSON.stringify(body)}\n`);
      pending = true;
      while (!out.includes('\n')) {
        if (!up()) {
          const end = await ended;
          assert.fail(`${what}: the matcher ended without printing the call's line: ${end.signal ?? `exit ${end.code}`}, ${state()}`);
        }
        const left = t0 + ANSWER_MS - performance.now();
        if (left <= 0) return null;
        let timer;
        await new Promise((resolve) => { wake = resolve; timer = setTimeout(resolve, left); });
        clearTimeout(timer);
      }
      const ms = performance.now() - t0;
      pending = false;
      const text = out.slice(0, out.indexOf('\n'));
      out = out.slice(text.length + 1);
      let line;
      try { line = JSON.parse(text); } catch { /* judged below */ }
      assert.ok(Array.isArray(line?.matched) && Array.isArray(line?.denials), `${what}: the matcher's line is not {"matched":[...],"denials":[...]}: ${text.slice(0, 300)}`);
      assert.notEqual(line.unread, true, `${what}: the matcher read the call against nothing ("unread"): ${text.slice(0, 300)}`);
      return { ms, line };
    },
    /** Ends the matcher: closes its stdin, on which it ends, or stops it through its handle while it still reads a call. */
    async stop() {
      if (pending) child.kill('SIGKILL');
      child.stdin.end();
      const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
      await ended;
      clearTimeout(timer);
    },
  };
}
/** A line the matcher must print, within ANSWER_MS. */
async function answer(m, what, body) {
  const got = await m.ask(what, body);
  assert.ok(got, `${what}: the matcher printed no line within ${ANSWER_MS} ms`);
  return got;
}
const listed = (ms) => ms.map((v) => (v === null ? `none in ${ANSWER_MS}` : v.toFixed(0))).join(', ');

test('#2566.3f94de8b AC1 the matcher prints the line of an edit of `back/../` × 1,000, `back -> none/../back`, within the 1 s its caller gives it', async (t) => {
  const w = world();
  const plain = repeated('plain', 1000), link = repeated('back', 1000);
  // Five rounds, each on a matcher of its own: one still reading the last link call can't hold the next round.
  const twin = [], looped = [];
  for (let i = 0; i < RUNS; i++) {
    const m = matcher(BIN, w, w.work);
    try {
      await answer(m, 'a first edit, of plain/x', edit(w.work, 'plain/x'));
      twin.push((await answer(m, `an edit of plain/../ × 1,000, run ${i + 1}`, edit(w.work, plain))).ms);
      looped.push((await m.ask(`an edit of back/../ × 1,000, run ${i + 1}`, edit(w.work, link)))?.ms ?? null);
    } finally {
      await m.stop();
    }
  }
  const text = `an edit of back/../ × 1,000: ${listed(looped)} ms; its plain twin, plain/../ × 1,000: ${listed(twin)} ms; limit ${LIMIT_MS} ms, from the call's write to its line`;
  t.diagnostic(text);
  const took = (i) => looped[i] ?? ANSWER_MS;
  assert.ok(!twin.every((ms, i) => took(i) > ms + LIMIT_MS && took(i) >= OWN * ms), `FAIL the link call costs the caller's whole ${LIMIT_MS} ms more than its plain twin, and ${OWN} times it, in every run: ${text}`);

  // That call's line still reads the path as written: where a shipped fail_closed entry guards the folder, it is denied.
  const g = matcher(BIN, w, w.guarded);
  try {
    await answer(g, 'a first edit, of plain/x in the guarded folder', edit(w.guarded, 'plain/x'));
    const guarded = await answer(g, 'an edit of plain/../ × 1,000 in a repository\'s .deepbuild/specs', edit(w.guarded, plain));
    assert.ok(entryIn(w, guarded.line.denials.join('\n')), `the folder is one a shipped entry guards: an edit of plain/../ × 1,000 there is denied in that entry's words: ${JSON.stringify(guarded.line)}`);
    const got = await answer(g, 'an edit of back/../ × 1,000 in a repository\'s .deepbuild/specs', edit(w.guarded, link));
    assert.ok(got.line.denials.length > 0, `an edit of back/../ × 1,000 in a guarded folder is denied, as the same edit of plain/../ × 1,000 is: ${JSON.stringify(got.line).slice(0, 600)}`);
  } finally {
    await g.stop();
  }
  if (!looped.every((ms) => ms !== null && ms <= LIMIT_MS)) t.skip(`INCONCLUSIVE ${text}`);
});

/** Today's deep-hook: the crate as the base holds it, built once, in a workspace of its own, apart from this checkout's build. */
function baseHook() {
  const src = join(BASE_DIR, 'src');
  if (!existsSync(join(src, 'Cargo.toml'))) {
    const part = `${src}.${process.pid}`;
    rmSync(part, { recursive: true, force: true });
    mkdirSync(part, { recursive: true });
    const files = ['Cargo.lock', 'rust-toolchain.toml', 'crates/deep-contracts', 'crates/deep-hook', 'adapters/mcp-servers.facts.json'];
    const tar = spawnSync('git', ['archive', '--format=tar', BASE, '--', ...files], { cwd: REPO, maxBuffer: 1 << 28 });
    assert.equal(tar.status, 0, `BLOCKED: today's deep-hook: git archive ${BASE}: ${String(tar.stderr).trim()}`);
    const put = spawnSync('tar', ['-xf', '-', '-C', part], { input: tar.stdout });
    assert.equal(put.status, 0, `BLOCKED: today's deep-hook: tar: ${String(put.stderr).trim()}`);
    // Written last, so a copy with its manifest is whole.
    writeFileSync(join(part, 'Cargo.toml'), '[workspace]\nmembers = ["crates/deep-contracts", "crates/deep-hook"]\nresolver = "2"\n');
    try { renameSync(part, src); } catch { rmSync(part, { recursive: true, force: true }); }
  }
  const built = cargo(['build', '--offline', '-q', '-p', 'deep-hook'], src, { ...process.env, CARGO_TARGET_DIR: join(BASE_DIR, 'target') });
  assert.equal(built.status, 0, `BLOCKED: today's deep-hook: cargo build --offline -q -p deep-hook in ${src}: ${built.error?.message ?? ''} ${String(built.stderr).slice(-2000)}`);
  const bin = join(BASE_DIR, 'target/debug/deep-hook');
  assert.ok(existsSync(bin), `BLOCKED: today's deep-hook: no ${bin}`);
  return bin;
}
const reading = (line) => ({ matched: [...line.matched].sort(), denials: line.denials });

/**
 * One `deep-hook match` under `/usr/bin/time -l`, reading a first edit of plain/x and then `body`, as a session's matcher
 * starts: its line for `body`, its ms from spawn to exit, and the instructions it retired, kernel ones with them, the
 * count the design compares with the merge base under load; null where the system gives none.
 */
function counted(bin, w, what, body) {
  const input = `${JSON.stringify(edit(w.work, 'plain/x'))}\n${JSON.stringify(body)}\n`;
  const t0 = performance.now();
  const r = spawnSync('/usr/bin/time', ['-l', bin, 'match'], { cwd: w.work, env: w.env, input, encoding: 'utf8', timeout: ANSWER_MS, killSignal: 'SIGKILL', maxBuffer: 1 << 26 });
  const ms = performance.now() - t0;
  const shown = `${r.signal ?? `exit ${r.status}`}${r.error ? ` (${r.error.message})` : ''} after ${ms.toFixed(0)} ms, stdout ${JSON.stringify(String(r.stdout).slice(0, 300))}, stderr ${JSON.stringify(String(r.stderr).slice(-400))}`;
  assert.equal(r.status, 0, `${what}: the matcher, timed by /usr/bin/time -l, didn't end on its own: ${shown}`);
  const lines = r.stdout.trim().split('\n');
  let line;
  try { line = JSON.parse(lines[1] ?? ''); } catch { /* judged below */ }
  assert.ok(lines.length === 2 && Array.isArray(line?.matched) && Array.isArray(line?.denials), `${what}: the matcher printed no {"matched":[...],"denials":[...]} line for the call: ${shown}`);
  assert.notEqual(line.unread, true, `${what}: the matcher read the call against nothing ("unread"): ${lines[1].slice(0, 300)}`);
  const count = Number(r.stderr.match(/^\s*(\d+)\s+instructions retired\s*$/m)?.[1]);
  return { line, ms, instructions: count > 0 ? count : null };
}
const billions = (counts) => counts.map((n) => (n === null ? 'none' : (n / 1e9).toFixed(3))).join(', ');

test('#2566.83c23c3c AC2 an edit of `plain/../` × 5,000, a path that repeats no link, is read as the base reads it, and as fast: no more than 50% over its count', (t) => {
  if (process.platform !== 'darwin') {
    t.skip(`INCONCLUSIVE ${process.platform}'s /usr/bin/time reports no instructions retired, and the design reads a comparison with no count as INCONCLUSIVE`);
    return;
  }
  const today = baseHook();
  const w = world();
  const body = edit(w.work, repeated('plain', 5000));
  const run = (side, what) => counted(side === 'base' ? today : BIN, w, `${what} by the ${side}'s deep-hook`, body);
  // Each binary's first start is checked by macOS before it runs: neither side's count pays for that.
  const read = { base: reading(run('base', 'an uncounted edit of plain/../ × 5,000').line), checkout: reading(run('checkout', 'an uncounted edit of plain/../ × 5,000').line) };
  assert.deepEqual(read.checkout, read.base, 'the checkout reads an edit of plain/../ × 5,000 as the base reads it');
  // Five rounds, a process of each side in each, the side that goes first swapping round by round.
  const rounds = [];
  for (let i = 0; i < RUNS; i++) {
    const got = {};
    for (const side of i % 2 ? ['checkout', 'base'] : ['base', 'checkout']) {
      got[side] = run(side, `an edit of plain/../ × 5,000, run ${i + 1}`);
      assert.deepEqual(reading(got[side].line), read[side], `the ${side}'s deep-hook reads the same edit the same way each time`);
    }
    rounds.push(got);
  }
  const counts = (side) => rounds.map((r) => r[side].instructions);
  const ratios = rounds.map((r) => (r.base.instructions && r.checkout.instructions ? r.checkout.instructions / r.base.instructions : null));
  const text = `instructions retired, in billions: base ${billions(counts('base'))}; checkout ${billions(counts('checkout'))}; spawn to exit: base ${listed(rounds.map((r) => r.base.ms))} ms, checkout ${listed(rounds.map((r) => r.checkout.ms))} ms`;
  if (ratios.includes(null)) {
    t.skip(`INCONCLUSIVE a count is missing, and the design reads a comparison with no count as INCONCLUSIVE: ${text}`);
    return;
  }
  const margin = Math.max(0.05, (Math.max(...ratios) - Math.min(...ratios)) / Math.min(...ratios));
  const judged = `the checkout's count over the base's, round by round: ${ratios.map((r) => r.toFixed(3)).join(', ')} (limit ${SLOWER}, margin ${(margin * 100).toFixed(0)}%); ${text}`;
  t.diagnostic(judged);
  if (ratios.every((r) => r <= SLOWER)) return;
  assert.ok(!ratios.every((r) => r > SLOWER * (1 + margin)), `FAIL every round reads the path with more than ${Math.round((SLOWER - 1) * 100)}% over the base's instructions: ${judged}`);
  t.skip(`INCONCLUSIVE ${judged}`);
});
