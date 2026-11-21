// Forced-failure proof for #2954. Each case copies one #56 test file and injects, at one
// point of one test, a hold that is surely in flight: a second hub of the same variant on a virtual clock
// (so its 2 s hold timeout never fires) holds a hanging check with two grandchildren. Once its two
// grandchildren run, the test fails (or, for a timeout case, hangs until its cut timeout). The copy
// prints the run's marker and the PIDs the check log records for the forced hold, read from the file
// directly so the test's own record reader never sees them.
// Usage: node docs/evidence/2954/forced.mjs <suite dir, e.g. .../tests/acceptance/56> <label> <out dir> [case ...]
// After each run exits, the processes carrying the copy's markers, and the recorded forced PIDs whatever
// `ps` shows for them, are counted at +3 s and +10 s, then stopped by PID.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [suite, label, out, ...only] = process.argv.slice(2);
if (!suite || !label || !out) throw Error('usage: node docs/evidence/2954/forced.mjs <suite dir> <label> <out dir> [case ...]');
const helpers = pathToFileURL(join(suite, 'helpers.mjs')).href;
const copies = join(out, 'copies', label);
mkdirSync(copies, { recursive: true });

const inject = (end) => `
    console.log(\`FORCED run marker \${fx.run}\`);
    const __vhub = await __startHub(t, { variant, state: __join(fx.directory, 'forced-hub'), ports: await __freePorts(), extensionLog: fx.extensionLog, virtual: true });
    const __forced = __holdCheck(__vhub.socket, fx.check('forced', ['hang'], 2));
    await __waitFor(() => __living(__forced.marker).length >= 2, 120_000, 'the forced hold\\'s two grandchildren to run');
    {
      let __text = '';
      try { __text = __read(fx.log, 'utf8'); } catch {}
      const __pids = __text.split('\\n').filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return {}; } })
        .filter((line) => line.key === __forced.key && ['start', 'grandchild'].includes(line.event)).map((line) => line.pid);
      console.log(\`FORCED pids \${__pids.join(',')} of run marker \${fx.run}\`);
    }
    ${end}`;
const FAIL = 'assert.fail(`FORCED failure with holds in flight, run marker ${fx.run}`);';
const HANG = 'console.log(`FORCED hang until the test times out, run marker ${fx.run}`);\n    await new Promise(() => {});';

const CASES = {
  'processes-fail': { file: 'processes.test.mjs', anchor: "const failing = holdCheck(hub.socket, fx.check('s1', ['fail'], 1));", end: FAIL, pattern: 'a check that passes or fails' },
  'timeouts-fail': { file: 'timeouts.test.mjs', anchor: "const slow = holdCheck(hub.socket, fx.check('slow', ['pass:3500']));", end: FAIL, pattern: 'on the real clock' },
  'typecheck-fail': { file: 'typecheck.test.mjs', anchor: "const handle = hold(hub.socket, { id: 'missing-binary', session: 's0', argv: [missing] });", end: FAIL, pattern: 'a failure inside the slice' },
  // leases never starts a second hub, so its forced failure is its own hold-due check made false (as for
  // #2804): it fails at the first acknowledgement with 50 holds in flight on the test's own hub.
  'leases-fail': { file: 'leases.test.mjs', replace: ['assert.ok(due >= HOLD_MS - 100 && due <= HOLD_MS + 250,', 'console.log(`FORCED run marker ${fx.run}`); assert.ok(due < 0,'], pattern: '50 sessions holding hooks' },
  // A forced timeout: the plain passes-or-fails test with its timeout cut to 150 s, hanging once the forced hold runs.
  'processes-timeout': { file: 'processes.test.mjs', anchor: "const failing = holdCheck(hub.socket, fx.check('s1', ['fail'], 1));", end: HANG, pattern: '\\[plain\\] a check that passes or fails', timeoutLine: ['a check that passes or fails leaves', 'timeout: 90_000', 'timeout: 150_000'] },
};

function copyOf(name, spec) {
  let text = readFileSync(join(suite, spec.file), 'utf8');
  if (!text.includes("from './helpers.mjs';")) throw Error(`${name}: no import of ./helpers.mjs`);
  text = text.replace("from './helpers.mjs';", `from '${helpers}';\nimport { freePorts as __freePorts, holdCheck as __holdCheck, living as __living, startHub as __startHub, waitFor as __waitFor } from '${helpers}';\nimport { readFileSync as __read } from 'node:fs';\nimport { join as __join } from 'node:path';`);
  if (spec.replace) {
    if (text.split(spec.replace[0]).length !== 2) throw Error(`${name}: the line to replace isn't there exactly once`);
    text = text.replace(spec.replace[0], spec.replace[1]);
  } else {
    const at = text.indexOf(spec.anchor);
    if (at < 0) throw Error(`${name}: anchor not found: ${spec.anchor}`);
    text = text.slice(0, at + spec.anchor.length) + inject(spec.end) + text.slice(at + spec.anchor.length);
  }
  if (spec.timeoutLine) {
    const [has, from, to] = spec.timeoutLine;
    const lines = text.split('\n');
    const index = lines.findIndex((line) => line.includes(has) && line.includes(from));
    if (index < 0) throw Error(`${name}: timeout line not found`);
    lines[index] = lines[index].replace(from, to);
    text = lines.join('\n');
  }
  const path = join(copies, `zz-forced-${name}.test.mjs`);
  writeFileSync(path, text);
  return path;
}

