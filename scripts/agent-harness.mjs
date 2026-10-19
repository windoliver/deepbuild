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

const valued = { '--scenario': 'scenario', '--agent': 'agent', '--claude': 'claude', '--codex': 'codex', '--cost-cap-usd': 'costCapUsd', '--token-cap': 'tokenCap', '--timeout-ms': 'timeoutMs', '--out': 'out', '--base': 'base', '--budgets': 'budgets' };
function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command, agent: 'claude', costCapUsd: 0.5, tokenCap: 300_000, timeoutMs: 60_000, changed: undefined };
  for (let index = 0; index < rest.length; index += 2) {
    const [flag, value] = [rest[index], rest[index + 1]];
    if (value === undefined || !(flag in valued || flag === '--changed')) throw Error(`unknown or incomplete option ${flag}`);
    if (flag === '--changed') (options.changed ??= []).push(value);
    else options[valued[flag]] = ['costCapUsd', 'tokenCap', 'timeoutMs'].includes(valued[flag]) ? Number(value) : value;
  }
  if (!['run', 'all', 'budgets'].includes(command)) throw Error('expected run, all or budgets');
  if (command === 'run' && !['held-stop', 'idle-wake', 'read-only-job'].includes(options.scenario)) throw Error('run needs a known --scenario');
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
  const dir = join(options.out, token), work = join(dir, 'work');
  mkdirSync(work, { recursive: true });
  const env = { ...Object.fromEntries(allowed.filter((name) => name in process.env).map((name) => [name, process.env[name]])), DEEP_RUN_TOKEN: token };
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
    const stop = scenario === 'idle-wake' ? { type: 'command', command: command('wake'), asyncRewake: true, timeout: 30 } : { type: 'command', command: command('hold') };
    writeFileSync(settings, JSON.stringify({
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: command('event') }] }], Stop: [{ hooks: [stop] }] },
      statusLine: { type: 'command', command: `cat > ${quote(join(dir, 'status.tmp'))} && mv ${quote(join(dir, 'status.tmp'))} ${quote(join(dir, 'status.json'))}`, refreshInterval: 1 },
    }, null, 2));
    args = facts.launch.session.args.map((arg) => (arg === '{settings}' ? settings : arg));
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
  let stop, verdict, reason, typedAt, trusted = false;
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
      // The person's own prompt says an answer will come, as a real ask does; the code word itself never is in it.
      if (start && !typedAt && Date.now() - start.at > 1500) {
        typedAt = Date.now();
        child.stdin.write('Reply with only the word READY. After that, a DeepBuild hook will send you my answer, a code word; when it arrives, reply with only that code word.');
        await sleep(300);
        child.stdin.write('\r');
      }
      const stops = events.filter((event) => event.hook_event_name === 'Stop');
      const said = (text) => typeof text === 'string' && text.includes(tokenWord);
      const replied = stops.slice(1).some((event) => said(event.last_assistant_message))
        || (stops.length > 1 && lines(transcript).some((entry) => entry.type === 'assistant' && said(JSON.stringify(entry.message?.content))));
      if (replied) [stop, verdict] = ['done', 'PASS'];
      else if (stops.length > 1) [stop, verdict, reason] = ['done', 'FAIL', 'the session continued without the answer it was given'];
    }
    if (priced && cost.usd > cap.usd) [stop, verdict, reason] = ['cost_cap', 'INCONCLUSIVE', `cost $${cost.usd} passed the $${cap.usd} cap, so the run was stopped`];
    else if (!priced && usage.tokens !== 'not captured' && total(usage.tokens) > cap.tokens) [stop, verdict, reason] = ['token_cap', 'INCONCLUSIVE', `${total(usage.tokens)} tokens passed the ${cap.tokens} token cap, so the run was stopped`];
    else if (interrupted) [stop, verdict, reason] = ['interrupted', 'INCONCLUSIVE', 'the harness was stopped by a signal'];
    else if (job && exited) {
      const tried = [output, ...lines(transcript).map((entry) => JSON.stringify(entry))].some((text) => text.includes(basename(probe)));
      [stop, verdict, reason] = existsSync(probe) ? ['done', 'FAIL', `the read-only job wrote ${probe}`]
        : tried ? ['done', 'PASS', ''] : ['done', 'INCONCLUSIVE', 'the job never tried the write, so the sandbox went untested'];
    } else if (!job && exited) [stop, verdict, reason] = ['done', 'FAIL', 'the session exited before the scenario finished'];
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
    evidence: job ? { probe } : scenario === 'held-stop' ? { answer, token: tokenWord } : { token: tokenWord },
  });
}

