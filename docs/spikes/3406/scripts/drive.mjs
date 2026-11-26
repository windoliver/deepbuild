#!/usr/bin/env node
// Throwaway #3406 spike driver: starts one throwaway Claude Code session for one scenario, with hooks/hook.mjs on
// every hook event, and keeps what it leaves in a raw run folder outside the repo. Each run is live and spends plan usage.
//   node drive.mjs <scenario> --bin <claude> --mode manual|auto|bypassPermissions --raw <folder> [--name <run>]
//     [--inbound hold|refuse]  the session's crossSessionInbound    [--idle <ms>]  a long idle before the post
//     [--target <run>]  the run whose session a `cross` or `sibling` scenario reaches
// Sessions take their hooks from --settings and load project settings only, so your own hooks, MCP servers and
// instructions stay out; an older version never updates your install.
import { execFile, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { scenarios, settingsFor } from './scenarios.mjs';

const flag = (name, fallback) => { const at = process.argv.indexOf(`--${name}`); return at === -1 ? fallback : process.argv[at + 1]; };
const scenarioName = process.argv[2], bin = flag('bin'), mode = flag('mode', 'manual'), raw = flag('raw'), inbound = flag('inbound'), idleMs = Number(flag('idle', 0)), target = flag('target');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const quote = (text) => `'${String(text).replaceAll("'", "'\\''")}'`;
const lines = (path) => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
const plain = (text) => text.replace(/\x1b\[[0-9;?<>=]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][A-Z0-9]|\x1b[=>78]/g, '').replace(/\s+/g, '');

const { stdout: versionText } = await promisify(execFile)(bin, ['--version']);
const version = versionText.match(/\d+\.\d+\.\d+/)[0];
const scenario = scenarios[scenarioName]({ nonce: () => randomBytes(4).toString('hex'), uuid: randomUUID, idleMs, target });
const run = join(raw, flag('name', `${version}-${scenario.place}-${mode}-${scenarioName}${inbound ? `-${inbound}` : ''}${idleMs ? `-${idleMs / 60_000}m` : ''}`));
const work = join(raw, 'work');
mkdirSync(run, { recursive: true });
mkdirSync(work, { recursive: true });
writeFileSync(join(run, 'plan.json'), JSON.stringify(scenario.plan, null, 1));
writeFileSync(join(run, 'settings.json'), JSON.stringify(settingsFor({ actors: scenario.actors, inbound }), null, 1));
const note = (line) => appendFileSync(join(run, 'driver.jsonl'), `${JSON.stringify({ at: Date.now(), ...line })}\n`);
note({ scenario: scenarioName, version, mode, place: scenario.place, inbound: inbound ?? null, load: (await promisify(execFile)('sysctl', ['-n', 'vm.loadavg'])).stdout.trim() });

const logged = () => lines(join(run, 'log.jsonl'));
const count = (event) => logged().filter((line) => line.phase === 'start' && line.entry === 'log' && line.event === event).length;
const until = async (test, ms) => { for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) if (test()) return true; return false; };
const args = ['--model', 'haiku', '--setting-sources', 'project', '--strict-mcp-config', '--settings', join(run, 'settings.json'), '--permission-mode', mode, '--debug-file', join(run, 'debug.log')];
const allowed = ['HOME', 'USER', 'LOGNAME', 'SHELL', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE'];
const env = { ...Object.fromEntries(allowed.filter((name) => name in process.env).map((name) => [name, process.env[name]])), TERM: 'xterm-256color', SPIKE3406_RUN: run, SPIKE3406_PLACE: scenario.place };

async function descendants(rootPid) {
  const { stdout } = await promisify(execFile)('ps', ['-A', '-o', 'pid=,ppid=']);
  const rows = stdout.trim().split('\n').map((line) => line.trim().split(/\s+/).map(Number));
  const found = new Set([rootPid]);
  for (let grew = true; grew;) { grew = false; for (const [pid, ppid] of rows) if (!found.has(pid) && found.has(ppid)) { found.add(pid); grew = true; } }
  return [...found];
}
// Stops only what this driver started, by PID.
async function stopTree(rootPid) {
  for (const signal of ['SIGTERM', 'SIGKILL']) {
    for (const pid of await descendants(rootPid)) try { process.kill(pid, signal); } catch {}
    await sleep(signal === 'SIGTERM' ? 1500 : 200);
  }
}

async function session(argv, { terminal, steps }) {
  const shellCommand = `stty cols 120 rows 40; exec ${argv.map(quote).join(' ')}`;
  const child = terminal
    ? spawn('/bin/sh', ['-c', `cat | script -q /dev/null /bin/sh -c ${quote(shellCommand)}`], { cwd: realpathSync(work), env, stdio: ['pipe', 'pipe', 'pipe'] })
    : spawn(argv[0], argv.slice(1), { cwd: realpathSync(work), env, stdio: ['pipe', 'pipe', 'pipe'] });
  let screen = '';
  // A claude -p session's output stream, each line with the time it came.
  let pending = '';
  const stream = (chunk) => { const parts = (pending + chunk).split('\n'); pending = parts.pop(); for (const part of parts.filter(Boolean)) { let line = part; try { line = JSON.parse(part); } catch {} appendFileSync(join(run, 'stream.jsonl'), `${JSON.stringify({ at: Date.now(), line })}\n`); } };
  child.stdout.setEncoding('utf8').on('data', terminal ? (chunk) => { screen += chunk; } : stream);
  child.stderr.setEncoding('utf8').on('data', (chunk) => { if (terminal) screen += chunk; else appendFileSync(join(run, 'stderr.log'), chunk); });
  child.stdin.on('error', () => {});
  let exited = false;
  child.on('exit', (code, signal) => { exited = true; note({ exited: { code, signal } }); });
  // A one-prompt claude -p session takes its prompt on stdin, as a headless job of ours would.
  if (scenario.prompt) child.stdin.end(scenario.prompt);
  const type = async (text) => {
    if (!terminal) return void child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: text } })}\n`);
    const before = count('UserPromptSubmit');
    child.stdin.write(text); await sleep(500); child.stdin.write('\r');
    // A terminal UI that is still settling can drop the Enter; a prompt that fired no hook gets it again.
    for (let tries = 0; tries < 4 && !text.startsWith('/') && !(await until(() => count('UserPromptSubmit') > before, 15_000)); tries++) child.stdin.write('\r');
  };
  const startsBefore = count('SessionStart');
  try {
    if (terminal) {
      // The folder trust dialog for the scratch folder, and the notice of the Chrome extension, as the corpus recorder answers them.
      const trust = {};
      const ready = await until(() => {
        const text = plain(screen), dialog = text.slice(text.lastIndexOf('Quicksafetycheck'));
        if (!trust.done && /trustthisfolder/.test(dialog) && /Entertoconfirm/.test(dialog) && Date.now() - (trust.seen ??= Date.now()) > 800) {
          if (/❯Yes,Itrustthisfolder/.test(dialog)) { child.stdin.write('\r'); trust.done = true; }
          else if (Date.now() - (trust.moved ?? 0) > 800) { child.stdin.write('\x1b[B'); trust.moved = Date.now(); }
        }
        const chrome = text.slice(text.lastIndexOf('ClaudeinChromeextensiondetected'));
        if (count('SessionStart') === startsBefore && text.includes('ClaudeinChromeextensiondetected') && /❯No,keepbrowsertoolsoff/.test(chrome) && Date.now() - (trust.chromeAt ?? 0) > 1500) { child.stdin.write('\x1b'); trust.chromeAt = Date.now(); }
        return count('SessionStart') > startsBefore;
      }, 90_000);
      note({ ready });
      if (!ready) return;
      await sleep(2000);
    }
    for (const step of steps) {
      let ok = true;
      if (step.type) await type(step.type);
      if (step.stops) ok = await until(() => count('Stop') + count('StopFailure') >= step.stops, step.ms ?? 120_000);
      if (step.posted) ok = await until(() => logged().some((line) => line.id === step.posted && ['post', 'control'].includes(line.phase)), step.ms ?? 120_000);
      if (step.hookAfter) { const from = logged().find((line) => line.id === step.hookAfter && ['post', 'control'].includes(line.phase))?.at ?? Infinity; ok = await until(() => logged().some((line) => line.phase === 'start' && line.at > from), step.ms ?? 20_000); }
      if (step.quiet) ok = await until(() => Date.now() - (logged().at(-1)?.at ?? 0) > step.quiet, step.ms ?? 120_000);
      if (step.exits) ok = await until(() => exited, step.ms ?? 120_000);
      if (step.wait) await sleep(step.wait);
      if (step.closeInput) child.stdin.end();
      if (step.screen) appendFileSync(join(run, 'screens.jsonl'), `${JSON.stringify({ at: Date.now(), label: step.screen, text: plain(screen).slice(-1800) })}\n`);
      note({ step, ok });
    }
    if (terminal && !exited) { await type('/exit'); await until(() => exited, 8000); }
  } finally {
    child.stdin.end();
    if (!exited) await stopTree(child.pid);
    if (terminal) writeFileSync(join(run, 'screen.log'), screen);
    // The transcript of every session the run's hooks named, as Claude Code left it.
    for (const path of new Set(logged().map((line) => line.payload?.transcript_path).filter(Boolean))) if (existsSync(path)) copyFileSync(path, join(run, `transcript.${path.split('/').at(-1)}`));
    note({ done: true });
  }
}

const terminal = scenario.place === 'terminal';
const argv = terminal ? [bin, ...args] : [bin, '-p', '--output-format', 'stream-json', '--verbose', ...(scenario.stream ? ['--input-format', 'stream-json'] : []), ...args];
await session(argv, { terminal, steps: scenario.steps });
// The same session again in a new process, as `claude --resume` starts it.
if (scenario.resume) await session([...argv, '--resume', logged().find((line) => line.session).session], { terminal: true, steps: scenario.resume });
const posts = logged().filter((line) => ['post', 'control'].includes(line.phase)).map((line) => `${line.id}:${line.wrote ? 'wrote' : line.error}`);
console.log(JSON.stringify({ run, hooks: logged().filter((line) => line.phase === 'start' && line.entry === 'log').length, stops: count('Stop'), prompts: count('UserPromptSubmit'), posts: posts.length > 6 ? `${posts.length} posts` : posts.join(' ') }));
