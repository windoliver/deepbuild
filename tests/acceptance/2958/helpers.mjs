import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const CLI = process.env.DEEP_CLI || join(REPO, 'packages/cli/dist/main.js');
export const APP = process.env.DEEP_APP_BIN || join(REPO, 'target/debug/deep-app');

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function needBuilt() {
  if (!existsSync(APP)) throw Error(`BLOCKED: no deep-app is built at ${APP}; run cargo build -p deep-app --bin deep-app, or set DEEP_APP_BIN`);
  if (!existsSync(CLI)) throw Error(`BLOCKED: no built CLI at ${CLI}; run npm run build --workspaces, or set DEEP_CLI`);
}

const made = [];
export function tempDir() {
  const dir = realpathSync(mkdtempSync('/tmp/dh2958-'));
  made.push(dir);
  return dir;
}

export function childEnv(home) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|GIT_|npm_|ANTHROPIC_|OPENAI_|AWS_)/.test(key) || key === 'NODE_OPTIONS') continue;
    env[key] = value;
  }
  env.HOME = home;
  env.LC_ALL = 'C';
  return env;
}

const hubs = new Set();
const gone = (child) => child.exitCode !== null || child.signalCode !== null;
async function stopHub(child) {
  if (!gone(child)) {
    child.kill('SIGTERM');
    for (let i = 0; i < 600 && !gone(child); i++) await sleep(50);
    if (!gone(child)) child.kill('SIGKILL');
    for (let i = 0; i < 100 && !gone(child); i++) await sleep(50);
  }
  hubs.delete(child);
}
export async function cleanup() {
  for (const child of [...hubs]) await stopHub(child);
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export function answers(socket, ms = 2000) {
  return new Promise((resolve) => {
    const s = net.connect(socket);
    const timer = setTimeout(() => { s.destroy(); resolve(false); }, ms);
    s.once('data', () => { clearTimeout(timer); s.destroy(); resolve(true); });
    s.once('error', () => { clearTimeout(timer); resolve(false); });
  });
}

export async function startHub(home, root) {
  const args = [CLI, 'hub', 'run', ...(root ? ['--root', root] : [])];
  const socket = join(root ?? join(home, '.deepbuild'), 'hub.sock');
  const child = spawn(process.execPath, args, { cwd: home, env: childEnv(home), stdio: ['ignore', 'pipe', 'pipe'] });
  hubs.add(child);
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (d) => (output += d));
  child.stderr.setEncoding('utf8').on('data', (d) => (output += d));
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (gone(child)) throw Error(`BLOCKED: the hub (deep hub run${root ? ` --root ${root}` : ''}) exited ${child.exitCode ?? child.signalCode} before it answered: ${output.slice(-2000)}`);
    if (existsSync(socket) && (await answers(socket))) return { socket, pid: child.pid, stop: () => stopHub(child), output: () => output };
    await sleep(100);
  }
  await stopHub(child);
  throw Error(`BLOCKED: the hub (deep hub run${root ? ` --root ${root}` : ''}) didn't answer on ${socket} within 30 s: ${output.slice(-2000)}`);
}

export function configure(home, socket) {
  mkdirSync(join(home, '.deepbuild'), { recursive: true, mode: 0o700 });
  writeFileSync(join(home, '.deepbuild', 'config.json'), `${JSON.stringify({ hub: { address: `unix:${socket}` } }, null, 2)}\n`, { mode: 0o600 });
}

