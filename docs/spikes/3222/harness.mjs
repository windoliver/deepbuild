#!/usr/bin/env node
// #3222's harness: what a canvas call waits behind other sessions' calls on the hub's one line to the canvas core.
//
//   node docs/spikes/3222/harness.mjs --sessions <n> [--patches] [--slow] [--gate] [--plant times-from-core-start]
//                                     --home <dir> --out <file>
//
// It starts a real hub (`deep hub run`, this checkout's built CLI) with HOME at <dir>, so the hub serves
// <dir>/.deepbuild/hub.sock, with probe.mjs loaded into it, and drives its canvas side with <n> scripted sessions. Each
// session is #806's agent stand-in (tests/acceptance/806/fixtures/agent.mjs) presenting itself as a Claude Code
// session through its hooks: its `deep_show` goes through its own `deep mcp`, bound to it by its process, and its
// check is `deep show --check` run in its process tree, bound by the peer check. Each session draws on documents of
// its own. The probe notes, inside the hub, when each call arrives, when its line is written to the canvas core and
// when the core answers; the harness writes them to <file>, one row per call its sessions sent.
//
//   (no --patches)  Each session makes two setup calls, a whole revision of its 2D figure and one of its 3D box, then
//                   max(2, ceil(20 / n)) rounds of six calls in a rotation that starts at its own place: a patch of one
//                   value, a check, a render-back in 2D, a whole revision of the 3D box, a render-back in 3D and a
//                   whole revision of the 2D figure, each after a seeded gap of 0 to 250 ms. For 1, 4 and 16 sessions,
//                   20, 5 and 2 rounds.
//   --patches       Each session shows its figure, then, once all have, they all patch one value at once.
//   --slow          With --patches: one more session shows the heavy fixture (#671's scene) and sends its 3D
//                   render-back, marked planted; the patches go once the probe saw its line written to the core.
//   --gate          The first stdout line is {"ready": true, "hub": <pid>} once the sessions are established; no
//                   canvas call is made before a line is read from stdin.
//   --plant times-from-core-start
//                   The planted twin (#3222 AC2): each call timed from its start in the core, so it reads no wait.
//
// The hub reads DEEP_HUB_TEST_SHOW as this harness's environment gives it. Without one, the harness writes its own
// world file, seeding each 2D document at revision 0 (a patch reaches only a seeded document: #1721). It also keeps
// the probe's log beside <file> (<file minus .json>.probe.jsonl). Every process it starts is stopped by PID, and its
// temporary folder is removed.
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const CLI = join(REPO, 'packages/cli/dist/main.js');
const AGENT = join(REPO, 'tests/acceptance/806/fixtures/agent.mjs');
const PROBE = join(HERE, 'probe.mjs');
const HEAVY = join(REPO, 'tests/acceptance/671/fixtures/scene.json');
const NODE = process.execPath;
const CALL_MS = 900_000;
const now = () => performance.timeOrigin + performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Processes and folders this run owns.
const owned = new Set();
const own = (pid) => { if (pid) owned.add(pid); };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
async function stopAll() {
  for (const pid of owned) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 5000;
  while ([...owned].some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of owned) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
}

/** This environment with HOME in the run's home and none of the hub's or the agents' settings, plus `extra`. */
function childEnv(home, extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|TMUX|CLAUDE|CODEX|GIT_)/.test(k) || k === 'NODE_OPTIONS') continue;
    env[k] = v;
  }
  Object.assign(env, { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), PATH: `${dirname(NODE)}:${process.env.PATH ?? '/usr/bin:/bin'}`, LC_ALL: 'C' });
  for (const [k, v] of Object.entries(extra)) if (v === undefined) delete env[k]; else env[k] = v;
  return env;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let minted = 0;