async function all(options) {
  const started = performance.now();
  const results = [];
  for (const [scenario, agent] of PAIRS) if (!interrupted) results.push(await run(options, scenario, agent));
  return { results, wholeMs: Math.round(performance.now() - started) };
}

// The design's one reference Mac (Numbers version 0 has to hold): a 16-inch MacBook Pro with a
// 12-core M3 Pro and 36 GB, on mains power, Low Power Mode off, with no thermal or performance warning.
function machine() {
  if (process.platform !== 'darwin') return { model: process.platform, reference: false, why: 'not a Mac' };
  const sysctl = (key) => spawnSync('sysctl', ['-n', key], { encoding: 'utf8' }).stdout.trim();
  const model = sysctl('hw.model');
  const why = [
    model !== 'Mac15,7' && `model ${model}, not Mac15,7`,
    sysctl('hw.memsize') !== String(36 * 2 ** 30) && 'memory is not 36 GB',
    sysctl('hw.ncpu') !== '12' && 'not 12 cores',
    !/M3 Pro/.test(sysctl('machdep.cpu.brand_string')) && 'not an M3 Pro',
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
    // The archive goes through a file: the repo's archive is tens of MB, past a child's output buffer.
    const archive = `${copy}.tar`;
    try {
      execFileSync('git', ['archive', '--output', archive, lane.baseCommit], { cwd: root });
      execFileSync('tar', ['-xf', archive, '-C', copy]);
      const binaries = ['claude', 'codex'].flatMap((agent) => { const path = binary(agent, options[agent]); return path ? [`--${agent}`, path] : []; });
      const started = performance.now();
      const result = spawnSync(process.execPath, ['scripts/agent-harness.mjs', 'all', ...binaries, '--out', join(options.out, 'base')], { cwd: copy, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      const runs = parse(result.stdout).filter((object) => object.run);
      if (result.status !== 0) return done({ reason: `the merge base's harness didn't pass, so there is nothing to compare: ${runs.filter(({ verdict }) => verdict !== 'PASS').map(({ scenario, agent, reason }) => `${scenario}/${agent}: ${reason}`).join('; ')}` });
      base = { wholeMs: Math.round(performance.now() - started), sessions: sessions({ results: runs }) };
    } finally {
      rmSync(copy, { recursive: true, force: true });
      rmSync(archive, { force: true });
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
  console.error(`${error.message}\nUsage: node scripts/agent-harness.mjs run --scenario <held-stop|idle-wake|read-only-job> [--agent claude|codex] [--claude <path>] [--codex <path>] [--cost-cap-usd <n>] [--token-cap <n>] [--timeout-ms <n>] [--out <dir>]\n       node scripts/agent-harness.mjs all [--claude <path>] [--codex <path>] [--out <dir>]\n       node scripts/agent-harness.mjs budgets [--base <commit>] [--changed <path>]... [--budgets <file>] [--claude <path>] [--codex <path>] [--out <dir>]`);
  process.exit(2);
}
options.out = resolve(options.out ?? mkdtempSync(join(tmpdir(), 'deep-harness-')));
mkdirSync(options.out, { recursive: true });
let code;
if (options.command === 'budgets') code = await budgets(options);
else {
  const { results, wholeMs } = options.command === 'all' ? await all(options) : { results: [await run(options, options.scenario)] };
  const pass = results.length > 0 && results.every(({ verdict }) => verdict === 'PASS');
  if (options.command === 'all') console.log(JSON.stringify({ summary: true, verdict: pass ? 'PASS' : 'FAIL', runs: results.length, elapsedMs: wholeMs }));
  code = pass ? 0 : 1;
}
// Once the runs are over, a signal ends the harness at once.
for (const name of signals) process.removeAllListeners(name);
process.exitCode = code;
