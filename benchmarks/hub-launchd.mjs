import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomFillSync } from 'node:crypto';
import { chmodSync, closeSync, copyFileSync, fsyncSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import net from 'node:net';
import { homedir, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { onPath, underTemp } from '../packages/hub/dist/paths.js';
import { PROCESS_TYPE } from '../packages/hub/dist/service.js';
import { fingerprint, judgeLimit, references } from '../scripts/benchmark.mjs';

const SELF = fileURLToPath(import.meta.url);
const REPO = fileURLToPath(new URL('../', import.meta.url));
const CLI = join(REPO, 'packages/cli/dist/main.js');
const INSTALLED = 'com.deepbuild.hub';
const DOMAIN = `gui/${process.getuid?.()}`;
const ASK = { kind: 'unblock', what: 'Run the budget window from a home outside every temp folder: a home under one gets no login service (#2203), so no hub launchd started can be read here.' };
const KINDS = { hook_overhead_p95_ms: 'limit', idle_cpu_percent: 'limit', round_trip_p50_ratio: 'sides', record_append_p50_ratio: 'sides', spin_ratio: 'pairs', write_sync_ratio: 'pairs' };
const SPIN_MS = 5000;
const CHUNK = 50_000_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rank = (values, share) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * share) - 1];
const p50 = (values) => rank(values, 0.5);
const launchctl = (...args) => spawnSync('launchctl', args, { encoding: 'utf8' });
const ps = (field, pid) => execFileSync('ps', ['-o', `${field}=`, '-p', String(pid)], { encoding: 'utf8' }).trim();
const cpuMs = () => { const { user, system } = process.cpuUsage(); return (user + system) / 1000; };

function exchange(socket, request) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(socket);
    let buffer = '', sent = 0;
    sock.setEncoding('utf8');
    sock.on('error', reject);
    sock.on('data', (chunk) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = JSON.parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (line.hello && request) {
          sent = performance.now();
          sock.write(`${JSON.stringify(request)}\n`);
        } else if ('exit' in line || 'error' in line || !request) {
          sock.destroy();
          resolve(performance.now() - sent);
        }
      }
    });
  });
}
function hookRequest(home, i) {
  const session = '6f1c2b9e-1111-4222-8333-444455556666';
  const payload = { session_id: session, transcript_path: join(home, '.claude', 'projects', 'work', `${session}.jsonl`), cwd: join(home, 'work'), hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: `ls src/${i}` }, tool_use_id: `call_${i}` };
  return { v: 1, agent: 'claude-code', event: 'PreToolUse', seq: `${1_760_013_451_000_000_000n + BigInt(i)}`, id: `01K74FKZVK8Q2X5R7M${String(i).padStart(8, '0')}`, pid: process.pid, ppid: process.ppid, matched: [], payload };
}
function asApp(hub) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(hub.socket), waiting = new Map(), ended = new Map();
    connections.push(sock);
    let buffer = '', n = 0;
    const app = {
      call: (method, params) => new Promise((done) => { waiting.set(`b${++n}`, done); sock.write(`${JSON.stringify({ v: 1, id: `b${n}`, method, params })}\n`); }),
      finished: (run) => new Promise((done) => (ended.has(run) ? done(ended.get(run)) : waiting.set(run, done))),
    };
    sock.setEncoding('utf8');
    sock.on('error', reject);
    sock.on('data', (chunk) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = JSON.parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (line.hello) sock.write(`${JSON.stringify({ v: 1, hello: 'app', token: readFileSync(join(hub.home, '.deepbuild', 'control.token'), 'utf8').trim() })}\n`);
        else if (line.role) resolve(app);
        else if (line.event?.kind === 'run.finished') { ended.set(line.event.subject, line.event); waiting.get(line.event.subject)?.(line.event); }
        else if (waiting.has(line.id)) { waiting.get(line.id)(line); waiting.delete(line.id); }
      }
    });
  });
}