function ulid(ms = Date.now()) {
  let time = '';
  for (let t = ms, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  let tail = '';
  for (let n = ++minted + Math.floor(Math.random() * 2 ** 40), i = 0; i < 16; i++, n = Math.floor(n / 32)) tail = CROCKFORD[n % 32] + tail;
  return time + tail;
}
const docId = (n) => `01JC32${String(n).padStart(20, '0')}`;
function uuidOf(label) {
  const h = createHash('sha256').update(`ds3222:${label}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// ---- The documents.
const rect = (id, name, box, order, role = 'muted') => ({ id, kind: 'rect@1', name, order, params: { box, paint: { fill: { role } } } });
const label = (id, name, text, pos, order) => ({ id, kind: 'text@1', name, order, params: { text, font: 'body', size: 13, box: { w: 160, h: 20 } }, at: { pos: [pos[0], pos[1], 0] } });
const SIZE_2D = [320, 200];
const SIZE_3D = [320, 240];
/** #806's six-item figure, its build bar `w` px wide. */
const figure = (w) => ({
  format: 1, profile: 'board', title: 'Release readiness', description: 'Release readiness, drawn by a #3222 scripted session through deep_show.', size: SIZE_2D,
  items: Object.fromEntries([
    rect('back', 'Backdrop', [0, 0, 320, 200], 'a0', 'ground'),
    rect('bar-build', 'Build bar', [16, 60, w, 16], 'a1'),
    rect('bar-tests', 'Tests bar', [16, 90, 180, 16], 'a2'),
    rect('bar-docs', 'Docs bar', [16, 120, 120, 16], 'a3'),
    label('title', 'Title', 'Release readiness', [16, 20], 'a4'),
    label('caption', 'Caption', 'Ready for review', [16, 160], 'a5'),
  ].map((i) => [i.id, i])),
});
/** #1722's 3D fixture: a 2 m box at x under a perspective camera, with a 2D badge over its frame. */
const box3d = (x) => ({
  format: 1, profile: 'scene', title: 'A box under a badge', description: 'A #3222 scripted session\'s 3D document: one box with a 2D badge over it.',
  size: SIZE_3D, camera: 'cam', transport: { span: '1s' }, requires: { modules: { scene3d: '^1' } },
  items: {
    cam: { id: 'cam', name: 'cam', order: 'a0', kind: 'camera@1', params: { projection: 'perspective', position: [0, 0, 8], target: [0, 0, 0], fov: 40 } },
    box: { id: 'box', name: 'box', order: 'a1', kind: 'mark.box@1', params: { size: [2, 2, 2], paint: { fill: { role: 'accent' } } }, at: { pos: [x, 0, 0] } },
    badge: { id: 'badge', name: 'badge', order: 'a2', kind: 'rect@1', params: { box: [40, 30, 100, 60], paint: { fill: { role: 'ink' } } } },
  },
});
/** The heavy fixture: #671's scene, 200 boxes and a beacon under an orbiting camera, at its own 640 × 480. */
const heavy = () => JSON.parse(readFileSync(HEAVY, 'utf8'));
const HEAVY_SIZE = [640, 480];

// ---- A scripted session: #806's agent stand-in, its hooks, its `deep mcp` and a `deep show` in its process tree.
class Session {
  constructor(i, home, cwd) {
    this.i = i; this.home = home; this.cwd = cwd; this.id = uuidOf(`session-${i}`); this.name = `Scripted session ${i}`;
    this.n = 0; this.pending = new Map(); this.seq = BigInt(Date.now()) * 1_000_000n; this.transcript = null; this.rev = {};
    this.child = spawn(NODE, [AGENT], { cwd, env: childEnv(home), stdio: ['pipe', 'pipe', 'inherit'] });
    own(this.child.pid);
    let buffer = '';
    this.child.stdout.setEncoding('utf8').on('data', (d) => {
      buffer += d;
      for (let k = buffer.indexOf('\n'); k >= 0; k = buffer.indexOf('\n')) {
        let line; try { line = JSON.parse(buffer.slice(0, k)); } catch { line = undefined; }
        buffer = buffer.slice(k + 1);
        if (line && typeof line.n === 'number') this.pending.get(line.n)?.(line);
      }
    });
  }
  send(command, timeoutMs = CALL_MS) {
    const n = ++this.n;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(n); reject(Error(`session ${this.i}: no answer to ${command.op} in ${timeoutMs} ms`)); }, timeoutMs);
      this.pending.set(n, (line) => { clearTimeout(timer); this.pending.delete(n); if (line.failed) reject(Error(`session ${this.i}: ${command.op} failed: ${line.failed}`)); else resolve(line); });
      this.child.stdin.write(`${JSON.stringify({ n, ...command })}\n`);
    });
  }
  payload(event, extra = {}) {
    if (!this.transcript) {
      this.transcript = join(this.home, '.claude/projects', this.cwd.replace(/[^A-Za-z0-9]/g, '-'), `${this.id}.jsonl`);
      mkdirSync(dirname(this.transcript), { recursive: true });
      writeFileSync(this.transcript, `${JSON.stringify({ type: 'user', sessionId: this.id, cwd: this.cwd, message: { role: 'user', content: 'start' } })}\n`);
    }
    const p = { session_id: this.id, cwd: this.cwd, hook_event_name: event, permission_mode: 'default', transcript_path: this.transcript };
    if (event === 'SessionStart') Object.assign(p, { source: 'startup', model: 'claude-haiku-5-5' });
    if (event === 'UserPromptSubmit') Object.assign(p, { prompt: 'draw the release figure', prompt_id: `p-${randomBytes(6).toString('hex')}` });
    if (event === 'PreToolUse') Object.assign(p, { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: `toolu_${randomBytes(8).toString('hex')}` });
    return Object.assign(p, extra);
  }
  async hook(hub, event) {
    const request = { v: 1, agent: 'claude-code', event, seq: String(this.seq += 1000n), id: ulid(), matched: [], payload: this.payload(event) };
    const r = await this.send({ op: 'hook', socket: hub.socket, request, cwd: this.cwd }, 60_000);
    if (!(r.lines ?? []).some((l) => /"ack"/.test(l))) throw Error(`BLOCKED: the hub didn't acknowledge ${event} for session ${this.i}: ${JSON.stringify(r).slice(0, 400)}`);
  }
  async establish(hub) {
    for (const event of ['SessionStart', 'UserPromptSubmit', 'PreToolUse']) await this.hook(hub, event);
    const init = await this.mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'spike-3222', version: '0' } });
    if (!init.reply.result) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(init.reply).slice(0, 400)}`);
    await this.send({ op: 'mcp', argv: [NODE, CLI, 'mcp'], line: { jsonrpc: '2.0', method: 'notifications/initialized', params: {} } });
  }
  async mcp(method, params, timeoutMs = CALL_MS) {
    const line = { jsonrpc: '2.0', id: `${method}#${this.i}.${++this.n}`, method, params };
    const r = await this.send({ op: 'mcp', argv: [NODE, CLI, 'mcp'], line, timeoutMs }, timeoutMs + 5000);
    own(r.pid);
    return { reply: r.reply, ms: r.ms };
  }
  /** deep_show through this session's `deep mcp`: its reply's value. */
  async show(args) {
    const { reply } = await this.mcp('tools/call', { name: 'deep_show', arguments: args });
    const result = reply.result ?? {};
    const text = Array.isArray(result.content) ? result.content.find((c) => c?.type === 'text')?.text : undefined;
    let value = result.structuredContent;
    if (value === undefined && typeof text === 'string') try { value = JSON.parse(text); } catch { value = { text }; }
    return { value: value ?? { error: reply.error ?? null }, isError: result.isError === true || 'error' in reply };
  }
  /** `deep show --check` with a whole revision, run in this session's process tree: bound to it by the peer check. */
  async showCheck(doc, document, size) {
    const file = join(dirname(this.cwd), `check-${this.i}-${randomBytes(4).toString('hex')}.json`);
    writeFileSync(file, JSON.stringify(document));
    const argv = [NODE, CLI, 'show', '--doc', doc, '--document', file, '--json', '--check', '--t', '0s', '--size', size.join('x'), '--include', 'issues'];
    const r = await this.send({ op: 'exec', argv, cwd: this.cwd, env: childEnv(this.home), timeoutMs: CALL_MS }, CALL_MS + 5000);
    const last = String(r.stdout).trim().split('\n').filter((l) => l.startsWith('{')).at(-1);
    let value; try { value = JSON.parse(last ?? ''); } catch { value = { error: `exit ${r.code}: ${String(r.stderr).slice(0, 300)}` }; }
    return { value, isError: r.code !== 0 };
  }
  close() { try { this.child.stdin.end(JSON.stringify({ n: ++this.n, op: 'exit' }) + '\n'); } catch { /* gone */ } }
}

