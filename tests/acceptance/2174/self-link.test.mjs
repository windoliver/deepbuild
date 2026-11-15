// #2174: deep-hook's path reader follows a link whose target isn't there by calling itself on the target, so a link
// that names itself, or two that name each other, recurse until the stack runs out: the long-lived `deep-hook match`
// dies on SIGABRT and a forwarded hook is denied as unreadable by its 500 ms watchdog. After the fix such a path is
// kept as written, and a link to a file that doesn't exist yet still reads as its target. One test per criterion,
// against the real binary (target/debug/deep-hook) with the shipped entries (crates/deep-hook/default-rules.json) as
// rules.json and no hub. README: readings, the timing rule and how to run. Node built-ins only.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test, { after, before } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const BIN = join(REPO, 'target/debug/deep-hook');
const SHIPPED = join(REPO, 'crates/deep-hook/default-rules.json');
/** The hook's budget with the hub away (design: Fail-open time), and its watchdog's words when a call isn't read in 500 ms. */
const LIMIT_MS = 50;
const UNREAD = "couldn't read this call";
/** How long the test waits for one matcher line or one hook before it stands in for the agent and stops the child. */
const ANSWER_MS = 30_000;
const RUNS = 5;

// ---- Folders and processes of this file's own. Children are stopped through their handles (their PIDs), nothing else.
const folders = [];
const children = new Set();
after(() => {
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  for (const dir of folders) rmSync(dir, { recursive: true, force: true });
});
before(() => {
  const built = spawnSync('cargo', ['build', '--locked', '-q', '-p', 'deep-hook'], { cwd: REPO, encoding: 'utf8', timeout: 30 * 60_000, killSignal: 'SIGKILL' });
  assert.equal(built.status, 0, `BLOCKED: cargo build --locked -q -p deep-hook: ${built.error?.message ?? ''} ${String(built.stderr).slice(-2000)}`);
  assert.ok(existsSync(BIN) && existsSync(SHIPPED), `BLOCKED: no ${BIN} or no ${SHIPPED}`);
});