const loaded = [], children = [], connections = [], pids = [];
function remove() {
  for (const sock of connections) sock.destroy();
  for (const label of loaded.splice(0)) launchctl('bootout', `${DOMAIN}/${label}`);
  for (const child of children) child.kill('SIGTERM');
}
const alive = (pid) => { try { return process.kill(pid, 0); } catch { return false; } };
function sweep() {
  for (const [, label, pid] of launchctl('print', DOMAIN).stdout?.matchAll(/(com\.deepbuild\.hub\.budget\.(\d+)\.\w+)/g) ?? []) if (!alive(Number(pid))) launchctl('bootout', `${DOMAIN}/${label}`);
}
async function ended() {
  for (const from = performance.now(); pids.some(alive) && performance.now() - from < 10_000;) await sleep(50);
}
function found(hub, pid) {
  pids.push(pid);
  const ppid = Number(ps('ppid', pid));
  return { ...hub, socket: join(hub.home, '.deepbuild', 'hub.sock'), pid, ppid, parent: ps('comm', ppid) };
}
function loadedHub(dir, name, type, seed) {
  const home = join(dir, name), label = `${INSTALLED}.budget.${process.pid}.${name}`;
  mkdirSync(join(home, 'work'), { recursive: true });
  seed?.(home);
  loaded.push(label);
  const started = spawnSync(process.execPath, [CLI, 'hub', 'start'], { encoding: 'utf8', env: { ...process.env, HOME: home, DEEP_HUB_LAUNCHER: join(dir, 'load'), DEEP_BENCH_LABEL: label, DEEP_BENCH_TYPE: type === undefined ? '' : type ?? 'absent' } });
  const pid = Number(/^\s*pid = (\d+)$/m.exec(launchctl('print', `${DOMAIN}/${label}`).stdout)?.[1]);
  if (started.status !== 0 || !pid) throw Error(`no hub launchd started under ${label} answered: ${`${started.stderr}${started.stdout}`.trim().slice(-600)}`);
  return found({ label, process_type: type === undefined ? PROCESS_TYPE : type, home }, pid);
}
async function childHub(dir, name, seed) {
  const home = join(dir, name);
  mkdirSync(join(home, 'work'), { recursive: true });
  seed?.(home);
  const child = spawn(process.execPath, [CLI, 'hub', 'run'], { env: { ...process.env, HOME: home, DEEP_HUB_PLANT: '' }, stdio: 'ignore' });
  children.push(child);
  const hub = { label: null, process_type: null, home, socket: join(home, '.deepbuild', 'hub.sock') };
  for (const from = performance.now(); ; await sleep(5)) {
    try {
      await exchange(hub.socket);
      return found(hub, child.pid);
    } catch (error) {
      if (child.exitCode !== null || performance.now() - from > 60_000) throw Error(`the hub started as a child did not answer: ${error.message}`);
    }
  }
}

