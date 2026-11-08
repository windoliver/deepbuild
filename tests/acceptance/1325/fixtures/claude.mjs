#!/usr/bin/env node
// A stand-in for Claude Code, installed by the tests as `claude` on the test home's login PATH (helpers.ts). Copied
// from tests/acceptance/1330/fixtures/claude.mjs (same repo, same license) so a redraft of theirs moves nothing here;
// what this copy changes is marked "#1325". It is the boundary this suite doesn't own: the agent and its model. It
// decides nothing about DeepBuild; it does what Claude Code does with what it is given, so the hub's start is judged
// by its effects:
//
// - argv as Claude Code reads it: `--version`, `--settings <file or JSON>`, `--permission-mode <mode>`,
//   `--dangerously-skip-permissions`, `--session-id <id>`, other flags skipped, the first plain word the prompt.
// - settings merged as Claude Code merges them: user (`$CLAUDE_CONFIG_DIR` or `~/.claude`) < project
//   `.claude/settings.json` < `.claude/settings.local.json` < `--settings`; objects merged, arrays joined.
// - the permission mode: the flag, else `--dangerously-skip-permissions` (bypassPermissions), else the settings'
//   `permissions.defaultMode`, else `default`, the mode that asks before acting.
// - hooks: every command hook in the merged settings for the event (and the tool, by matcher), JSON on stdin,
//   through `/bin/sh -c`, as the agent's own child.
// - its sandbox, Claude Code's settings keys: `sandbox.enabled` turns it on; writes then go only to the working folder,
//   the temp folders and the paths `Edit(...)` allow rules or `sandbox.filesystem.allowWrite` add; reads are denied
//   for `Read(...)` deny rules and `sandbox.filesystem.denyRead`; direct network connections are denied (Claude Code
//   reaches allowed domains only through its proxy), except unix sockets named in `sandbox.network.allowUnixSockets`
//   (or all, with `allowAllUnixSockets`). #1325: a loopback host (`127.0.0.1` or `localhost`) named in
//   `sandbox.network.allowedDomains` is reached directly, standing for Claude Code's proxy letting an allowed host
//   through; a host that isn't loopback lets every connection through (the live run only, where the hosts are
//   GitHub's). `sandbox.excludedCommands` run outside it. A Bash call with
//   `dangerouslyDisableSandbox` runs outside it unless `sandbox.allowUnsandboxedCommands` is false. Enforced by
//   macOS Seatbelt (`sandbox-exec`), on the Bash tool's commands and, as the issue's spike asks of deep-hook
//   ("still reaches the hub's socket from inside"), on its hooks too.
// - the model: the prompt's tags pick what the turn does (#1325; README, The stand-in agent):
//     [standin:bash:<base64url>]       the Bash tool runs the decoded command; several run in their order
//     [standin:exit]                   after the turn's Stop, the session ends: SessionEnd, then the process exits
//   Any other prompt is one turn with no tool call. Every turn ends with Stop; then it idles until signalled, and
//   fires SessionEnd on SIGTERM or SIGHUP.
//
// What it saw and did is written to __LOGDIR__/<pid>.json after every step: #1325, its whole environment included,
// since what a session's environment holds is what AC3 reads.
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

const VERSION = '__VERSION__';
const LOGDIR = '__LOGDIR__';
const argv = process.argv.slice(2);

if (argv.includes('--version') || argv.includes('-v')) {
  process.stdout.write(`${VERSION} (Claude Code)\n`);
  process.exit(0);
}

const log = { pid: process.pid, argv, cwd: process.cwd(), started: Date.now(), env: { ...process.env }, hooks: [], bash: [], typed: '', done: false };
const save = () => {
  mkdirSync(LOGDIR, { recursive: true });
  // A whole file at every step, moved into place: the reader never sees half of one.
  writeFileSync(join(LOGDIR, `${process.pid}.tmp`), JSON.stringify(log, null, 1));
  renameSync(join(LOGDIR, `${process.pid}.tmp`), join(LOGDIR, `${process.pid}.json`));
};

// ---- argv.
const VALUE_FLAGS = new Set(['--settings', '--permission-mode', '--model', '--setting-sources', '--mcp-config', '--append-system-prompt',
  '--system-prompt', '--add-dir', '--allowedTools', '--allowed-tools', '--disallowedTools', '--disallowed-tools', '--session-id', '--resume', '-r',
  '--output-format', '--input-format', '--fallback-model', '--agents', '--plugin-dir', '--max-turns', '--permission-prompt-tool', '--debug-file', '--name']);