/** A home with the shipped entries as its rules.json and no hub, a work folder beside it, and one session there. */
function world() {
  const top = realpathSync(mkdtempSync('/tmp/dh2174-'));
  folders.push(top);
  const home = join(top, 'h');
  const work = join(top, 'work');
  mkdirSync(join(home, '.deepbuild'), { recursive: true });
  mkdirSync(join(home, '.claude'));
  mkdirSync(work);
  writeFileSync(join(home, '.deepbuild/rules.json'), readFileSync(SHIPPED));
  writeFileSync(join(work, 'plain'), 'a\n');
  const env = { HOME: home, PATH: process.env.PATH ?? '/usr/bin:/bin', LC_ALL: 'C', XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache') };
  const rules = JSON.parse(readFileSync(SHIPPED, 'utf8')).entries;
  return { top, home, work, env, rules, session: randomUUID(), cwd: work };
}
/** The issue's two loops, each in the work folder: the link a call names, by its absolute path. */
const LOOPS = {
  'a link that names itself': (w) => { symlinkSync('self', join(w.work, 'self')); return join(w.work, 'self'); },
  'two links that name each other': (w) => { symlinkSync('b', join(w.work, 'a')); symlinkSync('a', join(w.work, 'b')); return join(w.work, 'a'); },
};

let calls = 0;
/** A Claude Code PreToolUse payload for one tool call in the world's session. */
const call = (w, tool_name, tool_input) => ({
  session_id: w.session, transcript_path: join(w.home, '.claude/projects/x', `${w.session}.jsonl`), cwd: w.cwd, hook_event_name: 'PreToolUse',
  permission_mode: 'default', tool_name, tool_input, tool_use_id: `toolu_2174_${++calls}`,
});
const bash = (w, command) => call(w, 'Bash', { command });
const read = (w, file_path) => call(w, 'Read', { file_path });
const edit = (w, file_path) => call(w, 'Edit', { file_path, old_string: 'a', new_string: 'b', replace_all: false });
const write = (w, file_path) => call(w, 'Write', { file_path, content: 'x' });

// ---- The forwarded hook: `deep-hook claude-code PreToolUse`, the payload on stdin, timed from its spawn to its exit.
function hook(w, body) {
  const t0 = performance.now();
  const r = spawnSync(BIN, ['claude-code', 'PreToolUse'], { cwd: w.cwd, env: w.env, input: JSON.stringify(body), encoding: 'utf8', timeout: ANSWER_MS, killSignal: 'SIGKILL' });
  return { code: r.status, signal: r.signal, stdout: r.stdout ?? '', stderr: r.stderr ?? '', ms: performance.now() - t0, timedOut: r.error?.code === 'ETIMEDOUT' };
}
const shown = (r) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? `, stopped by the test at ${ANSWER_MS} ms` : ''} after ${r.ms.toFixed(1)} ms, stdout ${JSON.stringify(r.stdout.slice(0, 300))}, stderr ${JSON.stringify(r.stderr.slice(0, 400))}`;
/** What Claude Code reads of a PreToolUse hook: exit 2 or a deny decision denies; exit 0 without one allows. */
function decision(r) {
  let said;
  try { const out = JSON.parse(r.stdout.trim()); said = out?.hookSpecificOutput?.permissionDecision ?? out?.decision; } catch { /* no JSON */ }
  if (r.code === 2 || said === 'deny' || said === 'block') return 'deny';
  return r.code === 0 && (said === undefined || said === 'allow') ? 'allow' : 'other';
}
/** The shipped entry whose reason and next_step the text carries whole, by name. */
const entryIn = (w, text) => Object.keys(w.rules).find((name) => text.includes(w.rules[name].reason) && text.includes(w.rules[name].next_step));
function allowed(w, what, body) {
  const r = hook(w, body);
  assert.ok(r.code !== null, `${what}: the hook ended on a signal or never ended, with no decision: ${shown(r)}`);
  assert.ok(!`${r.stdout}\n${r.stderr}`.includes(UNREAD), `${what}: the hook's watchdog denied the call as unreadable instead of the hook reading it: ${shown(r)}`);
  assert.equal(decision(r), 'allow', `${what} matches no fail_closed entry and must be allowed: ${shown(r)}`);
  return r;
}
function denied(w, what, body) {
  const r = hook(w, body);
  assert.ok(r.code !== null, `${what}: the hook ended on a signal or never ended, with no decision: ${shown(r)}`);
  assert.ok(!`${r.stdout}\n${r.stderr}`.includes(UNREAD), `${what}: the hook's watchdog denied the call as unreadable instead of the entry it matches denying it: ${shown(r)}`);
  assert.equal(decision(r), 'deny', `${what} must be denied: ${shown(r)}`);
  const entry = entryIn(w, `${r.stdout}\n${r.stderr}`);
  assert.ok(entry, `${what}: the denial carries no shipped entry's reason and next_step: ${shown(r)}`);
  return { ...r, entry };
}

/**
 * The time rule (README, "inside its 50 ms"): five runs of the call on the link, each beside the same call on a plain
 * file. PASS when every link run is under 50 ms. FAIL when the link costs the budget by itself: every link run is over
 * the slowest plain run by more than 50 ms, or the plain runs are all under 50 ms and every link run is over it by
 * more than the margin. Anything else is INCONCLUSIVE: the test is skipped with the numbers, never passed.
 */
