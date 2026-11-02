// A stand-in for launchd and its `launchctl`, the boundary these tests don't own (README: The login service). It
// keeps which jobs are loaded in a state folder of the test's own, and starts and stops a loaded job's program the
// way launchd would, so `deep setup` really starts the hub through its login service and `deep setup --undo` really
// has to unload it. It never reaches the real launchd: `<bin>/launchctl` runs this script, first on PATH.
//
//   node launchd.mjs <state folder> <launchctl arguments…>
//
// launchctl as setup and undo may call it:
//   bootstrap <domain> <plist>…      loads each job; starts its program when RunAtLoad is true. Already loaded: exit 5.
//   load [-w] [-F] <plist>…          the same (the legacy spelling)
//   bootout <domain>/<label>         unloads the job, stopping its program (SIGTERM, then SIGKILL after 10 s)
//   bootout <domain> <plist>…        the same, by the plist's Label. Not loaded: exit 3.
//   unload [-w] <plist>…             the same (legacy)
//   remove <label>                   the same (legacy)
//   kickstart [-k] [-p] <domain>/<label>   starts the job's program again (-k stops a running one first). Not loaded: exit 113.
//   print <domain>/<label>           the job's state and pid; not loaded: exit 113
//   list [<label>]                   the loaded jobs, or one; not loaded: exit 113
//   enable | disable <domain>/<label>, and anything else: exit 0
// Test-only, never called by setup:
//   __relogin <LaunchAgents folder>  a logout and a new login: every loaded job is stopped and unloaded, then every
//                                    plist in the folder is loaded as launchd loads them at login. Prints the labels.
//   __state                          the loaded jobs as JSON: [{label, plist, pid, program}]
//
// A job's program runs detached, with this process's environment (the environment of whoever called launchctl,
// in these tests `deep setup`'s, so a test seam set on setup reaches the hub) and the plist's EnvironmentVariables
// over it, its output appended to StandardOutPath. Every PID it starts is written to the state folder, so the test
// stops it by PID.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [, , STATE, command, ...rest] = process.argv;
mkdirSync(STATE, { recursive: true });

const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
/** What launchd reads of an XML plist: Label, ProgramArguments (or Program), EnvironmentVariables, RunAtLoad, StandardOutPath. */
function readPlist(file) {
  const text = readFileSync(file, 'utf8');
  const value = (key) => new RegExp(`<key>${key}</key>\\s*<string>([\\s\\S]*?)</string>`).exec(text)?.[1];
  const label = value('Label');
  if (label === undefined) throw Error(`${file} has no Label`);
  const args = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(text)?.[1];
  const program = args ? [...args.matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => unxml(m[1])) : (value('Program') ? [unxml(value('Program'))] : []);
  const envBlock = /<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/.exec(text)?.[1] ?? '';
  const env = Object.fromEntries([...envBlock.matchAll(/<key>([\s\S]*?)<\/key>\s*<string>([\s\S]*?)<\/string>/g)].map((m) => [unxml(m[1]), unxml(m[2])]));
  const runAtLoad = /<key>RunAtLoad<\/key>\s*<true\s*\/>/.test(text);
  const out = value('StandardOutPath');
  const err = value('StandardErrorPath');
  return { label: unxml(label), plist: resolve(file), program, env, runAtLoad, out: out && unxml(out), err: err && unxml(err) };
}

const jobFile = (label) => join(STATE, `${label.replace(/[^A-Za-z0-9._-]/g, '_')}.json`);
const loaded = () => readdirSync(STATE).filter((n) => n.endsWith('.json')).map((n) => JSON.parse(readFileSync(join(STATE, n), 'utf8')));
const find = (label) => (existsSync(jobFile(label)) ? JSON.parse(readFileSync(jobFile(label), 'utf8')) : undefined);
const save = (job) => writeFileSync(jobFile(job.label), JSON.stringify(job));
const alive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
// Every PID this stand-in ever started, so the test can stop each one by PID even after its job is gone.
const started = (pid) => writeFileSync(join(STATE, 'started.pids'), `${pid}\n`, { flag: 'a' });

