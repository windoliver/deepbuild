// The fixture corpus (#47): recorded hook payloads and transcripts per agent version, under
// adapters/corpus/<agent>/<version>/<session>/. `replay` maps every payload through its adapter as a
// live event of its set's version and compares the events with the ones stored beside it; `check` is
// the preflight's lane; `record` records a fresh set from real sessions, on your own sign-in, into a
// folder of its own, so a new set joins the corpus only through a diff you approve.
import { execFile, spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { delimiter, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

const root = realpathSync(new URL('../', import.meta.url).pathname);
const LIMIT = 200_000_000; // "the corpus stays under 200 MB"
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const quote = (arg) => `'${String(arg).replaceAll("'", `'\\''`)}'`;
const parse = (text) => text.split('\n').flatMap((line) => { try { const value = JSON.parse(line); return value && typeof value === 'object' ? [value] : []; } catch { return []; } });
const lines = (path) => (existsSync(path) ? parse(readFileSync(path, 'utf8')) : []);
const folders = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort() : []);
const say = (value) => console.log(JSON.stringify(value));

// ---- Reading the corpus --------------------------------------------------------------------------

function readFacts(dir) {
  return Object.fromEntries(readdirSync(dir).filter((name) => name.endsWith('.facts.json')).map((name) => [name.slice(0, -'.facts.json'.length), { path: join(dir, name), facts: JSON.parse(readFileSync(join(dir, name), 'utf8')) }]));
}

function readSet(corpus, agent, version) {
  return folders(join(corpus, agent, version)).map((name) => {
    const dir = join(corpus, agent, version, name);
    const cases = readFileSync(join(dir, 'events.jsonl'), 'utf8').split('\n').map((text, index) => ({ text, line: index + 1 })).filter(({ text }) => text.trim())
      .map(({ text, line }) => ({ ...JSON.parse(text), line }));
    return { name, dir, ref: `${agent}/${version}/${name}`, meta: JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8')), cases, transcript: lines(join(dir, 'transcript.jsonl')) };
  });
}

// Field by field, both ways: every path either side holds, with the value each side has there.
function diff(expected, actual, path = '') {
  if (Object.is(expected, actual)) return [];
  const object = (value) => value && typeof value === 'object';
  if (!object(expected) || !object(actual) || Array.isArray(expected) !== Array.isArray(actual)) return [{ path: path || '/', expected, actual }];
  const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])];
  return keys.flatMap((key) => (!(key in expected) || !(key in actual) ? [{ path: `${path}/${key}`, expected: expected[key], actual: actual[key] }] : diff(expected[key], actual[key], `${path}/${key}`)));
}

/** Replays every set; returns the printed lines and whether each set replayed clean. */
async function replayAll(corpus, factsDir, print) {
  const { replaySession } = await import('../adapters/index.mjs');
  const facts = readFacts(factsDir);
  const clean = new Map();
  for (const agent of folders(corpus)) {
    for (const version of folders(join(corpus, agent))) {
      let ok = true;
      for (const session of readSet(corpus, agent, version)) {
        const mapped = replaySession({ facts: facts[agent]?.facts, version, payloads: session.cases.map(({ payload }) => payload), transcript: session.transcript });
        session.cases.forEach((recorded, index) => {
          const got = mapped.payloads[index];
          const events = got.events.map(({ kind, data }) => ({ kind, data }));
          const diffs = Array.isArray(recorded.expect) ? diff(recorded.expect, events) : [];
          const result = !Array.isArray(recorded.expect) ? 'no-expected' : !got.verified ? 'unverified' : diffs.length ? 'mismatch' : 'match';
          if (result !== 'match') ok = false;
          print({ type: 'payload', case: `${session.ref}/events.jsonl:${recorded.line}`, agent, version, session: session.ref, hook: recorded.payload?.hook_event_name, verified: got.verified, result, diffs });
        });
        if (!mapped.verified) ok = false;
        print({ type: 'session', session: session.ref, agent, version, verified: mapped.verified, holds: mapped.verified ? 'active' : 'watch-only', readings: mapped.readings });
      }
      clean.set(`${agent}/${version}`, ok);
    }
  }
  return { clean, facts };
}

function size(dir) {
  return readdirSync(dir, { withFileTypes: true }).reduce((total, entry) => total + (entry.isDirectory() ? size(join(dir, entry.name)) : statSync(join(dir, entry.name)).size), 0);
}

async function replayCommand(options) {
  const started = performance.now();
  let failed = false;
  await replayAll(options.corpus, options.facts, (line) => { if (line.type === 'payload' ? line.result !== 'match' : !line.verified) failed = true; say(line); });
  say({ type: 'summary', verdict: failed ? 'FAIL' : 'PASS', elapsedMs: Math.round(performance.now() - started) });
  return failed ? 1 : 0;
}

async function checkCommand(options) {
  const started = performance.now();
  const failures = [];
  const { clean, facts } = await replayAll(options.corpus, options.facts, say);
  for (const [agent, { path, facts: file }] of Object.entries(facts)) {
    for (const version of file.versions ?? []) {
      const where = relative(root, path) || path;
      const sessions = existsSync(join(options.corpus, agent, version)) ? readSet(options.corpus, agent, version) : [];
      if (!sessions.length) { failures.push([`${where} covers ${agent} ${version}, which has no recorded set`, `Record it with node scripts/corpus.mjs record --agent ${agent} --out <dir>, review the diff, or narrow the range.`]); continue; }
      const recorded = new Set(sessions.flatMap(({ cases }) => cases.map(({ payload }) => payload?.hook_event_name)));
      const listed = Object.keys(file.events?.versions?.[version] ?? {});
      if (!listed.length) failures.push([`${where} lists no events for ${agent} ${version}`, 'List the hook events the adapter handles for that version under events.versions.']);
      for (const hook of listed.filter((name) => !recorded.has(name))) failures.push([`${agent} ${version}'s set has no recorded ${hook} payload`, `Record a session that fires ${hook}, or take it off that version's list.`]);
      if (clean.get(`${agent}/${version}`) === false) failures.push([`${agent} ${version}'s set does not replay clean, so its range can't cover it`, 'Run node scripts/corpus.mjs replay and fix the payloads named there.']);
    }
  }
  const bytes = size(options.corpus);
  say({ type: 'size', bytes, limit: LIMIT });
  if (bytes >= LIMIT) failures.push([`the corpus is ${bytes} bytes, over the 200 MB limit (${LIMIT} bytes)`, 'Trim transcripts or drop sessions that add no event, version or tag.']);
  for (const [text, fix] of failures) console.log(`FAIL corpus: ${text}\n  Fix: ${fix}`);
  if (!failures.length) console.log(`PASS corpus (${((performance.now() - started) / 1000).toFixed(2)} s)`);
  return failures.length ? 1 : 0;
}

// ---- Recording -----------------------------------------------------------------------------------

// The hook every recorded session runs: it keeps the payload byte for byte and answers a permission
// request with allow, so a scripted session never waits on a dialog.
function hookCommand(dir) {
  const raw = readFileSync(0, 'utf8');
  appendFileSync(join(dir, 'payloads.jsonl'), `${JSON.stringify({ at: Date.now(), raw })}\n`);
  let payload = {};
  try { payload = JSON.parse(raw); } catch {}
  if (payload.hook_event_name === 'PermissionRequest') process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } }));
  return 0;
}

const allowed = ['HOME', 'USER', 'LOGNAME', 'SHELL', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME'];
const cleanEnv = () => Object.fromEntries(allowed.filter((name) => name in process.env).map((name) => [name, process.env[name]]));
const plain = (text) => text.replace(/\x1b\[[0-9;?<>=]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][A-Z0-9]|\x1b[=>78]/g, '').replace(/\s+/g, '');

// Every process descended from one we started, by PID and start time; stopped by PID, never by name.
async function descendants(rootPid) {
  const { stdout } = await promisify(execFile)('ps', ['-A', '-o', 'pid=,ppid=,command=']);
  const rows = stdout.trim().split('\n').map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean).map(([, pid, ppid, command]) => ({ pid: Number(pid), ppid: Number(ppid), command }));
  const found = new Set([rootPid]);
  for (let grew = true; grew;) { grew = false; for (const row of rows) if (!found.has(row.pid) && found.has(row.ppid)) { found.add(row.pid); grew = true; } }
  return rows.filter((row) => found.has(row.pid));
}
async function stopTree(rootPid) {
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    for (const { pid } of await descendants(rootPid)) try { process.kill(pid, signal); } catch {}
    await sleep(signal === 'SIGTERM' ? 1500 : 200);
  }
}

// The pseudo-terminal seam, as the harness's: BSD script on macOS, util-linux script elsewhere.
function inTerminal(argv) {
  const command = `stty cols 120 rows 40; exec ${argv.map(quote).join(' ')}`;
  return ['/bin/sh', ['-c', `cat | ${process.platform === 'darwin' ? `script -q /dev/null /bin/sh -c ${quote(command)}` : `script -q -e -c ${quote(command)} /dev/null`}`]];
}

/** One scripted session. Steps type text and wait for the turn to end, wait for more stops, or kill the agent mid-call. */
async function session({ argv, cwd, dir, terminal, steps, startAfter }) {
  const [shell, args] = terminal ? inTerminal(argv) : [argv[0], argv.slice(1)];
  const child = spawn(shell, args, { cwd, env: { ...cleanEnv(), TERM: 'xterm-256color' }, stdio: ['pipe', 'pipe', 'pipe'] });
  let screen = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { screen += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { screen += chunk; });
  child.stdin.on('error', () => {});
  child.on('error', () => {});
  if (!terminal) child.stdin.end(); // codex exec reads a piped stdin to its end before it starts
  const recorded = () => lines(join(dir, 'payloads.jsonl')).map(({ raw }) => { try { return JSON.parse(raw); } catch { return {}; } });
  const ends = () => recorded().filter(({ hook_event_name: hook }) => hook === 'Stop' || hook === 'StopFailure').length;
  const until = async (test, ms) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(250)) if (test()) return true; return false; };
  const prompts = () => recorded().filter(({ hook_event_name: hook }) => hook === 'UserPromptSubmit').length;
  // A terminal UI that is still settling can drop the Enter; a prompt that fired no hook gets one more.
  const type = async (text) => {
    const before = prompts();
    child.stdin.write(text); await sleep(400); child.stdin.write('\r');
    if (terminal && !text.startsWith('/') && !(await until(() => prompts() > before, 15_000))) child.stdin.write('\r');
  };
  let blocked = null;
  const trust = {};
  try {
    if (terminal) {
      // Claude Code's folder trust prompt for the folder the recorder made: pick "Yes". Codex's is
      // never answered, so recording writes nothing into your Codex config; it reads BLOCKED instead.
      const ready = await until(() => {
        const text = plain(screen);
        if (/trustthecontentsofthisdirectory/i.test(text)) return (blocked = 'Codex asked to trust the folder; record Codex sessions in a folder it already trusts');
        // The dialog redraws as it settles, so move to "Yes" and confirm only once the cursor shows there.
        const dialog = text.slice(text.lastIndexOf('Quicksafetycheck'));
        if (!trust.done && /trustthisfolder/.test(dialog) && /Entertoconfirm/.test(dialog) && Date.now() - (trust.seen ??= Date.now()) > 800) {
          if (/❯Yes,Itrustthisfolder/.test(dialog)) { child.stdin.write('\r'); trust.done = true; }
          else if (Date.now() - (trust.moved ?? 0) > 800) { child.stdin.write('\x1b[B'); trust.moved = Date.now(); }
        }
        return startAfter(text, recorded());
      }, 60_000);
      if (!ready && !blocked) blocked = 'the session never became ready for a prompt';
      await sleep(1500);
    }
    for (const step of blocked ? [] : steps) {
      const before = ends();
      // A step ends at its turn's end, or at the hook it names, such as compaction's SessionStart.
      const fired = () => recorded().filter(step.until ?? (() => false)).length;
      const already = fired();
      if (step.type) { await type(step.type); if (!(await until(() => (step.until ? fired() > already : ends() > before), step.ms ?? 180_000))) { blocked = `no turn end after: ${step.type.slice(0, 60)}`; break; } }
      if (step.stops) if (!(await until(() => ends() >= before + step.stops, step.ms ?? 300_000))) { blocked = `fewer than ${step.stops} more turn ends`; break; }
      if (step.killOn) {
        if (step.prompt) await type(step.prompt);
        if (!(await until(() => recorded().some(step.killOn), 180_000))) { blocked = 'the call to crash on never started'; break; }
        await sleep(1000);
        for (const { pid, command } of await descendants(child.pid)) if (command.includes(step.binary)) try { process.kill(pid, 'SIGKILL'); } catch {}
        await sleep(2000);
      }
      if (step.wait) await sleep(step.wait);
    }
    if (terminal && !blocked && !steps.some((step) => step.killOn)) { await type(steps.exit ?? '/exit'); await sleep(4000); }
    if (!terminal) await until(() => child.exitCode !== null || child.signalCode !== null, 300_000);
  } finally {
    child.stdin.end();
    await stopTree(child.pid);
    for (const stream of [child.stdin, child.stdout, child.stderr]) stream.destroy();
    writeFileSync(join(dir, 'screen.log'), screen);
  }
  return { blocked, payloads: recorded() };
}

// Redaction: your home folder, user name and any email address never reach the corpus; transcript
// entries that carry your instructions, memory, account or system prompts are left out whole.
function redactor() {
  const home = homedir(), user = userInfo().username;
  const swap = (text) => text.split(home).join('~').replaceAll(`-Users-${user}-`, '-Users-user-').replaceAll(`/Users/${user}`, '/Users/user')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, 'user@example.com');
  const walk = (value) => (typeof value === 'string' ? swap(value) : Array.isArray(value) ? value.map(walk) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, walk(inner)])) : value);
  return walk;
}
const PRIVATE = ['base_instructions', 'user_instructions', 'developer_instructions', 'instructions', 'systemPrompt'];
function keepEntry(agent, entry) {
  if (agent === 'claude-code') return ['user', 'assistant', 'system', 'queue-operation'].includes(entry.type) && entry.subtype !== 'prompt_snapshot';
  if (entry.type === 'world_state') return false; // it carries your AGENTS.md and environment
  if (entry.type !== 'response_item') return true;
  const text = JSON.stringify(entry.payload?.content ?? '');
  return entry.payload?.role !== 'developer' && !/AGENTS\.md instructions|<user_instructions>|<skills_instructions>/.test(text);
}
const strip = (value) => (Array.isArray(value) ? value.map(strip) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([key]) => !PRIVATE.includes(key)).map(([key, inner]) => [key, strip(inner)])) : value);

function binaryPath(name) {
  const path = (process.env.PATH ?? '').split(delimiter).map((dir) => join(dir, name)).find((candidate) => existsSync(candidate));
  return path ? realpathSync(path) : null;
}

const CLAUDE_SCENARIOS = [
  { name: 'tools', args: ['--permission-mode', 'default'], steps: [
    { type: 'Use the Bash tool to run: echo corpus-probe' },
    { type: 'Use the Write tool to create notes.md in this folder containing the single word one.' },
    { type: 'Use the Edit tool to change one to two in notes.md.' },
    { type: 'Use the Bash tool to run: ls /definitely/not/here' },
    { type: 'Use the Grep tool to search this folder for the word two.' }] },
  { name: 'subagent', steps: [
    { type: 'Use the Agent tool with a general-purpose subagent, in the background, to run the Bash command echo from-subagent. Then end your turn; report its output when it finishes.' },
    { stops: 1 }] },
  // The task tools are on only for the models Claude Code lists, such as claude-haiku-4-5.
  { name: 'child-gates', model: 'claude-haiku-4-5', steps: [
    { type: 'Use the TaskCreate tool to add a task titled corpus-task, then use the TaskUpdate tool to mark it completed.' },
    { type: 'Use the Agent tool with a general-purpose subagent to run the Bash command echo from-child. Then end your turn; report its output when it finishes.' },
    { stops: 1 }] },
  { name: 'loop', steps: [{ type: '/loop 1m Reply with only the word tick. Do not use tools.' }, { stops: 1, ms: 150_000 }, { type: '/loop stop' }] },
  { name: 'compact', steps: [{ type: 'Use the Bash tool to run: echo before-compact' }, { type: '/compact', until: (payload) => payload.hook_event_name === 'SessionStart' && payload.source === 'compact' }, { type: 'Reply with only the word after.' }] },
  // `/clear` rotates the session ID in the same process; the second session is then forked by a new one.
  { name: 'clear', steps: [{ type: 'Use the Bash tool to run: echo before-clear' }, { type: '/clear', until: (payload) => payload.hook_event_name === 'SessionStart' && payload.source === 'clear' }, { type: 'Reply with only the word after.' }] },
  { name: 'stop-failure', model: 'claude-nonexistent-model', steps: [{ type: 'Reply with only the word hi.' }] },
  { name: 'crash', steps: [{ prompt: 'Run this exact command with the Bash tool in the foreground and wait for it to finish: node -e "setTimeout(() => console.log(1), 30000)"', killOn: (payload) => payload.hook_event_name === 'PreToolUse' }] },
];

async function recordClaude(out, bin, facts) {
  const hooks = [...new Set(Object.values(facts.events?.versions ?? {}).flatMap((events) => Object.keys(events)))];
  const results = [];
  for (const scenario of CLAUDE_SCENARIOS) {
    const dir = join(out, scenario.name), work = join(dir, 'work');
    mkdirSync(work, { recursive: true });
    const command = [process.execPath, join(root, 'scripts/corpus.mjs'), 'hook', dir].map(quote).join(' ');
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ hooks: Object.fromEntries(hooks.map((hook) => [hook, [{ hooks: [{ type: 'command', command }] }]])) }));
    const args = ['--model', scenario.model ?? 'haiku', '--setting-sources', 'project', '--strict-mcp-config', '--settings', join(dir, 'settings.json'), ...(scenario.args ?? [])];
    const steps = scenario.steps.map((step) => ({ ...step, binary: bin }));
    results.push({ scenario: scenario.name, dir, ...(await session({ argv: [bin, ...args], cwd: realpathSync(work), dir, terminal: true, steps, startAfter: (_, payloads) => payloads.some(({ hook_event_name: hook }) => hook === 'SessionStart') })) });
    // A resume of the first session: the same session ID, a new process, SessionStart from "resume".
    if (scenario.name === 'tools') {
      const id = results.at(-1).payloads.find(({ session_id: sid }) => sid)?.session_id;
      if (id) {
        const resumed = await session({ argv: [bin, ...args, '--resume', id], cwd: realpathSync(work), dir, terminal: true, steps: [{ type: 'Reply with only the word resumed.' }], startAfter: (_, payloads) => payloads.filter(({ hook_event_name: hook }) => hook === 'SessionStart').length > 1 });
        results.at(-1).blocked ??= resumed.blocked;
        results.at(-1).payloads = resumed.payloads;
      }
    }
    // A fork of the session `/clear` started: a new process, a new session ID, SessionStart from "resume".
    if (scenario.name === 'clear') {
      const id = results.at(-1).payloads.findLast(({ hook_event_name: hook }) => hook === 'SessionStart')?.session_id;
      if (id) {
        const forked = await session({ argv: [bin, ...args, '--resume', id, '--fork-session'], cwd: realpathSync(work), dir, terminal: true, steps: [{ type: 'Reply with only the word forked.' }], startAfter: (_, payloads) => payloads.filter(({ hook_event_name: hook }) => hook === 'SessionStart').length > 2 });
        results.at(-1).blocked ??= forked.blocked;
        results.at(-1).payloads = forked.payloads;
      }
    }
  }
  return results;
}

// Codex trusts a folder by writing it into your config the first time it runs there, exec included,
// so every Codex session runs in a folder your config already trusts, DEEP_CORPUS_CODEX_TRUSTED,
// with its files in a folder of its own inside it, and recording writes nothing into your config.
async function recordCodex(out, bin, facts) {
  const trusted = process.env.DEEP_CORPUS_CODEX_TRUSTED;
  if (!trusted) return [{ scenario: 'all', dir: out, blocked: 'set DEEP_CORPUS_CODEX_TRUSTED to a folder your Codex config already trusts', payloads: [] }];
  const hooks = [...new Set(Object.values(facts.events?.versions ?? {}).flatMap((events) => Object.keys(events)))];
  const job = facts.launch.readOnlyJob.args;
  const model = ['-m', job[job.indexOf('-m') + 1], '-c', 'model_reasoning_effort="low"'];
  const hookArgs = (dir) => {
    const command = [process.execPath, join(root, 'scripts/corpus.mjs'), 'hook', dir].map(quote).join(' ');
    return [...hooks.flatMap((hook) => ['-c', `hooks.${hook}=[{hooks=[{type="command",command=${JSON.stringify(command)}}]}]`]), '--dangerously-bypass-hook-trust'];
  };
  const exec = (dir, extra) => [bin, 'exec', '--json', '--skip-git-repo-check', '--ignore-user-config', ...model, ...hookArgs(dir), ...(extra.length ? extra : ['-c', 'sandbox_mode="workspace-write"'])];
  const patch = (folder, indent) => ['*** Begin Patch', `*** Update File: ${folder}/notes.txt`, '@@', `-line ${indent ? 'two' : 'one'}`, `+line ${indent ? '2' : '1'}`, '*** End Patch'].map((line) => `${indent}${line}`).join('\n');
  const shell = (text) => `Run this exact command with your shell tool, not apply_patch, and nothing else:\napply_patch <<'EOF'\n${text}\nEOF`;
  const scenarios = [
    { name: 'tools', prompts: (f) => [`Run the shell command: echo corpus-probe. Then use your apply_patch tool to add the file ${f}/added.txt containing the line one. Then run the shell command: ls /definitely/not/here. Then reply done.`] },
    { name: 'patches', prompts: (f) => [shell(patch(f, '')), shell(patch(f, '  '))] },
    { name: 'crash', prompts: () => ['Run the shell command: sleep 30 && echo slept'], crash: true },
  ];
  const results = [];
  for (const scenario of scenarios) {
    const dir = join(out, scenario.name), folder = `deep-corpus-${scenario.name}-${Date.now()}`, files = join(trusted, folder);
    mkdirSync(dir, { recursive: true });
    mkdirSync(files);
    writeFileSync(join(files, 'notes.txt'), 'line one\nline two\n');
    let result;
    for (const [index, prompt] of scenario.prompts(folder).entries()) {
      // A later prompt resumes the same thread, so its SessionStart reads "resume".
      const id = index ? result.payloads.find(({ session_id: sid }) => sid)?.session_id : null;
      const argv = id ? [bin, 'exec', 'resume', ...exec(dir, scenario.extra ?? []).slice(2), id, prompt] : [...exec(dir, scenario.extra ?? []), prompt];
      result = await session({ argv, cwd: trusted, dir, terminal: false, steps: scenario.crash ? [{ killOn: (payload) => payload.hook_event_name === 'PreToolUse', binary: 'codex' }] : [] });
    }
    results.push({ scenario: scenario.name, dir, ...result });
    rmSync(files, { recursive: true, force: true });
  }
  // Two sessions need Codex's terminal UI: exec never asks for approval, so a permission request
  // comes from a write a read-only sandbox must ask to escalate, and a goal's continuation needs a live
  // thread. A goal's later turns fire no prompt hook, only their tool calls and Stop.
  // The terminal UI announces each newly available model and counts the notice in your config;
  // marking every model in Codex's own model cache as already announced keeps it out of both.
  let models = [];
  try { models = JSON.parse(readFileSync(join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'models_cache.json'), 'utf8')).models.map(({ slug }) => slug); } catch {}
  const quiet = models.length ? ['-c', `tui.model_availability_nux={ ${models.map((slug) => `${JSON.stringify(slug)} = 100`).join(', ')} }`] : [];
  const tui = async (name, args, prompt, stops) => {
    const dir = join(out, name);
    mkdirSync(dir, { recursive: true });
    const argv = [bin, ...model, ...hookArgs(dir), ...(args.includes('-s') ? [] : ['-s', 'workspace-write']), ...args, '-c', 'check_for_update_on_startup=false', ...quiet];
    results.push({ scenario: name, dir, ...(await session({ argv, cwd: trusted, dir, terminal: true, steps: Object.assign([{ type: prompt }, ...(stops ? [{ stops }] : [])], { exit: '/quit' }), startAfter: (text) => /›/.test(text) && text.length > 200 })) });
  };
  const made = join(trusted, `deep-corpus-permission-${Date.now()}.txt`), goal = join(trusted, `deep-corpus-goal-${Date.now()}.txt`);
  await tui('permission', ['-s', 'read-only', '-a', 'on-request'], `Run the shell command: touch ${made}. The sandbox is read-only, so request escalated permissions for it. Then reply done.`);
  await tui('goal', ['-a', 'never'], `Create a goal with your create_goal tool: write the numbers 1, 2 and 3 into ${goal}, one number per turn, ending each turn after writing one number. Then write 1 and end your turn.`, 2);
  for (const file of [made, goal]) rmSync(file, { force: true });
  return results;
}

async function recordCommand(options) {
  const agent = options.agent, out = resolve(options.out);
  if (!['claude-code', 'codex'].includes(agent)) throw Error('--agent is claude-code or codex');
  const bin = binaryPath(agent === 'codex' ? 'codex' : 'claude');
  const factsFile = join(root, 'adapters', `${agent}.facts.json`);
  const facts = JSON.parse(readFileSync(factsFile, 'utf8'));
  if (!bin) { say({ type: 'summary', verdict: 'BLOCKED', reason: `${agent} is not on PATH` }); return 1; }
  const version = spawnSync(bin, ['--version'], { encoding: 'utf8' }).stdout.match(/\d+\.\d+\.\d+(?:[-+][\w.]+)?/)?.[0];
  const scratch = mkdtempSync('/private/tmp/deep-corpus-');
  const results = agent === 'codex' ? await recordCodex(scratch, bin, facts) : await recordClaude(scratch, bin, facts);
  const redact = redactor();
  for (const { scenario, dir, blocked, payloads } of results) {
    if (!payloads.length) { say({ type: 'session', scenario, blocked: blocked ?? 'no payload was recorded' }); continue; }
    const target = join(out, agent, version, scenario);
    mkdirSync(target, { recursive: true });
    // Each session's transcript in the order its hooks came, since `/clear` and a fork start new ones.
    const paths = [...new Set(payloads.map((payload) => payload.transcript_path).filter((path) => path && existsSync(path)))];
    const transcript = paths.flatMap((path) => lines(path)).filter((entry) => keepEntry(agent, entry)).map((entry) => redact(strip(entry)));
    writeFileSync(join(target, 'transcript.jsonl'), transcript.map((entry) => JSON.stringify(entry)).join('\n') + (transcript.length ? '\n' : ''));
    writeFileSync(join(target, 'events.jsonl'), payloads.map((payload) => JSON.stringify({ payload: redact(payload) })).join('\n') + '\n');
    writeFileSync(join(target, 'session.json'), `${JSON.stringify({ schema: 'corpus.session@1', agent, version, surface: 'terminal', recorded: new Date().toISOString().slice(0, 10), scenario }, null, 2)}\n`);
    say({ type: 'session', scenario, version, payloads: payloads.length, transcriptEntries: transcript.length, ...(blocked ? { blocked } : {}) });
  }
  rmSync(scratch, { recursive: true, force: true });
  // Secret scan before anything is shown: the repo's gitleaks rules over the fresh set.
  const scan = spawnSync('gitleaks', ['detect', '--no-git', '--source', join(out, agent, version), '--config', join(root, 'packages/evidence/gitleaks/gitleaks.toml'), '--redact', '--no-banner', '--exit-code', '3'], { encoding: 'utf8' });
  const verdict = scan.error ? 'BLOCKED' : scan.status === 0 ? (results.some(({ blocked }) => blocked) ? 'INCONCLUSIVE' : 'PASS') : 'FAIL';
  say({ type: 'summary', verdict, set: join(out, agent, version), secretScan: scan.error ? `gitleaks did not run: ${scan.error.message}` : scan.status === 0 ? 'clean' : 'findings; the set must not join the corpus' });
  return verdict === 'PASS' ? 0 : 1;
}

// ---- Entry ---------------------------------------------------------------------------------------

const [command, ...rest] = process.argv.slice(2);
const options = { corpus: join(root, 'adapters/corpus'), facts: join(root, 'adapters') };
for (let index = 0; index < rest.length; index += 2) {
  const [flag, value] = [rest[index], rest[index + 1]];
  if (command === 'hook') { options.dir = flag; break; }
  if (!['--corpus', '--facts', '--agent', '--out'].includes(flag) || value === undefined) { console.error(`unknown or incomplete option ${flag}`); process.exit(2); }
  options[flag.slice(2)] = flag === '--agent' ? value : resolve(value);
}
const commands = { replay: replayCommand, check: checkCommand, record: recordCommand, hook: () => hookCommand(options.dir) };
if (!commands[command] || (command === 'record' && !(options.agent && options.out))) {
  console.error('Usage: node scripts/corpus.mjs replay|check [--corpus <dir>] [--facts <dir>]\n       node scripts/corpus.mjs record --agent claude-code|codex --out <dir>');
  process.exit(2);
}
process.exitCode = await commands[command](options);