let sent = 0, runs = 0;
async function roundTrip(hub) {
  const from = performance.now();
  for (let i = 0; i < 1000; i++) await exchange(hub.socket, hookRequest(hub.home, sent++));
  return performance.now() - from;
}
async function started(hub, argv) {
  hub.app ??= await asApp(hub).then(async (app) => { await app.call('stream.subscribe', { after: 0 }); return app; });
  const from = performance.now();
  const reply = await hub.app.call('run.start', { check: 'budget', claim: `claim:B${process.pid}N${++runs}`, commit: '0'.repeat(40), argv, cwd: join(hub.home, 'work') });
  if (reply.error) throw Error(`run.start on ${hub.label ?? 'the child-started hub'}: ${JSON.stringify(reply.error)}`);
  const { data } = await hub.app.finished(reply.result.run);
  if (data.outcome !== 'passed') throw Error(`${argv.slice(1, 3).join(' ')}, started by ${hub.label ?? 'the child-started hub'}, ended ${data.outcome}: ${data.findings.join('; ')}`);
  return performance.now() - from;
}
async function sides(hubs, sample) {
  for (const hub of Object.values(hubs)) await sample(hub);
  const out = { launchd: [], child: [], first: [], loads: [] };
  for (let round = 0; round < 20; round++) {
    const order = round % 2 ? ['child', 'launchd'] : ['launchd', 'child'], start = loadavg()[0];
    for (const side of order) out[side].push(await sample(hubs[side]));
    out.first.push(order[0]);
    out.loads.push({ start, end: loadavg()[0] });
  }
  return out;
}
async function five(read) {
  await read();
  const out = { runs: [], loads: [] };
  for (let i = 0; i < 5; i++) {
    const start = loadavg()[0];
    out.runs.push(await read());
    out.loads.push({ start, end: loadavg()[0] });
  }
  return out;
}
const cpuOf = (hub) => ps('time', hub.pid).split(/[:.]/).map(Number).reduce((sum, part, i, all) => (i === all.length - 1 ? sum + part / 100 : sum * 60 + part), 0);
function overhead(hub) {
  const out = join(hub.home, 'hyperfine.json');
  execFileSync('hyperfine', ['-N', '--runs', '1000', '--warmup', '20', '--input', join(hub.home, 'call.json'), '--export-json', out, join(REPO, 'target/release/deep-hook-floor'), `${join(REPO, 'target/release/deep-hook')} claude-code PreToolUse`], { cwd: join(hub.home, 'work'), env: { ...process.env, HOME: hub.home }, stdio: 'ignore' });
  const { results } = JSON.parse(readFileSync(out, 'utf8'));
  if (!results.every(({ times }) => Array.isArray(times))) throw Error('BLOCKED: hyperfine exported no times; install hyperfine 1.x');
  const [floor, hook] = results.map(({ times }) => rank(times, 0.95) * 1000);
  return hook - floor;
}
function guarded(home) {
  mkdirSync(join(home, '.deepbuild'), { recursive: true });
  copyFileSync(join(REPO, 'crates/deep-hook/default-rules.json'), join(home, '.deepbuild', 'rules.json'));
  const session = '6f1c2b9e-1111-4222-8333-444455556666';
  writeFileSync(join(home, 'call.json'), JSON.stringify({ session_id: session, transcript_path: join(home, '.claude', 'projects', 'work', `${session}.jsonl`), cwd: join(home, 'work'), hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'toolu_bench' }));
}
function spin(iterations) {
  let x = 0;
  for (let i = 0; i < iterations; i++) x = (Math.imul(x, 31) + i) | 0;
  return x;
}
async function commands(hubs, dir) {
  execFileSync(process.execPath, [SELF, 'spin', 'size', join(dir, 'size')]);
  const kinds = { spin_ratio: ['spin', readFileSync(join(dir, 'size'), 'utf8')], write_sync_ratio: ['write'] };
  const out = Object.fromEntries(Object.keys(kinds).map((target) => [target, Object.fromEntries(Object.keys(hubs).map((name) => [name, { hub: [], terminal: [], first: [], loads: [] }]))]));
  let n = 0;
  const time = async (hub, args) => {
    const took = join(dir, `took-${++n}`), argv = [process.execPath, SELF, ...args, took];
    if (hub) await started(hub, argv);
    else execFileSync(argv[0], argv.slice(1));
    return Number(readFileSync(took, 'utf8'));
  };
  for (let pair = 0; pair < 10; pair++) {
    const first = pair % 2 ? 'terminal' : 'hub', order = first === 'hub' ? ['chosen', 'background', 'terminal'] : ['terminal', 'chosen', 'background'];
    for (const [target, args] of Object.entries(kinds)) {
      const start = loadavg()[0], ms = {}, beside = target === 'spin_ratio' && time(hubs.background, args);
      if (beside) beside.catch(() => undefined);
      for (const who of order.filter((who) => !(beside && who === 'background'))) ms[who] = await time(hubs[who], args);
      if (beside) ms.background = await beside;
      for (const [name, ten] of Object.entries(out[target])) {
        ten.hub.push(ms[name]);
        ten.terminal.push(ms.terminal);
        ten.first.push(first);
        ten.loads.push({ start, end: loadavg()[0] });
      }
    }
  }
  return out;
}