const flags = {};
let prompt;
const subcommand = ['mcp', 'config', 'auth', 'doctor', 'update', 'install', 'setup-token', 'plugin', 'migrate-installer'].includes(argv[0] ?? '') ? argv[0] : undefined;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--') && a.includes('=')) { const at = a.indexOf('='); (flags[a.slice(0, at)] ??= []).push(a.slice(at + 1)); continue; }
  if (VALUE_FLAGS.has(a)) { (flags[a] ??= []).push(argv[++i] ?? ''); continue; }
  if (a.startsWith('-')) { (flags[a] ??= []).push(true); continue; }
  if (prompt === undefined) prompt = a;
}
log.prompt = prompt ?? null;
if (subcommand || flags['-p'] || flags['--print']) {
  // Not a session: a job or a subcommand, which this stand-in doesn't play.
  log.refused = subcommand ? `subcommand ${subcommand}` : 'print mode';
  log.done = true;
  save();
  process.stderr.write(`claude stand-in: ${log.refused} is not played here\n`);
  process.exit(1);
}

// ---- settings, as Claude Code merges them.
const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
const cwd = process.cwd();
const readJson = (text, where) => { try { return JSON.parse(text); } catch { log.unreadable = [...(log.unreadable ?? []), where]; return {}; } };
const fromFile = (file) => (existsSync(file) ? readJson(readFileSync(file, 'utf8'), file) : {});
const merge = (a, b) => {
  if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = k in out ? merge(out[k], v) : v;
    return out;
  }
  return b;
};
const layers = [fromFile(join(configDir, 'settings.json')), fromFile(join(cwd, '.claude/settings.json')), fromFile(join(cwd, '.claude/settings.local.json'))];
for (const s of flags['--settings'] ?? []) layers.push(String(s).trim().startsWith('{') ? readJson(String(s), '--settings') : fromFile(resolve(String(s))));
const settings = layers.reduce((a, b) => merge(a, b), {});
log.settings = settings;

const flagMode = (flags['--permission-mode'] ?? []).at(-1);
const mode = typeof flagMode === 'string' ? flagMode : flags['--dangerously-skip-permissions'] ? 'bypassPermissions' : settings.permissions?.defaultMode ?? 'default';
log.mode = mode;
const sessionId = typeof (flags['--session-id'] ?? [])[0] === 'string' ? flags['--session-id'][0] : randomUUID();
log.session = sessionId;
const silent = /\[standin:silent\]/.test(prompt ?? '');
log.silent = silent;
save();