function timed(t, w, what, onLink, onPlain) {
  const link = [], plain = [];
  for (let i = 0; i < RUNS; i++) {
    plain.push(allowed(w, `${what} on a plain file, run ${i + 1}`, onPlain()).ms);
    link.push(allowed(w, `${what} on the link, run ${i + 1}`, onLink()).ms);
  }
  const margin = Math.max(0.05, (Math.max(...link) - Math.min(...link)) / Math.max(Math.min(...link), 1e-9));
  const text = `${what}: on the link ${link.map((ms) => ms.toFixed(1)).join(', ')} ms; on a plain file ${plain.map((ms) => ms.toFixed(1)).join(', ')} ms; limit ${LIMIT_MS} ms, spawn to exit`;
  t.diagnostic(text);
  if (link.every((ms) => ms < LIMIT_MS)) return null;
  assert.ok(!link.every((ms) => ms > Math.max(...plain) + LIMIT_MS), `FAIL the link alone costs more than the hook's ${LIMIT_MS} ms in every run: ${text}`);
  assert.ok(!(plain.every((ms) => ms < LIMIT_MS) && link.every((ms) => ms > LIMIT_MS * (1 + margin))), `FAIL every run on the link is over ${LIMIT_MS} ms where the same call on a plain file is under it: ${text}`);
  return `INCONCLUSIVE ${text}`;
}

/** AC2's reading on one loop: the hook rules `ls` and Read of the link by what matches, and in its usual time. */
function hookRules(t, kind) {
  const w = world();
  const link = LOOPS[kind](w);
  const plain = join(w.work, 'plain');
  allowed(w, `\`ls\` of ${kind}`, bash(w, `ls ${link}`));
  allowed(w, `a Read of ${kind}`, read(w, link));
  // "By what matches": the same `ls` on a line that also kills by name is denied in that entry's words.
  const kill = denied(w, `\`ls\` of ${kind} on a line that also runs \`pkill -f node\``, bash(w, `ls ${link}; pkill -f node`));
  assert.equal(kill.entry, denied(w, '`ls` of a plain file on a line that also runs `pkill -f node`', bash(w, `ls ${plain}; pkill -f node`)).entry, 'the line with the link is denied by the entry that denies it with a plain file');
  const unjudged = [
    timed(t, w, `\`ls\` of ${kind}`, () => bash(w, `ls ${link}`), () => bash(w, `ls ${plain}`)),
    timed(t, w, `a Read of ${kind}`, () => read(w, link), () => read(w, plain)),
  ].filter(Boolean);
  if (unjudged.length) t.skip(unjudged.join('; '));
}

// ---- The long-lived matcher: `deep-hook match`, a payload a line in, its line out.
function matcher(w) {
  const t0 = performance.now();
  const child = spawn(BIN, ['match'], { cwd: w.cwd, env: w.env, stdio: ['pipe', 'pipe', 'pipe'] });
  children.add(child);
  let out = '', err = '', wake = () => {};
  const ended = new Promise((resolve) => child.on('close', (code, signal) => { resolve({ code, signal, ms: performance.now() - t0 }); wake(); }));
  child.stdout.setEncoding('utf8').on('data', (d) => { out += d; wake(); });
  child.stderr.setEncoding('utf8').on('data', (d) => { err += d; });
  child.stdin.on('error', () => {});
  child.on('error', () => {});
  const state = () => `stdout ${JSON.stringify(out.slice(0, 300))}, stderr ${JSON.stringify(err.slice(0, 400))}`;
  return {
    up: () => child.exitCode === null && child.signalCode === null,
    /** Sends one call and returns its line, parsed. Fails when the matcher ends or says nothing within ANSWER_MS. */
    async ask(what, body) {
      child.stdin.write(`${JSON.stringify(body)}\n`);
      const deadline = performance.now() + ANSWER_MS;
      while (!out.includes('\n')) {
        if (!this.up()) {
          const end = await ended;
          assert.fail(`${what}: the matcher ended without printing the call's line: ${end.signal ?? `exit ${end.code}`} after ${end.ms.toFixed(0)} ms, ${state()}`);
        }
        const left = deadline - performance.now();
        assert.ok(left > 0, `${what}: the matcher printed no line within ${ANSWER_MS} ms, ${state()}`);
        let timer;
        await new Promise((resolve) => { wake = resolve; timer = setTimeout(resolve, left); });
        clearTimeout(timer);
      }
      const text = out.slice(0, out.indexOf('\n'));
      out = out.slice(text.length + 1);
      let line;
      try { line = JSON.parse(text); } catch { /* judged below */ }
      assert.ok(Array.isArray(line?.matched) && Array.isArray(line?.denials), `${what}: the matcher's line is not {"matched":[...],"denials":[...]}: ${text.slice(0, 300)}`);
      assert.notEqual(line.unread, true, `${what}: the matcher read the call against nothing ("unread"): ${text.slice(0, 300)}`);
      return line;
    },
    /** Closes stdin, on which the matcher ends; stops it if it hasn't after 10 s. */
    async close() {
      child.stdin.end();
      const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
      const end = await ended;
      clearTimeout(timer);
      return end;
    },
  };
}
/** AC1's reading on one loop: the matcher prints the line of an Edit that names the link, and reads the next call. */
async function matcherAnswers(kind) {
  const w = world();
  const link = LOOPS[kind](w);
  const m = matcher(w);
  try {
    const plain = await m.ask('an Edit of a plain file', edit(w, join(w.work, 'plain')));
    for (const [what, path] of [[`an Edit of ${kind}`, link], [`an Edit of a path through ${kind}`, join(link, 'x')]]) {
      const line = await m.ask(what, edit(w, path));
      assert.deepEqual([...line.matched].sort(), [...plain.matched].sort(), `${what} is kept as written, so it matches what an Edit of a plain file beside it matches`);
      assert.deepEqual(line.denials, [], `${what} is denied by no shipped entry`);
    }
    const next = await m.ask(`the call after an Edit of ${kind}, \`pkill -f node\``, bash(w, 'pkill -f node'));
    assert.ok(next.denials.length > 0 && entryIn(w, next.denials.join('\n')), `the next call, \`pkill -f node\`, is read and denied in a shipped entry's words: ${JSON.stringify(next)}`);
    assert.ok(m.up(), 'the matcher is still up after both calls');
  } finally {
    await m.close();
  }
}