const MODES = {
  'round-trip': { beside: ['child'], read: async (hubs) => ({ round_trip_p50_ratio: await sides(hubs, roundTrip) }) },
  'record-append': { beside: ['child'], read: async (hubs) => ({ record_append_p50_ratio: await sides(hubs, (hub) => started(hub, [process.execPath, join(REPO, 'benchmarks/record.mjs'), 'append-20k'])) }) },
  'hook-overhead': {
    seed: guarded,
    read: async ({ launchd }) => {
      execFileSync('cargo', ['build', '--locked', '-q', '--release', '-p', 'deep-hook'], { cwd: REPO, stdio: ['ignore', 2, 2] });
      return { hook_overhead_p95_ms: await five(() => overhead(launchd)) };
    },
  },
  idle: {
    read: async ({ launchd }) => {
      await sleep(15_000);
      return { idle_cpu_percent: await five(async () => { const before = cpuOf(launchd); await sleep(5000); return ((cpuOf(launchd) - before) / 5) * 100; }) };
    },
  },
  commands: { beside: ['background'], read: ({ launchd, background }, dir) => commands({ chosen: launchd, background }, dir) },
};

const times = (values, count) => Array.isArray(values) && values.length === count && values.every((value) => Number.isFinite(value) && value > 0);
const turns = (first, count, sides) => Array.isArray(first) && first.length === count && first.every((side, i) => sides.includes(side) && side !== first[i - 1]);
function reading(machine, loads, count) {
  if (!Array.isArray(loads) || loads.length !== count || loads.some((load) => ![load?.start, load?.end].every((value) => Number.isFinite(value) && value >= 0))) return { status: 'BLOCKED', reason: `the load at the start and end of each of its ${count} readings is missing` };
  const on = judgeLimit({ limit: 1, runs: [1, 1, 1, 1, 1], fingerprint: machine, loads: Array(5).fill({ start: 0, end: 0 }) });
  if (on.status !== 'PASS') return { status: 'INCONCLUSIVE', reason: on.reason };
  const { cores, name } = references.find(({ model }) => model === machine.model), high = Math.max(...loads.flatMap(({ start, end }) => [start, end]));
  return high < cores ? undefined : { status: 'INCONCLUSIVE', reason: `a reading, not a budget result: the load reached ${high} on the ${cores} cores of ${name}` };
}
function notLaunchds(hub, type, what) {
  if (!hub) return { status: 'BLOCKED', reason: `the report names no ${what}` };
  if (!Number.isInteger(hub.ppid) || typeof hub.parent !== 'string') return { status: 'BLOCKED', reason: `the parent process of the ${what} was never read` };
  if (hub.ppid !== 1) return { status: 'FAIL', reason: `the ${what}, process ${hub.pid}, is a child of process ${hub.ppid} (${hub.parent}), where launchd, process 1, was to start it` };
  if (hub.label === INSTALLED) return { status: 'BLOCKED', reason: `the ${what} was read under ${INSTALLED}, the installed hub's label` };
  return hub.process_type === type ? undefined : { status: 'BLOCKED', reason: `the ${what} was loaded with ${hub.process_type ? `ProcessType ${hub.process_type}` : 'no ProcessType'}, where ${type} was to be read` };
}
const JUDGES = {
  limit(limit, read, machine) {
    const judged = judgeLimit({ limit, runs: read?.runs, fingerprint: machine, loads: Array(5).fill({ start: 0, end: 0 }) });
    return (['PASS', 'FAIL'].includes(judged.status) ? reading(machine, read.loads, 5) : undefined) ?? { reason: `five readings within ${limit}`, ...judged };
  },
  sides(limit, read, machine) {
    if (!times(read?.launchd, 20) || !times(read.child, 20) || !turns(read.first, 20, ['launchd', 'child'])) return { status: 'BLOCKED', reason: '20 samples a side in alternated rounds were to be read' };
    const ratio = p50(read.launchd) / p50(read.child);
    return reading(machine, read.loads, 20) ?? { status: ratio <= limit ? 'PASS' : 'FAIL', reason: `the launchd-started hub's p50 is ${ratio.toFixed(2)} times the child-started hub's`, ratio };
  },
  pairs(limit, read, machine, target) {
    const ratio = {};
    for (const [side, said] of [['chosen', "the build's type"], ['background', 'the type planted as Background']]) {
      const { hub, terminal, first, loads } = read?.[side] ?? {};
      if (!times(hub, 10) || !times(terminal, 10) || !turns(first, 10, ['hub', 'terminal'])) return { status: 'BLOCKED', reason: `10 alternated pairs with ${said} were to be read` };
      if (target === 'spin_ratio' && p50(terminal) < SPIN_MS) return { status: 'BLOCKED', reason: `the spin took ${Math.round(p50(terminal))} ms from a terminal, which is no core spun for ${SPIN_MS / 1000} s` };
      const off = reading(machine, loads, 10);
      if (off) return off;
      ratio[side] = p50(hub.map((ms, i) => ms / terminal[i]));
    }
    const said = `${ratio.chosen.toFixed(2)} times the terminal's, and ${ratio.background.toFixed(2)} times with the type planted as Background`;
    if (ratio.chosen > limit) return { status: 'FAIL', reason: said, ratio };
    return ratio.background > limit ? { status: 'PASS', reason: said, ratio } : { status: 'INCONCLUSIVE', reason: `${said}, within ${limit} times as well: this Mac doesn't tell the limits apart`, ratio };
  },
};
function judge(current) {
  const targets = JSON.parse(readFileSync(new URL('./budgets.json', import.meta.url), 'utf8')).tasks.find(({ id }) => id === current?.task)?.targets;
  if (!targets) return { status: 'BLOCKED', reason: 'no report of a task that reads a hub launchd started', targets: {}, asks: [] };
  const { hub, machine, readings = {}, asks = [] } = current;
  if (!hub) return { status: 'BLOCKED', reason: asks.map(({ what }) => what).join('; ') || 'the report names no hub launchd started', targets: {}, asks };
  const paired = Object.keys(targets).some((name) => KINDS[name] === 'pairs');
  const wrong = notLaunchds(hub, PROCESS_TYPE, 'hub') ?? (paired ? notLaunchds(current.background_hub, 'Background', 'hub loaded as Background') : undefined);
  if (wrong) return { ...wrong, targets: {}, asks: [] };
  const judged = Object.fromEntries(Object.entries(targets).map(([name, limit]) => [name, { limit, ...JUDGES[KINDS[name]](limit, readings[name], machine, name) }]));
  const status = ['FAIL', 'BLOCKED', 'INCONCLUSIVE'].find((state) => Object.values(judged).some((target) => target.status === state)) ?? 'PASS';
  return { status, reason: Object.entries(judged).map(([name, { reason }]) => `${name}: ${reason}`).join('; '), targets: judged, asks: [] };
}

