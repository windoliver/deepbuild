// The agent test harness (#48): real Claude Code and Codex sessions on demand, run by hand on your
// own sign-in, never in CI. Every run prints one JSON line with its verdict, usage and cost, keeps
// its transcript under --out, and stops every process it started, found by ancestry and killed by
// PID. `budgets` is the preflight's lane: it runs every session when a change touches the harness.
import { execFile, execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { accessSync, constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, delimiter, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

const root = realpathSync(new URL('../', import.meta.url).pathname);
const hook = join(root, 'scripts/agent-harness-hook.mjs');
const factsFile = { claude: join(root, 'adapters/claude-code.facts.json'), codex: join(root, 'adapters/codex.facts.json') };
// What a change must touch for the budgets lane to run: the harness, its hook and its launch facts.
const harnessFiles = [join(root, 'scripts/agent-harness.mjs'), hook, ...Object.values(factsFile)].map((path) => relative(root, path));
const EDIT_PROMPT = 'Read the README and add one line to it.';
const FIX_PROMPT = 'Run the checkout tests once with `node --test`; they fail. Fix the bug in src/cart.js, run `node --test` again to see them pass, then commit the fix with `git commit -am "Fix the cart total"`.';
const SCRIPTED = 'This session is scripted: no one will answer a question, so choose for yourself and finish the task.';
const PAIRS = [['held-stop', 'claude'], ['idle-wake', 'claude'], ['read-only-job', 'claude'], ['read-only-job', 'codex']];
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const quote = (arg) => `'${String(arg).replaceAll("'", `'\\''`)}'`;
const parse = (text) => text.split('\n').flatMap((line) => { try { const value = JSON.parse(line); return value && typeof value === 'object' ? [value] : []; } catch { return []; } });
const lines = (path) => (path && existsSync(path) ? parse(readFileSync(path, 'utf8')) : []);
// A job starts with an allowlisted environment, so the variables that mark a nested session never
// reach it; the account homes pass through, since an account is the home it signed into.
const allowed = ['HOME', 'USER', 'LOGNAME', 'SHELL', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME'];

// Every process descended from the run's root, kept by PID and start time so a reused PID never counts.
class Processes {
  known = new Map();
  constructor(rootPid) { this.rootPid = rootPid; }
  async table() {
    const { stdout } = await promisify(execFile)('ps', ['-A', '-o', 'pid=,ppid=,stat=,lstart=']);
    return new Map(stdout.trim().split('\n').map((line) => {
      const [pid, ppid, stat, ...start] = line.trim().split(/\s+/);
      return [Number(pid), { ppid: Number(ppid), stat, start: start.join(' ') }];
    }));
  }
  async poll() {
    const table = await this.table();
    const rootRow = table.get(this.rootPid);
    if (!this.known.size && rootRow) this.known.set(this.rootPid, rootRow.start);
    for (let grew = true; grew;) {
      grew = false;
      for (const [pid, row] of table)
        if (!this.known.has(pid) && this.known.has(row.ppid) && this.known.get(row.ppid) === table.get(row.ppid)?.start) { this.known.set(pid, row.start); grew = true; }
    }
    return [...this.known].filter(([pid, start]) => table.get(pid)?.start === start && !table.get(pid).stat.startsWith('Z')).map(([pid]) => pid);
  }
  signal(pids, name) { for (const pid of pids) try { process.kill(pid, name); } catch {} }
  // SIGTERM, a short grace, then SIGKILL for what lingered; new descendants are caught on each poll.
  async stop() {
    const until = Date.now() + 1500;
    let living = await this.poll();
    while (living.length && Date.now() < until) { this.signal(living, 'SIGTERM'); await sleep(100); living = await this.poll(); }
    const lingered = living;
    for (let round = 0; living.length && round < 50; round++) { this.signal(living, 'SIGKILL'); await sleep(50); living = await this.poll(); }
    return { started: [...this.known.keys()], lingered, living };
  }
}

const valued = { '--route': 'route', '--mcp-config': 'mcpConfig', '--go': 'go', '--rounds': 'rounds', '--scenario': 'scenario', '--agent': 'agent', '--claude': 'claude', '--codex': 'codex', '--cost-cap-usd': 'costCapUsd', '--token-cap': 'tokenCap', '--timeout-ms': 'timeoutMs', '--out': 'out', '--base': 'base', '--budgets': 'budgets', '--workdir': 'workdir', '--hooks': 'hooks', '--script': 'script' };
const repeated = { '--changed': 'changed', '--pass-env': 'passEnv' };
function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command, agent: 'claude', costCapUsd: 0.5, tokenCap: 300_000, timeoutMs: 60_000, changed: undefined, passEnv: [] };
  for (let index = 0; index < rest.length; index += 2) {
    const [flag, value] = [rest[index], rest[index + 1]];
    if (value === undefined || !(flag in valued || flag in repeated)) throw Error(`unknown or incomplete option ${flag}`);
    if (flag in repeated) (options[repeated[flag]] ??= []).push(value);
    else options[valued[flag]] = ['costCapUsd', 'tokenCap', 'timeoutMs'].includes(valued[flag]) ? Number(value) : value;
  }
  if (!['run', 'all', 'budgets'].includes(command)) throw Error('expected run, all or budgets');
  if (command === 'run' && !['held-stop', 'idle-wake', 'read-only-job', 'add-readme-line', 'fix-checkout-test', 'settings-tamper', 'deep-answer'].includes(options.scenario)) throw Error('run needs a known --scenario');
  if (options.scenario === 'deep-answer' && (options.agent !== 'claude' || !options.workdir || !options.mcpConfig || !['stop-hold', 'idle-wake', 'next-prompt', 'resume'].includes(options.route))) throw Error('deep-answer runs claude and needs --workdir, --mcp-config and a --route of stop-hold, idle-wake, next-prompt or resume');
  if (options.scenario === 'add-readme-line' && (options.agent !== 'claude' || !options.workdir || !options.hooks)) throw Error('add-readme-line runs claude and needs --workdir and --hooks');
  if (options.scenario === 'fix-checkout-test' && (options.agent !== 'claude' || !options.workdir)) throw Error('fix-checkout-test runs claude and needs --workdir');
  if (options.scenario === 'settings-tamper' && (options.agent !== 'claude' || !options.workdir || !options.script)) throw Error('settings-tamper runs claude and needs --workdir and --script');
  if (!['claude', 'codex'].includes(options.agent)) throw Error('--agent is claude or codex');
  return options;
}

function binary(agent, given) {
  const path = given ?? (process.env.PATH ?? '').split(delimiter).map((dir) => join(dir, agent)).find((candidate) => existsSync(candidate));
  try { accessSync(path, constants.X_OK); return realpathSync(path); } catch { return null; }
}

// What keeps a run from starting: the binary, a version its facts cover, the sign-in.
function blockedBy(agent, bin, facts, env) {
  if (!bin) return `${agent} is not runnable at the given path or on PATH`;
  const version = spawnSync(bin, ['--version'], { encoding: 'utf8', env, timeout: 30_000 }).stdout?.match(/\d+\.\d+\.\d+/)?.[0];
  if (!facts.versions.includes(version)) return `${agent} ${version ?? '(no version)'} is outside the versions its facts cover (${facts.versions.join(', ')})`;
  const signIn = spawnSync(bin, facts.signIn.args, { encoding: 'utf8', env, timeout: 30_000 });
  let signedIn = signIn.status === 0;
  if (agent === 'claude') try { signedIn = JSON.parse(signIn.stdout).loggedIn === true; } catch { signedIn = false; }
  return signedIn ? null : `${agent} is not signed in; run its login command yourself`;
}

// The pseudo-terminal seam: BSD script on macOS, util-linux script on Linux. Node's pipes are
// sockets, which script can't put in raw mode, so cat carries keystrokes in through a real pipe.
function inTerminal(argv) {
  const command = `stty cols 120 rows 40; exec ${argv.map(quote).join(' ')}`;
  const script = process.platform === 'darwin' ? `script -q /dev/null /bin/sh -c ${quote(command)}` : `script -q -e -c ${quote(command)} /dev/null`;
  return ['/bin/sh', ['-c', `cat | ${script}`]];
}

const plain = (text) => text.replace(/\x1b\[[0-9;?<>=]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][A-Z0-9]|\x1b[=>78]/g, '');
const home = (facts, env) => env[facts.transcripts.home[0]] || join(env.HOME ?? homedir(), facts.transcripts.home[1].replace(/^~\//, ''));

// Claude Code repeats a message's usage on each content block's entry, so each message counts once.
function claudeUsage(entries) {
  const messages = new Map(entries.filter((entry) => entry.type === 'assistant' && entry.message?.usage).map((entry) => [entry.message.id, entry.message]));
  if (!messages.size) return { tokens: 'not captured' };
  const tokens = { input: 0, cached: 0, output: 0, count: 'exact', covers: 'session' };
  for (const { usage } of messages.values()) {
    tokens.input += (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
    tokens.cached += usage.cache_read_input_tokens ?? 0;
    tokens.output += usage.output_tokens ?? 0;
  }
  return { tokens, model: [...messages.values()].at(-1).model };
}

// Codex's input_tokens include its cached input, which is taken back out.
function codexUsage(entries) {
  const total = entries.filter((entry) => entry.payload?.type === 'token_count' && entry.payload.info).at(-1)?.payload.info.total_token_usage;
  const model = entries.filter((entry) => entry.type === 'turn_context').at(-1)?.payload?.model;
  if (!total) return { tokens: 'not captured', model };
  const cached = total.cached_input_tokens ?? 0;
  return { tokens: { input: total.input_tokens - cached, cached, output: total.output_tokens, count: 'exact', covers: 'session' }, model };
}

// The rollout Codex wrote for a thread: in its home, under the day it started, local or UTC.
function rollout(facts, env, thread) {
  const days = [new Date(), new Date(Date.now() - 86_400_000)].flatMap((day) => [
    [day.getFullYear(), day.getMonth() + 1, day.getDate()], [day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate()]]);
  for (const [year, month, date] of days) {
    const dir = join(home(facts, env), 'sessions', String(year), String(month).padStart(2, '0'), String(date).padStart(2, '0'));
    const name = existsSync(dir) && readdirSync(dir).find((file) => file.endsWith(`-${thread}.jsonl`));
    if (name) return join(dir, name);
  }
  return null;
}

const total = ({ input, cached, output }) => input + cached + output;

async function run(options, scenario, agent = options.agent) {
  const token = `run_${randomBytes(6).toString('hex')}`;
  const started = performance.now();
  const facts = JSON.parse(readFileSync(factsFile[agent], 'utf8'));
  const priced = facts.usage.cost === 'reported';
  const cap = priced ? { usd: options.costCapUsd } : { tokens: options.tokenCap };
  const line = { run: token, scenario, agent, verdict: 'BLOCKED', stop: 'blocked', reason: '', tokens: 'not captured', cost: { basis: 'not captured' }, cap, elapsedMs: 0 };
  const finish = (fields) => { Object.assign(line, fields, { elapsedMs: Math.round(performance.now() - started) }); console.log(JSON.stringify(line)); return line; };

  const bin = binary(agent, options[agent]);
  // add-readme-line and fix-checkout-test run in a checkout the caller made and keeps; the other scenarios in a folder
  // of their own. fix-checkout-test (#668) loads your user settings, so it runs whatever hooks are there.
  const fix = scenario === 'fix-checkout-test';
  const edit = scenario === 'add-readme-line' || fix;
  const dir = join(options.out, token), work = edit ? resolve(options.workdir) : join(dir, 'work');
  mkdirSync(edit ? dir : work, { recursive: true });
  if (!existsSync(work)) return finish({ reason: `BLOCKED: the workdir ${work} does not exist` });
  // --pass-env adds a variable of the harness's own, such as a billing key, to the allowlist; its value is never printed.
  const env = { ...Object.fromEntries([...allowed, ...options.passEnv].filter((name) => name in process.env).map((name) => [name, process.env[name]])), DEEP_RUN_TOKEN: token };
  const blocked = blockedBy(agent, bin, facts, env);
  if (blocked) return finish({ reason: `BLOCKED: ${blocked}`, workdir: realpathSync(work) });

  const answer = `Your answer, sent by DeepBuild's hook: the code word is ${randomBytes(4).toString('hex')}w.`;
  const tokenWord = answer.match(/code word is (\w+)/)[1];
  writeFileSync(join(dir, 'answer.txt'), answer);
  const job = scenario === 'read-only-job';
  const probe = join(realpathSync(work), 'probe.txt');
  let args, settings;
  if (job) args = facts.launch.readOnlyJob.args;
  else {
    settings = join(dir, 'settings.json');
    const command = (mode) => [process.execPath, hook, mode, dir].map(quote).join(' ');
    const stop = scenario === 'idle-wake' ? { type: 'command', command: command('wake'), asyncRewake: true, timeout: 30 } : { type: 'command', command: command(edit ? 'event' : 'hold') };
    // add-readme-line's hooks are the --hooks file's, unchanged; the harness's own go beside them.
    const given = edit && !fix ? JSON.parse(readFileSync(options.hooks, 'utf8')).hooks ?? {} : {};
    writeFileSync(settings, JSON.stringify({
      hooks: {
        ...given,
        SessionStart: [...(given.SessionStart ?? []), { hooks: [{ type: 'command', command: command('event') }] }],
        Stop: [...(given.Stop ?? []), { hooks: [stop] }],
        // A turn whose model calls fail ends with StopFailure.
        ...(edit ? { StopFailure: [...(given.StopFailure ?? []), { hooks: [{ type: 'command', command: command('event') }] }] } : {}),
      },
      statusLine: { type: 'command', command: `cat > ${quote(join(dir, 'status.tmp'))} && mv ${quote(join(dir, 'status.tmp'))} ${quote(join(dir, 'status.json'))}`, refreshInterval: 1 },
    }, null, 2));
    // add-readme-line loads no setting source, so neither the checkout's settings nor yours run in it. It has only the
    // two tools its prompt needs, and accepts edits, so no permission prompt waits on a person.
    // fix-checkout-test loads your user settings only, never the checkout's, with the three tools its prompt needs, each allowed.
    args = facts.launch.session.args.map((arg, at, all) => (arg === '{settings}' ? settings : edit && all[at - 1] === '--setting-sources' ? (fix ? 'user' : '') : arg));
    // The prompt is the person's, word for word; that no one answers a question back is the harness's to say.
    // A command run through a pipe exits as the pipe's last command, so a failing test run would read as passing.
    if (fix) args.push('--tools', 'Bash,Read,Edit', '--allowedTools', 'Bash,Read,Edit', '--append-system-prompt', `${SCRIPTED} Run each command the prompt names exactly as written, with no pipe or redirection added.`);
    else if (edit) args.push('--tools', 'Read,Edit', '--permission-mode', 'acceptEdits', '--append-system-prompt', SCRIPTED);
  }
  const argv = [bin, ...args];
  const [shell, shellArgs] = job ? [bin, args] : inTerminal(argv);
  const child = spawn(shell, shellArgs, { cwd: work, env: job ? env : { ...env, TERM: 'xterm-256color' }, stdio: ['pipe', 'pipe', 'pipe'] });
  const processes = new Processes(child.pid);
  let output = '', exited = false;
  child.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
  child.on('error', () => {}).on('exit', () => { exited = true; });
  child.stdin.on('error', () => {});
  if (job) child.stdin.end(`Create the file ${probe} containing the word probe, using a tool. Then say whether it worked.`);
  await processes.poll();

  // The session's own record: its transcript (Claude Code) or rollout (Codex), and what it spent.
  let sessionId, transcript, usage = { tokens: 'not captured' }, cost = { basis: 'not captured' };
  const read = () => {
    if (job) {
      const stream = parse(output);
      const first = stream.find((event) => event.session_id || event.thread_id);
      sessionId ??= first?.session_id ?? first?.thread_id;
      if (agent === 'codex') {
        transcript ??= sessionId && rollout(facts, env, sessionId);
        usage = codexUsage(lines(transcript));
      } else {
        transcript ??= sessionId && join(home(facts, env), 'projects', realpathSync(work).replace(/[^a-zA-Z0-9]/g, '-'), `${sessionId}.jsonl`);
        usage = claudeUsage(lines(transcript));
        const result = stream.find((event) => event.type === 'result');
        if (typeof result?.total_cost_usd === 'number') cost = { basis: 'reported', usd: result.total_cost_usd };
      }
    } else {
      const start = lines(join(dir, 'events.jsonl')).find((event) => event.hook_event_name === 'SessionStart');
      [sessionId, transcript] = [start?.session_id, start?.transcript_path];
      usage = claudeUsage(lines(transcript));
      let status;
      try { status = JSON.parse(readFileSync(join(dir, 'status.json'), 'utf8')); } catch {}
      if (typeof status?.cost?.total_cost_usd === 'number') cost = { basis: 'reported', usd: status.cost.total_cost_usd };
    }
    if (!priced && usage.tokens !== 'not captured') cost = { basis: 'unpriced' };
  };

  const deadline = Date.now() + options.timeoutMs;
  let stop, verdict, reason, typedAt, exiting, trusted = false, keyed = false;
  while (!stop) {
    await sleep(100);
    await processes.poll();
    read();
    if (!job) {
      const events = lines(join(dir, 'events.jsonl'));
      const start = events.find((event) => event.hook_event_name === 'SessionStart');
      // The trust prompt for the folder the harness just made: pick "Yes", whichever line the cursor is on.
      const screen = plain(output).replace(/\s+/g, '');
      if (!trusted && /trustthisfolder/.test(screen) && /Entertoconfirm/.test(screen)) {
        trusted = true;
        await sleep(300);
        if (/❯No,exit/.test(screen.slice(screen.lastIndexOf('trustthisfolder') - 200))) { child.stdin.write('\x1b[B'); await sleep(200); }
        child.stdin.write('\r');
      }
      // A key passed with --pass-env is one the caller chose for the session: answer Claude Code's question with "Yes".
      if (edit && !keyed && /DetectedacustomAPIkey/.test(screen) && /Entertoconfirm/.test(screen.slice(screen.lastIndexOf('DetectedacustomAPIkey')))) {
        keyed = true;
        await sleep(300);
        if (/❯No/.test(screen.slice(screen.lastIndexOf('DetectedacustomAPIkey')))) { child.stdin.write('\x1b[A'); await sleep(200); }
        child.stdin.write('\r');
      }
      // The person's own prompt says an answer will come, as a real ask does; the code word itself never is in it.
      if (start && !typedAt && Date.now() - start.at > 1500) {
        typedAt = Date.now();
        child.stdin.write(fix ? FIX_PROMPT : edit ? EDIT_PROMPT : 'Reply with only the word READY. After that, a DeepBuild hook will send you my answer, a code word; when it arrives, reply with only that code word.');
        await sleep(300);
        child.stdin.write('\r');
      }
      const stops = events.filter((event) => event.hook_event_name === 'Stop');
      const said = (text) => typeof text === 'string' && text.includes(tokenWord);
      const replied = stops.slice(1).some((event) => said(event.last_assistant_message))
        || (stops.length > 1 && lines(transcript).some((entry) => entry.type === 'assistant' && said(JSON.stringify(entry.message?.content))));
      // add-readme-line and fix-checkout-test end the session with /exit once its one turn has stopped, so its SessionEnd hooks run to their end.
      if (edit) {
        const ended = events.filter((event) => ['Stop', 'StopFailure'].includes(event.hook_event_name));
        if (ended.length && !exiting) {
          exiting = Date.now();
          child.stdin.write('/exit');
          await sleep(300);
          child.stdin.write('\r');
        }
        const how = ended.at(-1)?.hook_event_name;
        if (exiting && (exited || Date.now() - exiting > 10_000)) [stop, verdict, reason] = how === 'Stop' ? ['done', 'PASS', ''] : ['done', 'FAIL', `the turn ended with ${how}, not Stop`];
      } else if (replied) [stop, verdict] = ['done', 'PASS'];
      else if (stops.length > 1) [stop, verdict, reason] = ['done', 'FAIL', 'the session continued without the answer it was given'];
    }
    if (priced && cost.usd > cap.usd) [stop, verdict, reason] = ['cost_cap', 'INCONCLUSIVE', `cost $${cost.usd} passed the $${cap.usd} cap, so the run was stopped`];
    else if (!priced && usage.tokens !== 'not captured' && total(usage.tokens) > cap.tokens) [stop, verdict, reason] = ['token_cap', 'INCONCLUSIVE', `${total(usage.tokens)} tokens passed the ${cap.tokens} token cap, so the run was stopped`];
    else if (interrupted) [stop, verdict, reason] = ['interrupted', 'INCONCLUSIVE', 'the harness was stopped by a signal'];
    else if (job && exited) {
      const tried = [output, ...lines(transcript).map((entry) => JSON.stringify(entry))].some((text) => text.includes(basename(probe)));
      [stop, verdict, reason] = existsSync(probe) ? ['done', 'FAIL', `the read-only job wrote ${probe}`]
        : tried ? ['done', 'PASS', ''] : ['done', 'INCONCLUSIVE', 'the job never tried the write, so the sandbox went untested'];
    } else if (!job && exited && !stop) [stop, verdict, reason] = ['done', 'FAIL', 'the session exited before the scenario finished'];
    else if (Date.now() > deadline) [stop, verdict, reason] = ['timeout', 'FAIL', `the scenario did not finish within ${options.timeoutMs} ms`];
  }
  if (verdict === 'PASS' && !job) await sleep(1000); // the transcript lags the live turn
  const { started: pids, lingered, living } = await processes.stop();
  // Anything that escaped must not hold the harness open through its pipes.
  for (const stream of [child.stdin, child.stdout, child.stderr]) stream.destroy();
  read();
  if (living.length) [verdict, reason] = ['FAIL', `processes ${living.join(', ')} survived SIGKILL`];
  else if (verdict === 'PASS' && cost.basis === 'not captured') [verdict, reason] = ['INCONCLUSIVE', 'the session reported no usage, so no cap held it'];
  writeFileSync(join(dir, job ? 'stream.jsonl' : 'screen.log'), output);
  const kept = join(dir, 'transcript.jsonl');
  if (transcript && existsSync(transcript)) copyFileSync(transcript, kept);
  else if (job) writeFileSync(kept, output);
  return finish({
    verdict, stop, reason, model: usage.model, tokens: usage.tokens, cost, sessionId, transcript: existsSync(kept) ? kept : null, settings, workdir: realpathSync(work),
    launch: { argv, facts: factsFile[agent] }, processes: { started: pids, lingered },
    evidence: job ? { probe } : edit ? { prompt: fix ? FIX_PROMPT : EDIT_PROMPT } : scenario === 'held-stop' ? { answer, token: tokenWord } : { token: tokenWord },
  });
}

// settings-tamper (#18): two interactive sessions in one folder, A and B, each loading your user settings, where
// DeepBuild's entries are. A runs the --script with Bash, then `ls -a`; once A's turn stops, B runs `ls -a`. The
// harness's own hooks record each session's events from its --settings file, never from your settings file.
async function tamperRun(options) {
  const token = `run_${randomBytes(6).toString('hex')}`;
  const started = performance.now();
  const facts = JSON.parse(readFileSync(factsFile.claude, 'utf8'));
  const line = { run: token, scenario: 'settings-tamper', agent: 'claude', verdict: 'BLOCKED', stop: 'blocked', reason: '', elapsedMs: 0 };
  const finish = (fields) => { Object.assign(line, fields, { elapsedMs: Math.round(performance.now() - started) }); console.log(JSON.stringify(line)); return line; };
  const bin = binary('claude', options.claude);
  const dir = join(options.out, token);
  const work = resolve(options.workdir);
  mkdirSync(dir, { recursive: true });
  if (!existsSync(work)) return finish({ reason: `BLOCKED: the workdir ${work} does not exist` });
  const env = { ...Object.fromEntries([...allowed, ...options.passEnv].filter((name) => name in process.env).map((name) => [name, process.env[name]])), DEEP_RUN_TOKEN: token };
  const blocked = blockedBy('claude', bin, facts, env);
  if (blocked) return finish({ reason: `BLOCKED: ${blocked}` });
  const tag = randomBytes(3).toString('hex');
  const prompts = {
    A: `Use the Bash tool to run exactly: node ${quote(resolve(options.script))} ${tag}\nThen use the Bash tool to run exactly: ls -a\nThen reply with only the word DONE.`,
    B: 'Use the Bash tool to run exactly: ls -a\nThen reply with only the word DONE.',
  };
  const sessions = ['A', 'B'].map((name) => {
    const own = join(dir, name);
    mkdirSync(own);
    const settings = join(own, 'settings.json');
    const command = [process.execPath, hook, 'event', own].map(quote).join(' ');
    writeFileSync(settings, JSON.stringify({ hooks: Object.fromEntries(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'StopFailure'].map((e) => [e, [{ hooks: [{ type: 'command', command }] }]])) }, null, 2));
    // Your user settings load beside the harness's, so DeepBuild's entries run; only Bash runs, with no prompt to answer.
    const args = facts.launch.session.args.map((arg, at, all) => (arg === '{settings}' ? settings : all[at - 1] === '--setting-sources' ? 'user' : arg));
    args.push('--tools', 'Bash', '--allowedTools', 'Bash', '--append-system-prompt', SCRIPTED);
    const [shell, shellArgs] = inTerminal([bin, ...args]);
    const child = spawn(shell, shellArgs, { cwd: work, env: { ...env, TERM: 'xterm-256color' }, stdio: ['pipe', 'pipe', 'pipe'] });
    const session = { name, own, child, processes: new Processes(child.pid), output: '', exited: false, trusted: false, typedAt: 0, exiting: 0 };
    child.stdout.setEncoding('utf8').on('data', (chunk) => { session.output += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { session.output += chunk; });
    child.on('error', () => {}).on('exit', () => { session.exited = true; });
    child.stdin.on('error', () => {});
    return session;
  });
  const events = (s) => lines(join(s.own, 'events.jsonl'));
  const stopped = (s) => events(s).some((e) => ['Stop', 'StopFailure'].includes(e.hook_event_name));
  const type = async (s, text) => { s.child.stdin.write(text); await sleep(300); s.child.stdin.write('\r'); };
  const deadline = Date.now() + options.timeoutMs;
  let stop, verdict, reason;
  while (!stop) {
    await sleep(100);
    for (const s of sessions) {
      await s.processes.poll();
      const screen = plain(s.output).replace(/\s+/g, '');
      if (!s.trusted && /trustthisfolder/.test(screen) && /Entertoconfirm/.test(screen)) {
        s.trusted = true;
        await sleep(300);
        if (/❯No,exit/.test(screen.slice(screen.lastIndexOf('trustthisfolder') - 200))) { s.child.stdin.write('\x1b[B'); await sleep(200); }
        s.child.stdin.write('\r');
      }
    }
    const [a, b] = sessions;
    const began = (s) => events(s).find((e) => e.hook_event_name === 'SessionStart');
    // B is asked only once A's turn stopped, so B's next call comes after A's script removed the entry.
    if (began(a) && began(b) && !a.typedAt && Date.now() - began(a).at > 1500) { a.typedAt = Date.now(); await type(a, prompts.A); }
    if (stopped(a) && !b.typedAt) { b.typedAt = Date.now(); await type(b, prompts.B); }
    for (const s of sessions) if (stopped(s) && !s.exiting && (s === b || b.typedAt)) { s.exiting = Date.now(); await type(s, '/exit'); }
    if (sessions.every((s) => s.exiting && (s.exited || Date.now() - s.exiting > 10_000))) {
      const failed = sessions.filter((s) => events(s).filter((e) => ['Stop', 'StopFailure'].includes(e.hook_event_name)).at(-1)?.hook_event_name !== 'Stop');
      [stop, verdict, reason] = failed.length ? ['done', 'FAIL', `${failed.map((s) => s.name).join(' and ')} ended with StopFailure, not Stop`] : ['done', 'PASS', ''];
    } else if (interrupted) [stop, verdict, reason] = ['interrupted', 'INCONCLUSIVE', 'the harness was stopped by a signal'];
    else if (sessions.some((s) => s.exited && !s.exiting)) [stop, verdict, reason] = ['done', 'FAIL', 'a session exited before the scenario finished'];
    else if (Date.now() > deadline) [stop, verdict, reason] = ['timeout', 'FAIL', `the scenario did not finish within ${options.timeoutMs} ms`];
  }
  await sleep(1000); // the transcript lags the live turn
  const kept = [];
  for (const s of sessions) {
    const { living } = await s.processes.stop();
    for (const stream of [s.child.stdin, s.child.stdout, s.child.stderr]) stream.destroy();
    if (living.length) [verdict, reason] = ['FAIL', `processes ${living.join(', ')} survived SIGKILL`];
    writeFileSync(join(s.own, 'screen.log'), s.output);
    const start = events(s).find((e) => e.hook_event_name === 'SessionStart');
    const transcript = join(s.own, 'transcript.jsonl');
    if (start?.transcript_path && existsSync(start.transcript_path)) copyFileSync(start.transcript_path, transcript);
    kept.push({ name: s.name, sessionId: start?.session_id ?? null, transcript: existsSync(transcript) ? transcript : null });
  }
  return finish({ verdict, stop, reason, workdir: realpathSync(work), evidence: { sessions: kept, tag } });
}

// The deep-answer scenario (#25): your answer back into interactive Claude Code sessions through DeepBuild's own
// entries, as `deep setup` wrote them into your user settings, with the session's own `deep mcp` from --mcp-config.
// Each session asks through deep_ask; the caller answers at the route's moment and writes the --go file when the
// harness may type on. The harness's own hooks only record each session's payloads, from its --settings file.
async function answerRun(options) {
  const token = `run_${randomBytes(6).toString('hex')}`;
  const started = performance.now();
  const facts = JSON.parse(readFileSync(factsFile.claude, 'utf8'));
  const route = options.route;
  const line = { run: token, scenario: 'deep-answer', agent: 'claude', verdict: 'BLOCKED', stop: 'blocked', reason: '', elapsedMs: 0 };
  const finish = (fields) => { Object.assign(line, fields, { elapsedMs: Math.round(performance.now() - started) }); console.log(JSON.stringify(line)); return line; };
  const bin = binary('claude', options.claude);
  const dir = join(options.out, token);
  const work = resolve(options.workdir);
  mkdirSync(dir, { recursive: true });
  if (!existsSync(work)) return finish({ reason: `BLOCKED: the workdir ${work} does not exist` });
  const env = { ...Object.fromEntries([...allowed, ...options.passEnv].filter((name) => name in process.env).map((name) => [name, process.env[name]])), DEEP_RUN_TOKEN: token };
  const blocked = blockedBy('claude', bin, facts, env);
  if (blocked) return finish({ reason: `BLOCKED: ${blocked}` });
  const sessions = [];
  const begin = (name, extra = []) => {
    const own = join(dir, name);
    mkdirSync(own);
    const settings = join(own, 'settings.json');
    const command = [process.execPath, hook, 'event', own].map(quote).join(' ');
    writeFileSync(settings, JSON.stringify({ hooks: Object.fromEntries(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'StopFailure', 'SessionEnd'].map((e) => [e, [{ hooks: [{ type: 'command', command }] }]])) }, null, 2));
    const args = facts.launch.session.args.map((arg, at, all) => (arg === '{settings}' ? settings : all[at - 1] === '--setting-sources' ? 'user' : arg));
    args.push('--mcp-config', resolve(options.mcpConfig), '--allowedTools', 'mcp__deep__deep_ask', ...extra);
    const [shell, shellArgs] = inTerminal([bin, ...args]);
    const child = spawn(shell, shellArgs, { cwd: work, env: { ...env, TERM: 'xterm-256color' }, stdio: ['pipe', 'pipe', 'pipe'] });
    const session = { name, own, child, processes: new Processes(child.pid), output: '', exited: false, trusted: false, exiting: 0, typed: [] };
    child.stdout.setEncoding('utf8').on('data', (chunk) => { session.output += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { session.output += chunk; });
    child.on('error', () => {}).on('exit', () => { session.exited = true; });
    child.stdin.on('error', () => {});
    sessions.push(session);
    return session;
  };
  const events = (s) => lines(join(s.own, 'events.jsonl'));
  const stops = (s) => events(s).filter((e) => e.hook_event_name === 'Stop');
  const startOf = (s) => events(s).find((e) => e.hook_event_name === 'SessionStart');
  const turnOver = (s, at) => lines(startOf(s)?.transcript_path).some((e) => e.type === 'system' && e.subtype === 'turn_duration' && Date.parse(e.timestamp) >= at - 1000);
  const type = async (s, text) => { s.typed.push({ at: Date.now(), text }); s.child.stdin.write(text); await sleep(300); s.child.stdin.write('\r'); };
  const deadline = Date.now() + options.timeoutMs;
  class Ended extends Error { constructor(stop, verdict, reason) { super(reason); Object.assign(this, { stop, verdict }); } }
  const until = async (probe, what) => {
    for (;;) {
      await sleep(100);
      for (const s of sessions) {
        await s.processes.poll();
        const screen = plain(s.output).replace(/\s+/g, '');
        if (!s.trusted && /trustthisfolder/.test(screen) && /Entertoconfirm/.test(screen)) {
          s.trusted = true;
          await sleep(300);
          if (/❯No,exit/.test(screen.slice(screen.lastIndexOf('trustthisfolder') - 200))) { s.child.stdin.write('\x1b[B'); await sleep(200); }
          s.child.stdin.write('\r');
        }
      }
      const value = probe();
      if (value) return value;
      if (interrupted) throw new Ended('interrupted', 'INCONCLUSIVE', 'the harness was stopped by a signal');
      if (sessions.some((s) => s.exited && !s.exiting)) throw new Ended('done', 'FAIL', `${sessions.filter((s) => s.exited && !s.exiting).map((s) => s.name).join(' and ')} exited before the scenario finished`);
      if (Date.now() > deadline) throw new Ended('timeout', 'FAIL', `the scenario did not finish within ${options.timeoutMs} ms, waiting for ${what}`);
    }
  };
  const ready = (s) => until(() => startOf(s) && Date.now() - startOf(s).at > 1500, `${s.name}'s SessionStart`);
  const exit = async (s) => { s.exiting = Date.now(); await type(s, '/exit'); await until(() => s.exited || Date.now() - s.exiting > 10_000, `${s.name} to exit`); };
  const FOLLOW = 'Reply with only the word READY, unless an answer to a question you asked has reached you; then reply with only the label of the option chosen.';
  // One round: the session asks with deep_ask, two fresh code words as the options' labels; its first stop follows.
  const ask = async (s, round) => {
    const words = [`Lantern${randomBytes(2).toString('hex')}`, `Harbor${randomBytes(2).toString('hex')}`];
    const from = stops(s).length;
    await type(s, `Call the mcp__deep__deep_ask tool once with kind "choice", the question "Which option for round ${round}?" exactly as written, options [{"id":"a","label":"${words[0]}"},{"id":"b","label":"${words[1]}"}] and recommended "a". Whatever it returns, call no other tool and end your turn in one sentence without either label. My answer will reach you later through DeepBuild, as hook feedback or a task notification: when it does, reply with only the label of the option I chose.`);
    const first = await until(() => stops(s)[from], `round ${round}'s first Stop of ${s.name}`);
    // The answered stop: a later one whose reply names an option's label, whatever brought the answer.
    return { first, after: () => stops(s).slice(from + 1).find((x) => words.some((w) => String(x.last_assistant_message ?? '').includes(w))) };
  };
  let stop = 'done', verdict = 'PASS', reason = '';
  try {
    const a = begin('A');
    await ready(a);
    if (route === 'stop-hold') {
      const r = await ask(a, 1);
      await until(() => r.after(), 'a Stop of A carrying an option\'s label');
    } else if (route === 'idle-wake') {
      for (let round = 1; round <= Number(options.rounds ?? 1); round++) {
        const r = await ask(a, round);
        await until(() => { const st = r.after(); return st && turnOver(a, st.at); }, `round ${round}'s answered Stop of A and its turn's end`);
      }
    } else if (route === 'next-prompt') {
      const r = await ask(a, 1);
      await until(() => turnOver(a, r.first.at), 'A\'s turn to end');
      await until(() => existsSync(options.go), 'the --go file');
      const n = stops(a).length;
      await type(a, FOLLOW);
      await until(() => stops(a)[n], 'the Stop after the follow-up prompt');
    } else {
      const r = await ask(a, 1);
      await until(() => turnOver(a, r.first.at), 'A\'s turn to end');
      await exit(a);
      await until(() => existsSync(options.go), 'the --go file');
      const b = begin('B');
      await ready(b);
      await type(b, FOLLOW);
      await until(() => stops(b)[0], 'B\'s Stop');
      await exit(b);
      const a2 = begin('A2', ['--resume', startOf(a).session_id]);
      await ready(a2);
      await type(a2, FOLLOW);
      await until(() => stops(a2)[0], 'A2\'s Stop');
    }
    for (const s of sessions) if (!s.exiting) await exit(s);
  } catch (error) {
    if (!(error instanceof Ended)) throw error;
    ({ stop, verdict } = error);
    reason = error.message;
  }
  await sleep(1000); // the transcript lags the live turn
  const kept = [];
  for (const s of sessions) {
    const { living } = await s.processes.stop();
    for (const stream of [s.child.stdin, s.child.stdout, s.child.stderr]) stream.destroy();
    if (living.length) [verdict, reason] = ['FAIL', `processes ${living.join(', ')} survived SIGKILL`];
    writeFileSync(join(s.own, 'screen.log'), s.output);
    const start = startOf(s);
    const transcript = join(s.own, 'transcript.jsonl');
    if (start?.transcript_path && existsSync(start.transcript_path)) copyFileSync(start.transcript_path, transcript);
    kept.push({ name: s.name, sessionId: start?.session_id ?? null, transcript: existsSync(transcript) ? transcript : null, hooks: join(s.own, 'events.jsonl'), typed: s.typed });
  }
  return finish({ verdict, stop, reason, workdir: realpathSync(work), evidence: { route, sessions: kept } });
}

async function all(options) {
  const started = performance.now();
  const results = [];
  for (const [scenario, agent] of PAIRS) if (!interrupted) results.push(await run(options, scenario, agent));
  return { results, wholeMs: Math.round(performance.now() - started) };
}

// The design's reference Macs (Numbers version 0 has to hold): a 16-inch MacBook Pro with a 12-core
// M3 Pro and 36 GB, or a 13-inch MacBook Air with an 8-core M3 and 16 GB, on mains power, Low Power
// Mode off, with no thermal or performance warning.
const referenceMacs = {
  'Mac15,7': { memoryGb: 36, cores: '12', chip: /M3 Pro/, name: 'M3 Pro' },
  'Mac15,12': { memoryGb: 16, cores: '8', chip: /Apple M3$/, name: 'M3' },
};
function machine() {
  if (process.platform !== 'darwin') return { model: process.platform, reference: false, why: 'not a Mac' };
  const sysctl = (key) => spawnSync('sysctl', ['-n', key], { encoding: 'utf8' }).stdout.trim();
  const model = sysctl('hw.model');
  const mac = Object.hasOwn(referenceMacs, model) ? referenceMacs[model] : null;
  const why = [
    !mac && `model ${model}, not ${Object.keys(referenceMacs).join(' or ')}`,
    mac && sysctl('hw.memsize') !== String(mac.memoryGb * 2 ** 30) && `memory is not ${mac.memoryGb} GB`,
    mac && sysctl('hw.ncpu') !== mac.cores && `not ${mac.cores} cores`,
    mac && !mac.chip.test(sysctl('machdep.cpu.brand_string')) && `not an ${mac.name}`,
    !/'AC Power'/.test(spawnSync('pmset', ['-g', 'ps'], { encoding: 'utf8' }).stdout) && 'on battery',
    /lowpowermode\s+1/.test(spawnSync('pmset', ['-g'], { encoding: 'utf8' }).stdout) && 'Low Power Mode is on',
    /level\s*=\s*[1-9]|CPU_Speed_Limit\s*=\s*(?!100\b)\d+/.test(spawnSync('pmset', ['-g', 'therm'], { encoding: 'utf8' }).stdout) && 'the thermal state is not nominal',
  ].filter(Boolean);
  return { model, reference: !why.length, ...(why.length ? { why: why.join('; ') } : {}) };
}

// The preflight's lane: on a change that touches the harness, run every session, hold each to the
// session budget and all of them to the whole budget, and compare with the merge base's harness.
async function budgets(options) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const lane = { lane: 'harness budgets', status: 'BLOCKED', reason: '' };
  const done = (fields) => { Object.assign(lane, fields); console.log(JSON.stringify(lane)); return ['PASS', 'INITIAL', 'UNTOUCHED'].includes(lane.status) ? 0 : 1; };
  try {
    lane.baseCommit = git('rev-parse', `${options.base ?? git('merge-base', 'HEAD', 'origin/main')}^{commit}`);
  } catch (error) {
    return done({ reason: `no merge base to compare with: ${error.message.split('\n')[0]}` });
  }
  const changed = options.changed ?? [...git('diff', '--name-only', lane.baseCommit).split('\n'), ...git('ls-files', '--others', '--exclude-standard').split('\n')].filter(Boolean);
  lane.touched = [...new Set(changed.filter((path) => harnessFiles.includes(path)))].sort();
  if (!lane.touched.length) return done({ status: 'UNTOUCHED', reason: 'the change touches none of the harness, its hook or its launch facts, so no agent ran' });
  lane.budgets = resolve(options.budgets ?? join(root, 'benchmarks/budgets.json'));
  const budget = JSON.parse(readFileSync(lane.budgets, 'utf8')).harness;
  if (!budget?.limits) return done({ reason: `${lane.budgets} has no harness budget` });
  Object.assign(lane, { limits: budget.limits, machine: machine() });
  const sessions = ({ results }) => results.map(({ scenario, agent, elapsedMs }) => ({ scenario, agent, elapsedMs }));
  const current = await all(options);
  lane.current = { wholeMs: current.wholeMs, sessions: sessions(current) };
  // A session that failed for any reason but its time measured nothing a budget can judge.
  const broken = current.results.filter(({ verdict, stop }) => verdict !== 'PASS' && stop !== 'timeout');
  if (broken.length) return done({ reason: `runs that didn't pass measured nothing: ${broken.map(({ scenario, agent, reason }) => `${scenario}/${agent}: ${reason}`).join('; ')}` });

  let base = null;
  if (spawnSync('git', ['cat-file', '-e', `${lane.baseCommit}:scripts/agent-harness.mjs`], { cwd: root }).status === 0) {
    const copy = mkdtempSync(join(tmpdir(), 'deep-harness-base-'));
    try {
      execFileSync('tar', ['-xf', '-', '-C', copy], { input: execFileSync('git', ['archive', lane.baseCommit], { cwd: root, encoding: null, maxBuffer: 128 * 1024 * 1024 }) });
      const binaries = ['claude', 'codex'].flatMap((agent) => { const path = binary(agent, options[agent]); return path ? [`--${agent}`, path] : []; });
      const started = performance.now();
      const result = spawnSync(process.execPath, ['scripts/agent-harness.mjs', 'all', ...binaries, '--out', join(options.out, 'base')], { cwd: copy, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      const runs = parse(result.stdout).filter((object) => object.run);
      if (result.status !== 0) return done({ reason: `the merge base's harness didn't pass, so there is nothing to compare: ${runs.filter(({ verdict }) => verdict !== 'PASS').map(({ scenario, agent, reason }) => `${scenario}/${agent}: ${reason}`).join('; ')}` });
      base = { wholeMs: Math.round(performance.now() - started), sessions: sessions({ results: runs }) };
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  }
  lane.base = base;
  if (!base) lane.initialReason = budget.initialReason;
  lane.over = [
    ...lane.current.sessions.filter(({ elapsedMs }) => elapsedMs >= budget.limits.sessionMs).map((session) => ({ budget: 'session', ...session, limitMs: budget.limits.sessionMs })),
    ...(current.wholeMs >= budget.limits.wholeMs ? [{ budget: 'whole', elapsedMs: current.wholeMs, limitMs: budget.limits.wholeMs }] : []),
  ];
  const slower = (now, then) => then && now > then * (1 + budget.margin);
  lane.regressed = base ? [
    ...lane.current.sessions.filter((session) => slower(session.elapsedMs, base.sessions.find(({ scenario, agent }) => scenario === session.scenario && agent === session.agent)?.elapsedMs)),
    ...(slower(current.wholeMs, base.wholeMs) ? [{ budget: 'whole', elapsedMs: current.wholeMs, baseMs: base.wholeMs }] : []),
  ] : [];
  const failed = lane.over.length || lane.regressed.length;
  if (!lane.machine.reference) return done({ status: 'INCONCLUSIVE', reason: `off the reference Mac (${lane.machine.why}), a budget is only a reading` });
  if (failed) return done({ status: 'FAIL', reason: `${lane.over.length} reading(s) over their limit, ${lane.regressed.length} slower than the merge base by more than ${budget.margin * 100}%` });
  return done(base ? { status: 'PASS', reason: '' } : { status: 'INITIAL', reason: 'first measurement: the merge base has no harness' });
}

let interrupted = false;
const signals = ['SIGTERM', 'SIGINT', 'SIGHUP'];
for (const name of signals) process.on(name, () => { interrupted = true; });

let options;
try { options = parseArgs(process.argv.slice(2)); } catch (error) {
  console.error(`${error.message}\nUsage: node scripts/agent-harness.mjs run --scenario <held-stop|idle-wake|read-only-job|add-readme-line|fix-checkout-test|settings-tamper|deep-answer> [--workdir <dir> [--hooks <settings.json> | --script <file> | --mcp-config <file> --route <stop-hold|idle-wake|next-prompt|resume> [--go <file>] [--rounds <n>]] [--pass-env <NAME>]...] [--agent claude|codex] [--claude <path>] [--codex <path>] [--cost-cap-usd <n>] [--token-cap <n>] [--timeout-ms <n>] [--out <dir>]\n       node scripts/agent-harness.mjs all [--claude <path>] [--codex <path>] [--out <dir>]\n       node scripts/agent-harness.mjs budgets [--base <commit>] [--changed <path>]... [--budgets <file>] [--claude <path>] [--codex <path>] [--out <dir>]`);
  process.exit(2);
}
options.out = resolve(options.out ?? mkdtempSync(join(tmpdir(), 'deep-harness-')));
mkdirSync(options.out, { recursive: true });
let code;
if (options.command === 'budgets') code = await budgets(options);
else {
  const { results, wholeMs } = options.command === 'all' ? await all(options)
    : { results: [options.scenario === 'settings-tamper' ? await tamperRun(options) : options.scenario === 'deep-answer' ? await answerRun(options) : await run(options, options.scenario)] };
  const pass = results.length > 0 && results.every(({ verdict }) => verdict === 'PASS');
  if (options.command === 'all') console.log(JSON.stringify({ summary: true, verdict: pass ? 'PASS' : 'FAIL', runs: results.length, elapsedMs: wholeMs }));
  code = pass ? 0 : 1;
}
// Once the runs are over, a signal ends the harness at once.
for (const name of signals) process.removeAllListeners(name);
process.exitCode = code;