// ---- The world: a worktree, the world file, the hub.
const GIT_ENV = { GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' };
function makeWorktree(dir) {
  mkdirSync(join(dir, '.deepbuild'), { recursive: true });
  writeFileSync(join(dir, '.deepbuild', 'done.yaml'), [
    'claims:', '  done:', '    checks: [unit]', 'checks:', '  unit: { type: command, run: "false" }',
    'asks:', '  deadline: { taste: 3d, authority: 1d, unblock: 2d, exception: 2d, choice: 2d, definition: 4h }',
    '  default: { taste: recommended, authority: "no", unblock: stay-blocked, exception: no-change, choice: recommended, definition: leave-out }',
    '  fallback: [change-owner]', '',
  ].join('\n'));
  const env = { ...childEnv(dir), ...GIT_ENV };
  const git = (...a) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...a], { cwd: dir, env, encoding: 'utf8' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'spec');
}
async function startHub(home, world, log, tmp) {
  const confirm = join(tmp, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const env = childEnv(home, { DEEP_HUB_TEST_CONFIRM: confirm, DEEP_HUB_TEST_SHOW: world, DEEP_SPIKE_3222_LOG: log, NODE_OPTIONS: `--import ${PROBE}` });
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  child.stderr.setEncoding('utf8').on('data', (d) => { out = (out + d).slice(-20_000); });
  const ready = await new Promise((resolve) => {
    let first = '';
    const timer = setTimeout(() => resolve(false), 180_000);
    child.stdout.setEncoding('utf8').on('data', (d) => {
      out = (out + d).slice(-20_000);
      first += d;
      if (first.includes('\n')) { clearTimeout(timer); try { resolve(JSON.parse(first.split('\n')[0]).ready === true); } catch { resolve(false); } }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(false); });
  });
  if (!ready) throw Error(`BLOCKED: the hub didn't start: ${out.slice(0, 2000)}`);
  return { pid: child.pid, home, socket: join(home, '.deepbuild', 'hub.sock') };
}

// ---- The machine and its load.
function machine() {
  const sh = (cmd, args) => { try { return execFileSync(cmd, args, { encoding: 'utf8' }).trim(); } catch { return null; } };
  const core = ['release', 'debug'].map((p) => join(REPO, 'target', p, 'deep-show')).filter((p) => existsSync(p)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  return {
    model: sh('sysctl', ['-n', 'hw.model']) ?? os.machine(), chip: sh('sysctl', ['-n', 'machdep.cpu.brand_string']), cpus: os.cpus().length,
    memory_gb: Math.round(os.totalmem() / 2 ** 30), os: `${os.type()} ${os.release()}${sh('sw_vers', ['-productVersion']) ? ` (macOS ${sh('sw_vers', ['-productVersion'])})` : ''}`,
    node: process.version, canvas_core: core ? (core.includes('/release/') ? 'target/release/deep-show' : 'target/debug/deep-show') : null,
    commit: sh('git', ['-C', REPO, 'rev-parse', 'HEAD']),
  };
}
const loadavg = () => os.loadavg().map((x) => Math.round(x * 100) / 100);

// ---- The calls a session makes.
const kinds2d = (s, doc) => ({
  revision: (w) => s.show({ doc, document: JSON.stringify(figure(w)), t: '0s', size: SIZE_2D, include: ['issues', 'pixels'] }),
  patch: (w) => s.show({ doc, patch: JSON.stringify({ patch: ulid(), doc, base: s.rev[doc] ?? 1, reason: 'a #3222 scripted patch of one value', ops: [{ op: 'set', id: 'bar-build', path: 'items/bar-build/params/box', value: [16, 60, w, 16] }] }), t: '0s', size: SIZE_2D, include: ['issues'] }),
  check: (w) => s.showCheck(doc, figure(w), SIZE_2D),
  render_back_2d: () => s.show({ doc, rev: s.rev[doc] ?? 1, t: '0s', size: SIZE_2D }),
});
const kinds3d = (s, doc) => ({
  revision: (x) => s.show({ doc, document: JSON.stringify(box3d(x)), t: '0s', size: SIZE_3D, include: ['issues', 'pixels'] }),
  render_back_3d: () => s.show({ doc, rev: s.rev[doc] ?? 1, t: '0s', size: SIZE_3D }),
});
/** The rotation each session's rounds start at its own place in: the 3D document's revision comes before its render-back. */
const ROTATION = [['2d', 'patch'], ['2d', 'check'], ['2d', 'render_back_2d'], ['3d', 'revision'], ['3d', 'render_back_3d'], ['2d', 'revision']];
const d2Of = (i) => docId(2 * i + 1);
const d3Of = (i) => docId(2 * i + 2);
const HEAVY_SESSION = (n) => n;

// ---- The command line.
function parse(argv) {
  const o = { patches: false, slow: false, gate: false, plant: null };
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    if (['--patches', '--slow', '--gate'].includes(a)) o[a.slice(2)] = true;
    else if (['--sessions', '--home', '--out', '--plant'].includes(a) && argv[k + 1] !== undefined) o[a.slice(2)] = argv[++k];
    else return null;
  }
  o.sessions = Number(o.sessions);
  if (!Number.isInteger(o.sessions) || o.sessions < 1 || !o.home || !o.out || (o.slow && !o.patches) || (o.plant !== null && o.plant !== 'times-from-core-start')) return null;
  return o;
}
const USAGE = 'Usage: node docs/spikes/3222/harness.mjs --sessions <n> [--patches] [--slow] [--gate] [--plant times-from-core-start] --home <dir> --out <file>\n';

/** The rows of the harness's output: each call its sessions sent, joined in order per document to the probe's marks. */
function rowsOf(sent, log, plant) {
  const marks = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const byId = new Map();
  for (const m of marks) {
    if (m.id === null) continue;
    if (!byId.has(m.id)) byId.set(m.id, { joins: [], lines: [] });
    const c = byId.get(m.id);
    if (m.mark === 'arrive') Object.assign(c, { arrive: m.at, doc: m.doc });
    else if (m.mark === 'join') c.joins.push(m.at);
    else if (m.mark === 'line') c.lines.push(m);
  }
  const arrivals = new Map();
  for (const c of [...byId.values()].filter((x) => x.arrive !== undefined).sort((a, b) => a.arrive - b.arrive)) {
    if (!arrivals.has(c.doc)) arrivals.set(c.doc, []);
    arrivals.get(c.doc).push(c);
  }
  const taken = new Map();
  return sent.map((s) => {
    const k = taken.get(s.doc) ?? 0;
    taken.set(s.doc, k + 1);
    const c = arrivals.get(s.doc)?.[k];
    const main = c?.lines.filter((l) => l.line !== 'world').at(-1);
    if (!c || !main) throw Error(`the probe saw no core line for session ${s.session}'s ${s.kind} call ${k + 1} on doc ${s.doc}: ${JSON.stringify(c ?? null).slice(0, 300)}`);
    const turn = Math.min(...c.lines.map((l) => l.write));
    const world = c.lines.filter((l) => l.line === 'world').reduce((t, l) => t + (l.read - l.write), 0);
    return {
      session: s.session, kind: s.kind, doc: s.doc,
      arrivedMs: plant ? main.write : c.arrive, startedMs: main.write, repliedMs: main.read,
      ...(s.planted ? { planted: true } : {}),
      outcome: s.outcome, code: s.code, held: main.held,
      parts: { hub: c.joins[0] - c.arrive, behind: turn - c.joins[0], world }, sentMs: s.sentMs, answeredMs: s.answeredMs,
    };
  });
}

const o = parse(process.argv.slice(2));
if (!o) { process.stderr.write(USAGE); process.exit(2); }
process.on('SIGTERM', () => { void stopAll().then(() => process.exit(143)); });
process.on('SIGINT', () => { void stopAll().then(() => process.exit(130)); });
const home = o.home.startsWith('/') ? o.home : join(process.cwd(), o.home);
const outFile = o.out.startsWith('/') ? o.out : join(process.cwd(), o.out);
mkdirSync(home, { recursive: true });
mkdirSync(dirname(outFile), { recursive: true });
const log = `${outFile.replace(/\.json$/, '')}.probe.jsonl`;
writeFileSync(log, '');
const tmp = realpathSync(mkdtempSync('/tmp/ds3222-'));
const record = { date: new Date().toISOString(), machine: machine(), load: { start: loadavg() }, calls: [] };
const sent = [];
try {
  const work = join(tmp, 'work');
  makeWorktree(work);
  const n = o.sessions;
  const ids = Array.from({ length: n + (o.slow ? 1 : 0) }, (_, i) => uuidOf(`session-${i}`));
  let world = process.env.DEEP_HUB_TEST_SHOW;
  if (!world) {
    world = join(tmp, 'world.json');
    // A patch reaches only a document the world seeds at revision 0 (#1721): each 2D document is seeded with an empty
    // board (items of its own would sit in no session's layer), and the session's first whole revision is its rev 1.
    const docs = {};
    for (let i = 0; i < n; i++) { docs[d2Of(i)] = { panel: 'main', document: { ...figure(240), items: {} } }; if (!o.patches) docs[d3Of(i)] = { panel: 'main' }; }
    if (o.slow) docs[d3Of(HEAVY_SESSION(n))] = { panel: 'main' };
    writeFileSync(world, JSON.stringify({ names: Object.fromEntries(ids.map((id, i) => [id, `Scripted session ${i}`])), panels: { main: { rect: [0, 0, 800, 600] } }, docs }));
  }
  const hub = await startHub(home, world, log, tmp);
  const sessions = Array.from({ length: n }, (_, i) => new Session(i, home, work));
  const heavySession = o.slow ? new Session(HEAVY_SESSION(n), home, work) : null;
  for (const s of [...sessions, ...(heavySession ? [heavySession] : [])]) await s.establish(hub);
  if (o.gate) {
    process.stdout.write(`${JSON.stringify({ ready: true, hub: hub.pid })}\n`);
    await new Promise((resolve) => { const rl = createInterface({ input: process.stdin }); rl.once('line', () => { rl.close(); resolve(); }); rl.once('close', resolve); });
  }
  /** One call by `s`: sent, answered, and its reply's outcome, kept to be joined to the probe's marks. */
  const call = async (s, kind, doc, send, planted = false) => {
    const sentMs = now();
    let r;
    try { r = await send(); } catch (e) { r = { value: { error: String(e.message ?? e) } }; }
    const v = r.value ?? {};
    if (typeof v.rev === 'number' && v.outcome !== 'refused') s.rev[doc] = v.rev;
    sent.push({ session: s.id, kind, doc, planted, sentMs, answeredMs: now(), outcome: v.outcome ?? (v.error ? 'error' : null), code: v.code ?? v.issues?.find?.((i) => i.severity === 'error')?.code ?? null });
  };
  if (!o.patches) {
    const rounds = Math.max(2, Math.ceil(20 / n));
    await Promise.all(sessions.map(async (s) => {
      const k2 = kinds2d(s, d2Of(s.i));
      const k3 = kinds3d(s, d3Of(s.i));
      await call(s, 'revision', d2Of(s.i), () => k2.revision(240));
      await call(s, 'revision', d3Of(s.i), () => k3.revision(0));
      let seed = s.i * 7919 + 1;
      const gap = () => { seed = (seed * 48271) % 2147483647; return seed % 251; };
      for (let r = 0; r < rounds; r++) {
        for (let k = 0; k < ROTATION.length; k++) {
          const [dim, kind] = ROTATION[(k + s.i) % ROTATION.length];
          const w = 100 + ((r * 6 + k + s.i) % 140);
          await sleep(gap());
          if (dim === '2d') await call(s, kind, d2Of(s.i), () => k2[kind](w));
          else await call(s, kind, d3Of(s.i), () => k3[kind]((w % 30) / 10 - 1.5));
        }
      }
    }));
  } else {
    await Promise.all(sessions.map((s) => call(s, 'revision', d2Of(s.i), () => kinds2d(s, d2Of(s.i)).revision(240))));
    let slowCall;
    if (heavySession) {
      const doc = d3Of(heavySession.i);
      await call(heavySession, 'revision', doc, () => heavySession.show({ doc, document: JSON.stringify(heavy()), t: '0s', size: HEAVY_SIZE, include: ['issues'] }));
      const before = readFileSync(log, 'utf8').length;
      slowCall = call(heavySession, 'render_back_3d', doc, () => heavySession.show({ doc, rev: heavySession.rev[doc] ?? 1, t: '0s', size: HEAVY_SIZE }), true);
      const deadline = Date.now() + 600_000;
      while (!readFileSync(log, 'utf8').slice(before).split('\n').some((l) => l.includes('"mark":"write"') && l.includes('"line":"render_back"'))) {
        if (Date.now() > deadline) throw Error('BLOCKED: the slow call never reached the canvas core');
        await sleep(2);
      }
    }
    await Promise.all(sessions.map((s) => call(s, 'patch', d2Of(s.i), () => kinds2d(s, d2Of(s.i)).patch(120 + s.i))));
    await slowCall;
  }
  for (const s of [...sessions, ...(heavySession ? [heavySession] : [])]) s.close();
  record.calls = rowsOf(sent, log, o.plant === 'times-from-core-start');
} finally {
  record.load.end = loadavg();
  await stopAll();
  rmSync(tmp, { recursive: true, force: true });
}
writeFileSync(outFile, `${JSON.stringify(record, null, 1)}\n`);