const table = () => spawnSync('ps', ['-axww', '-o', 'pid=,stat=,command='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout
  .split('\n').map((line) => line.trim().match(/^(\d+)\s+(\S+)\s+(.*)$/)).filter(Boolean)
  .filter(([, , stat]) => !stat.startsWith('Z')).map(([, pid, , command]) => ({ pid: Number(pid), command }));
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

async function run(name, spec) {
  const path = copyOf(name, spec);
  const log = join(out, `${label}-${name}.log`);
  const before = new Set(table().filter(({ command }) => command.includes('ds56m.')).map(({ pid }) => pid));
  const load = loadavg().map((value) => value.toFixed(1)).join(' ');
  const args = ['--test', '--test-concurrency=1', '--test-reporter=spec', `--test-name-pattern=${spec.pattern}`, path];
  const started = Date.now();
  const child = spawn(process.execPath, args, { cwd: join(suite, '../../..'), detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  let firstFailAt;
  const take = (chunk) => {
    output += chunk;
    if (firstFailAt === undefined && /✖/.test(chunk.toString())) firstFailAt = Date.now();
  };
  child.stdout.on('data', take);
  child.stderr.on('data', take);
  const LIMIT = 420_000;
  let killed = false;
  const timer = setTimeout(() => { killed = true; try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, LIMIT);
  const exit = await new Promise((done) => child.once('exit', (code, signal) => done(code ?? signal)));
  clearTimeout(timer);
  const exitedAt = Date.now();
  const markers = [...new Set([...output.matchAll(/run marker (ds56m\.[0-9a-f]+\.)/g)].map(([, marker]) => marker))];
  const pids = [...new Set([...output.matchAll(/FORCED pids ([\d,]*) of run marker/g)].flatMap(([, list]) => list.split(',').filter(Boolean).map(Number)))];
  const left = () => table().filter(({ pid, command }) => pids.includes(pid) || markers.some((marker) => command.includes(marker)));
  await pause(3000);
  const at3 = left();
  const fresh3 = table().filter(({ pid, command }) => command.includes('ds56m.') && !before.has(pid));
  await pause(7000);
  const at10 = left();
  // Stop what this run left, by PID, so the next case starts clean.
  for (const { pid } of left()) try { process.kill(pid, 'SIGKILL'); } catch {}
  const summary = /ℹ tests (\d+)[\s\S]*?ℹ pass (\d+)[\s\S]*?ℹ fail (\d+)[\s\S]*?ℹ cancelled (\d+)/.exec(output);
  const forcedRan = (output.match(/FORCED pids \d/g) ?? []).length;
  const line = `${label} ${name} | load ${load} | exit ${killed ? `KILLED at ${LIMIT / 1000} s (HUNG)` : exit} after ${((exitedAt - started) / 1000).toFixed(1)} s` +
    `${firstFailAt ? `, ${((exitedAt - firstFailAt) / 1000).toFixed(1)} s after the first ✖` : ''}` +
    ` | ${summary ? `tests ${summary[1]} pass ${summary[2]} fail ${summary[3]} cancelled ${summary[4]}` : 'no summary'}` +
    ` | forced holds running at the failure: ${forcedRan} | marked or recorded processes left: ${at3.length} at +3 s, ${at10.length} at +10 s | any new ds56m. at +3 s: ${fresh3.length}`;
  const list = (rows) => rows.map(({ pid, command }) => `${pid} ${command.slice(0, 200)}`).join('\n');
  writeFileSync(log, `${line}\n\n$ node ${args.join(' ')}\n\n${output}\n\nmarkers: ${markers.join(' ')}\nforced pids: ${pids.join(' ')}\nleft at +3 s:\n${list(at3)}\nleft at +10 s:\n${list(at10)}\nany new ds56m. at +3 s:\n${list(fresh3)}\n`);
  console.log(line);
}

for (const [name, spec] of Object.entries(CASES)) {
  if (only.length && !only.includes(name)) continue;
  await run(name, spec);
}