// ---- the sandbox.
const sb = settings.sandbox && typeof settings.sandbox === 'object' ? settings.sandbox : {};
const sandboxed = sb.enabled === true;
log.sandboxed = sandboxed;
const real = (p) => {
  // The longest existing prefix, resolved: Seatbelt matches real paths (/tmp is /private/tmp).
  let head = resolve(p);
  const tail = [];
  while (!existsSync(head) && dirname(head) !== head) { tail.unshift(head.slice(dirname(head).length + 1)); head = dirname(head); }
  try { head = realpathSync(head); } catch { /* as written */ }
  return join(head, ...tail);
};
const expand = (p) => {
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  if (p.startsWith('//')) return p.slice(1);
  if (isAbsolute(p)) return p;
  return join(cwd, p);
};
const rules = (list, tool) => (Array.isArray(list) ? list : []).flatMap((r) => {
  const m = typeof r === 'string' ? new RegExp(`^${tool}\\((.+)\\)$`).exec(r) : null;
  return m ? [m[1]] : [];
});
const esc = (s) => s.replace(/[\\"]/g, (c) => `\\${c}`);
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, (c) => `\\${c}`);
/** A path or glob as one Seatbelt filter: a folder and everything under it, or the glob's matches. */
const filter = (pattern) => {
  const abs = expand(pattern.replace(/\/\*\*$/, ''));
  const glob = /[*?]/.test(abs);
  if (!glob) return [`(subpath "${esc(real(abs))}")`, `(subpath "${esc(abs)}")`];
  const fixed = abs.slice(0, abs.search(/[*?]/));
  const base = fixed.endsWith('/') ? fixed.slice(0, -1) : dirname(fixed);
  const rest = abs.slice(base.length);
  const body = (b) => `^${reEsc(b)}${rest.split(/(\*\*|\*|\?)/).map((part) => (part === '**' ? '.*' : part === '*' ? '[^/]*' : part === '?' ? '[^/]' : reEsc(part))).join('')}(/.*)?$`;
  return [`(regex #"${body(real(base))}")`, `(regex #"${body(base)}")`];
};
const fs = sb.filesystem && typeof sb.filesystem === 'object' ? sb.filesystem : {};
const net = sb.network && typeof sb.network === 'object' ? sb.network : {};
const allowWrite = [...rules(settings.permissions?.allow, 'Edit'), ...rules(settings.permissions?.allow, 'Write'), ...(Array.isArray(fs.allowWrite) ? fs.allowWrite : [])];
const denyWrite = [...rules(settings.permissions?.deny, 'Edit'), ...rules(settings.permissions?.deny, 'Write'), ...(Array.isArray(fs.denyWrite) ? fs.denyWrite : [])];
const denyRead = [...rules(settings.permissions?.deny, 'Read'), ...(Array.isArray(fs.denyRead) ? fs.denyRead : [])];
const sockets = Array.isArray(net.allowUnixSockets) ? net.allowUnixSockets.map(String) : [];
// #1325: the hosts the approval names, as Claude Code's proxy lets them through.
const domains = Array.isArray(net.allowedDomains) ? net.allowedDomains.map(String) : [];
const loopback = domains.some((d) => d === '127.0.0.1' || d === 'localhost');
const anyHost = domains.some((d) => d !== '127.0.0.1' && d !== 'localhost');
const temps = ['/private/tmp', '/private/var/folders', real(tmpdir())];
const PROFILE = [
  '(version 1)',
  '(allow default)',
  '(deny file-write*)',
  `(allow file-write* ${[cwd, ...temps, ...allowWrite].flatMap(filter).join(' ')} (literal "/dev/null") (regex #"^/dev/(tty|fd/|ptmx|ttys)"))`,
  ...(denyWrite.length ? [`(deny file-write* ${denyWrite.flatMap(filter).join(' ')})`] : []),
  ...(denyRead.length ? [`(deny file-read* ${denyRead.flatMap(filter).join(' ')})`] : []),
  '(deny network-outbound)',
  net.allowAllUnixSockets === true
    ? '(allow network-outbound (remote unix-socket))'
    : sockets.length ? `(allow network-outbound ${sockets.flatMap((s) => [`(remote unix-socket (path-literal "${esc(expand(s))}"))`, `(remote unix-socket (path-literal "${esc(real(expand(s)))}"))`]).join(' ')})` : '',
  loopback ? '(allow network-outbound (remote ip "localhost:*"))' : '',
  anyHost ? '(allow network-outbound (remote ip "*:*"))' : '',
].join('\n');
log.walls = sandboxed ? { writes: true, network: true, credentials: denyRead.length > 0, unixSockets: net.allowAllUnixSockets === true ? 'all' : sockets, wayOut: sb.allowUnsandboxedCommands === false ? 'off' : 'open', excluded: sb.excludedCommands ?? [] } : null;
log.profile = sandboxed ? PROFILE : null;
save();

/** argv for `/bin/sh -c <command>`, inside the sandbox or not. */
const shell = (command, inside) => (inside ? ['/usr/bin/sandbox-exec', ['-p', PROFILE, '/bin/sh', '-c', command]] : ['/bin/sh', ['-c', command]]);
const childEnv = { ...process.env, CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_PROJECT_DIR: cwd };
function run(command, inside, input, timeoutMs) {
  return new Promise((done) => {
    const [file, args] = shell(command, inside);
    const child = spawn(file, args, { cwd, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); done({ code: null, stdout, stderr: `${stderr}${e.message}` }); });
    child.on('close', (code, signal) => { clearTimeout(timer); done({ code, signal, stdout, stderr }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
  });
}

// ---- hooks.
const transcript = join(configDir, 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${sessionId}.jsonl`);
async function hook(event, fields = {}, tool) {
  const groups = Array.isArray(settings.hooks?.[event]) ? settings.hooks[event] : [];
  const results = [];
  for (const g of groups) {
    const m = typeof g?.matcher === 'string' ? g.matcher : '';
    if (tool && m && m !== '*' && !new RegExp(`^(?:${m})$`).test(tool)) continue;
    for (const h of Array.isArray(g?.hooks) ? g.hooks : []) {
      if (h?.type !== 'command' || typeof h.command !== 'string') continue;
      const input = JSON.stringify({ session_id: sessionId, transcript_path: transcript, cwd, hook_event_name: event, permission_mode: mode, ...fields });
      const at = Date.now();
      if (h.async === true || h.asyncRewake === true) {
        const [file, args] = shell(h.command, sandboxed);
        const child = spawn(file, args, { cwd, env: childEnv, stdio: ['pipe', 'ignore', 'ignore'], detached: false });
        child.stdin.on('error', () => undefined);
        child.stdin.end(input);
        child.on('error', () => undefined);
        log.hooks.push({ event, command: h.command, at, async: true, pid: child.pid });
        continue;
      }
      const r = await run(h.command, sandboxed, input, (Number(h.timeout) || 600) * 1000);
      const entry = { event, command: h.command, at, ended: Date.now(), code: r.code, signal: r.signal ?? null, stdout: r.stdout.slice(0, 4000), stderr: r.stderr.slice(0, 4000) };
      log.hooks.push(entry);
      results.push(entry);
      save();
    }
  }
  return results;
}
const denied = (results) => results.some((r) => {
  if (r.code === 2) return true;
  try {
    const out = JSON.parse(r.stdout);
    const d = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
    return d === 'deny' || d === 'block' || d === 'ask';
  } catch { return false; }
});
const said = (role, text) => {
  mkdirSync(dirname(transcript), { recursive: true });
  appendFileSync(transcript, `${JSON.stringify({ type: role, message: { role, content: text }, uuid: randomUUID(), timestamp: new Date().toISOString(), cwd, sessionId, version: VERSION, userType: 'external', entrypoint: 'cli' })}\n`);
};

/** One call of the Bash tool, as Claude Code makes it: PreToolUse, the command in or out of the sandbox, PostToolUse. */
async function bash(command, outside) {
  const tool_use_id = `toolu_${randomBytes(10).toString('hex')}`;
  const tool_input = { command, description: 'Run the tests', ...(outside ? { dangerouslyDisableSandbox: true } : {}) };
  const pre = await hook('PreToolUse', { tool_name: 'Bash', tool_input, tool_use_id }, 'Bash');
  const entry = { command, asked_outside: outside, at: Date.now() };
  log.bash.push(entry);
  if (denied(pre)) { entry.denied = true; save(); return; }
  const first = command.replace(/^(\s*\w+=\S*\s+)*/, '').trim().split(/\s+/)[0];
  const excluded = Array.isArray(sb.excludedCommands) && sb.excludedCommands.some((c) => String(c).split(/\s+/)[0] === first);
  const inside = sandboxed && !excluded && !(outside && sb.allowUnsandboxedCommands !== false);
  entry.inside = inside;
  const r = await run(command, inside, '', 600_000);
  Object.assign(entry, { code: r.code, stdout: r.stdout.slice(-1_000_000), stderr: r.stderr.slice(-100_000), ended: Date.now() });
  save();
  await hook('PostToolUse', { tool_name: 'Bash', tool_input, tool_use_id, tool_response: { stdout: r.stdout, stderr: r.stderr, interrupted: false, isImage: false } }, 'Bash');
}

process.stdin.on('data', (d) => { log.typed += String(d); save(); });
process.stdin.on('error', () => undefined);
setInterval(() => undefined, 60_000);

let ending = false;
async function end(signal) {
  if (ending) return;
  ending = true;
  log.signal = signal;
  log.ended = Date.now();
  save();
  if (!silent) await Promise.race([hook('SessionEnd', { reason: 'other' }), new Promise((r) => setTimeout(r, 5000))]);
  save();
  process.exit(0);
}
for (const s of ['SIGTERM', 'SIGHUP', 'SIGINT']) process.on(s, () => void end(s));

if (!silent) {
  said('user', prompt ?? '');
  await hook('SessionStart', { source: 'startup', model: 'claude-haiku-5-5' });
  await hook('UserPromptSubmit', { prompt: prompt ?? '' });
  for (const [, encoded] of (prompt ?? '').matchAll(/\[standin:bash:([A-Za-z0-9_-]+)\]/g)) await bash(Buffer.from(encoded, 'base64url').toString('utf8'), false);
  said('assistant', 'Done.');
  log.stopAt = Date.now();
  save();
  await hook('Stop', { stop_hook_active: false, last_assistant_message: 'Done.' });
}
log.done = true;
save();
if (!silent && /\[standin:exit\]/.test(prompt ?? '')) await end('exit');