function startJob(job) {
  if (!job.program.length) return job;
  const open = (path) => { if (!path) return 'ignore'; try { mkdirSync(resolve(path, '..'), { recursive: true }); return openSync(path, 'a'); } catch { return 'ignore'; } };
  const child = spawn(job.program[0], job.program.slice(1), { env: { ...process.env, ...job.env }, detached: true, stdio: ['ignore', open(job.out), open(job.err ?? job.out)] });
  child.on('error', () => undefined);
  child.unref();
  if (child.pid) started(child.pid);
  return { ...job, pid: child.pid ?? null };
}
async function stopJob(job) {
  if (!alive(job.pid)) return;
  try { process.kill(job.pid, 'SIGTERM'); } catch { return; }
  const deadline = Date.now() + 10_000;
  while (alive(job.pid) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  if (alive(job.pid)) try { process.kill(job.pid, 'SIGKILL'); } catch { /* gone */ }
}
function load(file) {
  const job = readPlist(file);
  if (find(job.label)) {
    process.stderr.write(`Bootstrap failed: 5: Input/output error\n`);
    return 5;
  }
  save(job.runAtLoad ? startJob(job) : { ...job, pid: null });
  return 0;
}
async function unload(label) {
  const job = find(label);
  if (!job) {
    process.stderr.write(`Boot-out failed: 3: No such process\n`);
    return 3;
  }
  await stopJob(job);
  rmSync(jobFile(label), { force: true });
  return 0;
}
const labelOf = (target) => target.split('/').slice(1).join('/') || target;
const positional = (args) => args.filter((a) => !a.startsWith('-'));

async function main() {
  switch (command) {
    case 'bootstrap': {
      let code = 0;
      for (const file of positional(rest).slice(1)) code = load(file) || code;
      return code;
    }
    case 'load': {
      let code = 0;
      for (const file of positional(rest)) code = load(file) || code;
      return code;
    }
    case 'bootout': {
      const [target, ...files] = positional(rest);
      if (!target) return 64;
      if (!files.length) return unload(labelOf(target));
      let code = 0;
      for (const file of files) code = (await unload(readPlist(file).label)) || code;
      return code;
    }
    case 'unload': {
      let code = 0;
      for (const file of positional(rest)) {
        let label;
        try { label = readPlist(file).label; } catch { code = 5; continue; }
        code = (await unload(label)) || code;
      }
      return code;
    }
    case 'remove': return unload(positional(rest)[0] ?? '');
    case 'kickstart': {
      const job = find(labelOf(positional(rest)[0] ?? ''));
      if (!job) { process.stderr.write('Could not find service\n'); return 113; }
      if (rest.includes('-k')) await stopJob(job);
      if (!alive(job.pid)) save(startJob(job));
      return 0;
    }
    case 'print': {
      const job = find(labelOf(positional(rest)[0] ?? ''));
      if (!job) { process.stderr.write('Could not find service\n'); return 113; }
      process.stdout.write(`${job.label} = {\n\tpath = ${job.plist}\n\tstate = ${alive(job.pid) ? 'running' : 'not running'}\n${alive(job.pid) ? `\tpid = ${job.pid}\n` : ''}}\n`);
      return 0;
    }
    case 'list': {
      const label = positional(rest)[0];
      if (label) {
        const job = find(label);
        if (!job) { process.stderr.write(`Could not find service "${label}" in domain for port\n`); return 113; }
        process.stdout.write(`{\n\t"Label" = "${job.label}";\n${alive(job.pid) ? `\t"PID" = ${job.pid};\n` : ''}};\n`);
        return 0;
      }
      process.stdout.write(`PID\tStatus\tLabel\n${loaded().map((j) => `${alive(j.pid) ? j.pid : '-'}\t0\t${j.label}`).join('\n')}\n`);
      return 0;
    }
    case '__state':
      process.stdout.write(`${JSON.stringify(loaded().map((j) => ({ label: j.label, plist: j.plist, pid: alive(j.pid) ? j.pid : null, program: j.program })))}\n`);
      return 0;
    case '__relogin': {
      for (const job of loaded()) { await stopJob(job); rmSync(jobFile(job.label), { force: true }); }
      const dir = rest[0];
      const labels = [];
      for (const name of existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.plist')).sort() : []) {
        try { load(join(dir, name)); labels.push(readPlist(join(dir, name)).label); } catch { /* launchd skips a plist it can't read */ }
      }
      process.stdout.write(`${JSON.stringify(labels)}\n`);
      return 0;
    }
    default:
      return 0;
  }
}

main().then((code) => process.exit(code), (error) => { process.stderr.write(`launchctl: ${error?.message ?? error}\n`); process.exit(1); });