test('#2174.efc37644 AC1 the matcher prints the line of an Edit that names a link to itself, and reads the next call', async () => {
  await matcherAnswers('a link that names itself');
});

test('#2174.1713a70d AC2 a forwarded hook, shipped entries and no hub, rules `ls` and Read of a link to itself by what matches, inside its 50 ms', (t) => {
  hookRules(t, 'a link that names itself');
});

test('#2174.9080b65a AC3 two links that name each other read as one that names itself: the matcher answers and stays up, the hook rules in its usual time', async (t) => {
  await matcherAnswers('two links that name each other');
  hookRules(t, 'two links that name each other');
});

test('#2174.acad9277 AC4 a link to a file that is not there yet still reads as that file: a write through it to an agent config is denied naming deep_propose', () => {
  const w = world();
  w.cwd = w.home;   // as tests/acceptance/316/symlink.test.ts: the session is in HOME, the links beside the home folder
  const config = join(w.home, '.claude/settings.json');
  assert.ok(!existsSync(config), 'the config file is not there yet');
  const s = join(w.top, 's'), s2 = join(w.top, 's2'), s3 = join(w.top, 's3'), other = join(w.top, 'o');
  symlinkSync(config, s);                       // a fresh link to the file that isn't there
  symlinkSync('s', s2);                         // a link to that link, written relative to its own folder
  symlinkSync(s2, s3);                          // and one more: three links to follow before the missing file
  symlinkSync(join(w.work, 'new.md'), other);   // a link to an ordinary file that isn't there yet
  for (const [what, body] of [
    [`a Write through ${s}, a link to the missing ${config}`, write(w, s)],
    [`an Edit through ${s2}, a relative link to that link`, edit(w, s2)],
    [`a Write through ${s3}, a link to the link to that link`, write(w, s3)],
  ]) {
    const r = denied(w, what, body);
    assert.ok(`${r.stdout}\n${r.stderr}`.includes('deep_propose'), `${what}: the denial does not name deep_propose: ${shown(r)}`);
  }
  allowed(w, `a Write through ${other}, a link to an ordinary file that isn't there yet`, write(w, other));
});