export function hubCheck(home) {
  return new Promise((resolve) => {
    const child = spawn(APP, ['--hub-check'], { cwd: home, env: childEnv(home), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 60_000);
    child.on('error', (error) => { stderr += `\n[spawn failed: ${error.message}]`; });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, timedOut }); });
  });
}
export const shown = (r) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.timedOut ? ', killed at 60 s' : ''}, stdout ${JSON.stringify(r.stdout.slice(0, 1500))}, stderr ${JSON.stringify(r.stderr.slice(0, 1500))}`;

export function sources(dirs) {
  const files = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else files[relative(REPO, path)] = readFileSync(path, 'utf8');
    }
  };
  for (const dir of dirs) walk(join(REPO, dir));
  return files;
}

export function lex(src) {
  const text = src.split('');
  const code = src.split('');
  const blank = (arr, from, to) => { for (let k = from; k < to; k++) if (arr[k] !== '\n') arr[k] = ' '; };
  const ident = (c) => c !== undefined && /[A-Za-z0-9_]/.test(c);
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      let j = src.indexOf('\n', i);
      if (j < 0) j = src.length;
      blank(text, i, j); blank(code, i, j);
      i = j;
    } else if (c === '/' && src[i + 1] === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < src.length && depth > 0) {
        if (src[j] === '/' && src[j + 1] === '*') { depth++; j += 2; } else if (src[j] === '*' && src[j + 1] === '/') { depth--; j += 2; } else j++;
      }
      blank(text, i, j); blank(code, i, j);
      i = j;
    } else if ((c === 'r' || (c === 'b' && src[i + 1] === 'r')) && !ident(src[i - 1]) && /^(b?r)(#*)"/.test(src.slice(i, i + 300))) {
      const [, prefix, hashes] = /^(b?r)(#*)"/.exec(src.slice(i, i + 300));
      const open = i + prefix.length + hashes.length + 1;
      let j = src.indexOf(`"${hashes}`, open);
      if (j < 0) j = src.length;
      blank(code, open, j);
      i = j + 1 + hashes.length;
    } else if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
      blank(code, i + 1, j);
      i = j + 1;
    } else if (c === '\'') {
      if (src[i + 1] === '\\') {
        let j = i + 2;
        while (j < src.length && src[j] !== '\'' && src[j] !== '\n') j++;
        if (src[i + 2] === '\'') j = i + 3;
        blank(code, i + 1, j);
        i = j + 1;
      } else {
        const point = src.codePointAt(i + 1);
        const width = point !== undefined && point > 0xffff ? 2 : 1;
        if (src[i + 1 + width] === '\'' && src[i + 1] !== '\n') {
          blank(code, i + 1, i + 1 + width);
          i = i + 2 + width;
        } else i++;
      }
    } else i++;
  }
  return { text: text.join(''), code: code.join('') };
}

export function tokenSites(files) {
  const sites = [];
  for (const [path, src] of Object.entries(files)) {
    const lines = src.split('\n');
    const lineAt = (offset) => src.slice(0, offset).split('\n').length;
    if (!path.endsWith('.rs')) {
      for (let at = src.indexOf('control.token'); at >= 0; at = src.indexOf('control.token', at + 1)) {
        sites.push({ path, line: lineAt(at), text: lines[lineAt(at) - 1].trim(), fn: null });
      }
      continue;
    }
    const { text, code } = lex(src);
    const bodies = [];
    const stack = [];
    let pending = null;
    for (let i = 0; i < code.length; i++) {
      const c = code[i];
      if (c === 'f' && code[i + 1] === 'n' && !/[A-Za-z0-9_]/.test(code[i - 1] ?? ' ')) {
        const m = /^fn\s+(r#)?([A-Za-z_][A-Za-z0-9_]*)/.exec(code.slice(i, i + 200));
        if (m) { pending = { name: m[2], line: lineAt(i) }; i += m[0].length - 1; continue; }
      }
      if (c === ';' && pending) pending = null;
      else if (c === '{') {
        if (pending) { const body = { ...pending, from: i, to: code.length }; bodies.push(body); stack.push(body); pending = null; } else stack.push(null);
      } else if (c === '}') {
        const top = stack.pop();
        if (top) top.to = i;
      }
    }
    for (let at = text.indexOf('control.token'); at >= 0; at = text.indexOf('control.token', at + 1)) {
      const holders = bodies.filter((b) => b.from < at && at < b.to);
      const inner = holders.sort((a, b) => b.from - a.from)[0];
      sites.push({ path, line: lineAt(at), text: lines[lineAt(at) - 1].trim(), fn: inner ? { name: inner.name, line: inner.line } : null });
    }
  }
  return sites;
}

export const ONE_FILE = 'crates/deep-app/src/hub.rs';

export function strays(files) {
  const sites = tokenSites(files);
  const at = (s) => `${s.path}:${s.line}: ${s.text}${s.fn ? `  (in fn ${s.fn.name})` : '  (outside any function)'}`;
  const inOne = sites.filter((s) => s.path === ONE_FILE && s.fn);
  const fns = new Set(inOne.map((s) => `${s.fn.name}@${s.fn.line}`));
  const allowed = fns.size === 1 ? new Set(inOne) : new Set();
  const out = sites.filter((s) => !allowed.has(s)).map(at);
  if (fns.size === 0) out.unshift(`no function in ${ONE_FILE} names control.token: there is no one function that returns the hub's token file`);
  if (fns.size > 1) out.unshift(`${fns.size} functions in ${ONE_FILE} name control.token (${[...fns].join(', ')}); only one may`);
  return out;
}