const [mode, ...rest] = process.argv.slice(2);
if (mode === 'judge') {
  let verdict;
  try {
    verdict = judge(JSON.parse(readFileSync(0, 'utf8'))?.current);
  } catch (error) {
    verdict = { status: 'BLOCKED', reason: `no report could be judged: ${error.message}`, targets: {}, asks: [] };
  }
  console.log(JSON.stringify(verdict));
} else if (mode === 'load') {
  const { DEEP_BENCH_LABEL: label, DEEP_BENCH_TYPE: type } = process.env;
  if (launchctl('print', `${DOMAIN}/${label}`).status !== 0) {
    let text = readFileSync(rest[0], 'utf8').replace(`<string>${INSTALLED}</string>`, `<string>${label}</string>`);
    if (type) text = text.replace(/\n *<key>ProcessType<\/key>\s*<string>[^<]*<\/string>/, type === 'absent' ? '' : `\n  <key>ProcessType</key>\n  <string>${type}</string>`);
    const own = join(dirname(rest[0]), `${label}.plist`);
    writeFileSync(own, text);
    const loading = launchctl('bootstrap', DOMAIN, own);
    process.stderr.write(loading.stderr ?? '');
    process.exitCode = loading.status ?? 1;
  }
} else if (mode === 'spin') {
  const from = performance.now();
  let done = 0;
  if (rest[0] === 'size') for (spin(CHUNK); cpuMs() < SPIN_MS * 1.05; done += CHUNK) spin(CHUNK);
  else for (let left = Number(rest[0]); left > 0; left -= CHUNK) spin(Math.min(CHUNK, left));
  writeFileSync(rest[1], String(done || performance.now() - from));
} else if (mode === 'write') {
  const block = randomFillSync(Buffer.alloc(2 ** 20)), from = performance.now(), file = openSync(`${rest[0]}.bin`, 'w', 0o600);
  for (let i = 0; i < 256; i++) writeSync(file, block);
  fsyncSync(file);
  closeSync(file);
  writeFileSync(rest[0], String(performance.now() - from));
  rmSync(`${rest[0]}.bin`);
} else if (MODES[mode] && (!rest.length || rest.join() === 'absent')) {
  const say = (report) => console.log(JSON.stringify({ task: `hub-launchd-${mode}`, machine: fingerprint(), ...report, asks: report.hub ? [] : [ASK] }));
  const row = ({ label, process_type, pid, ppid, parent }) => ({ label, process_type, pid, ppid, parent });
  if (process.platform !== 'darwin') throw Error(`BLOCKED: launchd starts the hub on macOS, and this is ${process.platform}`);
  if (underTemp(homedir()) && !underTemp(onPath('launchctl') ?? '')) say({ hub: null, readings: {} });
  else {
    const dir = realpathSync(mkdtempSync('/tmp/deep-hub-launchd-')), { beside = [], seed, read } = MODES[mode];
    const stop = async (why) => { console.error(why); remove(); await ended(); rmSync(dir, { recursive: true, force: true }); process.exit(1); };
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, () => stop(`stopped by ${signal}`));
    const late = setTimeout(() => stop('INCONCLUSIVE: the run reached 270 s, short of the 300 s a budget run gets, on a machine too slow or too loaded for its samples'), 270_000);
    writeFileSync(join(dir, 'load'), `#!/bin/sh\nexec '${process.execPath}' '${SELF}' load "$1"\n`);
    chmodSync(join(dir, 'load'), 0o755);
    try {
      sweep();
      const launchd = process.env.DEEP_HUB_PLANT === 'child-as-launchd' ? { ...(await childHub(dir, 'launchd', seed)), label: `${INSTALLED}.budget.${process.pid}.launchd`, process_type: PROCESS_TYPE } : loadedHub(dir, 'launchd', rest.length ? null : undefined, seed);
      if (launchd.ppid !== 1) say({ hub: row(launchd), readings: {} });
      else {
        const hubs = { launchd };
        for (const name of beside) hubs[name] = name === 'child' ? await childHub(dir, name, seed) : loadedHub(dir, name, 'Background', seed);
        const readings = await read(hubs, dir);
        say({ hub: row(launchd), ...(hubs.background ? { background_hub: row(hubs.background) } : {}), readings });
      }
    } finally {
      clearTimeout(late);
      remove();
      await ended();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    }
  }
} else {
  console.error(`usage: node benchmarks/hub-launchd.mjs <${Object.keys(MODES).join('|')}> [absent], or judge`);
  process.exitCode = 2;
}
