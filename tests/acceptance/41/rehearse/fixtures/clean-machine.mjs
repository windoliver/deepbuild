// One clean-machine install, test-side, for AC1 and AC9: the same script runs on the Mac and inside the Linux container.
//   node clean-machine.mjs <archives dir> <work dir> <fixtures dir>
// It starts registry.mjs on loopback over the release's archives, then, with a fresh HOME (<work>/home) and a clean
// environment (below), runs in an empty folder `npx --yes deepbuild setup` and `npx --yes deepbuild --version`; installs
// `deepbuild` into a fresh project (<work>/project) and runs its `deep --version` and `deep doctor --json`; reads back the
// commands setup wrote into Claude Code's settings and hashes each deep-hook they name; measures the project's
// node_modules. It writes everything to <work>/result.json, stops the registry and every hub the login service stand-in
// started (by PID, all its own children), and exits 0 whatever DeepBuild did: the test judges the result.
//
// The clean environment holds only: HOME; PATH = <work>/bin (the login service stand-ins), this node's own folder,
// /usr/bin:/bin:/usr/sbin:/sbin; SHELL=/bin/sh; LC_ALL=C; TMPDIR=<work>/tmp; npm's registry (the loopback one) with audit,
// fund and update-notifier off; and the stand-ins: DEEP_HUB_LAUNCHER (fixtures/launcher.mjs, for launchd or systemd
// --user, so the machine's real login service is never touched), DEEP_TEST_LAUNCHER_LOG, and DEEP_HUB_TEST_CONFIRM (the OS
// confirmation, as every setup suite stubs it). No DEEP_ variable points at this checkout, and no cargo, git checkout or
// Homebrew folder is on PATH.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [archives, work, fixtures] = process.argv.slice(2);
if (!archives || !work || !fixtures) { process.stderr.write('usage: clean-machine.mjs <archives> <work> <fixtures>\n'); process.exit(2); }
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const home = join(work, 'home');
const bin = join(work, 'bin');
const npxDir = join(work, 'npx');
const project = join(work, 'project');
for (const d of [home, bin, npxDir, project, join(work, 'tmp')]) mkdirSync(d, { recursive: true });
const script = (name, text) => { writeFileSync(join(bin, name), text); chmodSync(join(bin, name), 0o755); };
for (const name of ['launchctl', 'systemctl']) script(name, `#!/bin/sh\nprintf '%s %s\\n' '${name}' "$*" >> '${join(work, 'calls.log')}'\nexit 0\n`);
script('launcher', `#!/bin/sh\nexec '${process.execPath}' '${join(fixtures, 'launcher.mjs')}' "$@"\n`);
writeFileSync(join(work, 'confirm'), 'confirmed\n');

const result = { platform: process.platform, arch: process.arch, node: process.version, steps: {} };
const save = () => writeFileSync(join(work, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);

// The registry, on loopback.
const registry = spawn(process.execPath, [join(fixtures, 'registry.mjs'), archives], { stdio: ['ignore', 'pipe', 'pipe'] });
let registryLog = '';
registry.stderr.setEncoding('utf8').on('data', (d) => (registryLog += d));
const url = await new Promise((resolve) => {
  let out = '';
  const timer = setTimeout(() => resolve(undefined), 120_000);
  registry.stdout.setEncoding('utf8').on('data', (d) => {
    out += d;
    const m = /^registry (\S+)$/m.exec(out);
    if (m) { clearTimeout(timer); resolve(m[1]); }
  });
  registry.on('exit', () => { clearTimeout(timer); resolve(undefined); });
});
result.registry = url ?? null;

const env = {
  HOME: home,
  PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,
  SHELL: '/bin/sh',
  LC_ALL: 'C',
  TMPDIR: join(work, 'tmp'),
  npm_config_registry: url ?? 'http://127.0.0.1:9/',
  npm_config_audit: 'false',
  npm_config_fund: 'false',
  npm_config_update_notifier: 'false',
  DEEP_HUB_LAUNCHER: join(bin, 'launcher'),
  DEEP_TEST_LAUNCHER_LOG: join(work, 'launched'),
  DEEP_HUB_TEST_CONFIRM: join(work, 'confirm'),
};
result.env = env;
const step = (name, command, args, cwd, timeout = 1_200_000) => {
  const started = Date.now();
  const r = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout, maxBuffer: 1 << 26, input: '' });
  result.steps[name] = { command: [command, ...args].join(' '), code: r.status, signal: r.signal, error: r.error?.message ?? null, ms: Date.now() - started, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  save();
  return result.steps[name];
};

try {
  if (url) {
    const npx = join(dirname(process.execPath), 'npx');
    const npm = join(dirname(process.execPath), 'npm');
    step('setup', npx, ['--yes', 'deepbuild', 'setup'], npxDir);
    step('npxVersion', npx, ['--yes', 'deepbuild', '--version'], npxDir);
    writeFileSync(join(project, 'package.json'), '{ "name": "fresh-project", "version": "1.0.0", "private": true }\n');
    step('install', npm, ['install', 'deepbuild', '--ignore-scripts'], project);
    const deep = join(project, 'node_modules', '.bin', 'deep');
    step('version', deep, ['--version'], project, 300_000);
    step('doctor', deep, ['doctor', '--json'], project, 600_000);
  }

  // What setup wrote, read back: each command in Claude Code's settings, and each deep-hook it names, hashed.
  const settingsFile = join(home, '.claude', 'settings.json');
  result.settingsText = existsSync(settingsFile) ? readFileSync(settingsFile, 'utf8') : null;
  const claudeJson = join(home, '.claude.json');
  result.claudeJsonText = existsSync(claudeJson) ? readFileSync(claudeJson, 'utf8') : null;
  const commands = [];
  const walk = (v, key) => {
    if (typeof v === 'string' && key === 'command') commands.push(v);
    else if (Array.isArray(v)) v.forEach((x) => walk(x));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  try { walk(JSON.parse(result.settingsText ?? 'null')); } catch { /* unparsable: the test names it */ }
  const first = (c) => { const s = c.trim(); const q = s[0]; if (q === "'" || q === '"') return s.slice(1, s.indexOf(q, 1)); return s.split(/\s+/)[0]; };
  result.hooks = commands.map((command) => {
    const path = first(command);
    const real = existsSync(path) ? realpathSync(path) : null;
    return { command, path, real, sha256: real ? sha(readFileSync(real)) : null };
  });

  // The per-platform deep-hook as the release's archive holds it.
  const manifest = JSON.parse(readFileSync(join(archives, 'manifest.json'), 'utf8'));
  const platformName = `@deepbuild/deep-hook-${process.platform}-${process.arch}`;
  const platformArchive = manifest.archives.find((a) => a.name === platformName);
  result.platformPackage = platformName;
  if (platformArchive) {
    const r = spawnSync('tar', ['-xzOf', join(archives, platformArchive.file), 'package/bin/deep-hook'], { maxBuffer: 1 << 28 });
    result.archiveHookSha256 = r.status === 0 ? sha(r.stdout) : null;
  }

  // The fresh project's installed size: every regular file under node_modules, links not followed.
  const modules = join(project, 'node_modules');
  let bytes = 0;
  const perPackage = {};
  const measure = (dir, top) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = lstatSync(p);
      if (st.isDirectory()) measure(p, top);
      else if (st.isFile()) { bytes += st.size; perPackage[top] = (perPackage[top] ?? 0) + st.size; }
    }
  };
  const installed = [];
  if (existsSync(modules)) {
    for (const name of readdirSync(modules)) {
      if (name === '.bin' || name.startsWith('.package-lock')) continue;
      const names = name.startsWith('@') ? readdirSync(join(modules, name)).map((n) => `${name}/${n}`) : [name];
      for (const n of names) { installed.push(n); measure(join(modules, n), n); }
    }
  }
  result.installed = installed;
  result.nodeModulesBytes = existsSync(modules) ? bytes : null;
  result.packageBytes = perPackage;
  const hookInProject = join(modules, ...platformName.split('/'), 'bin', 'deep-hook');
  result.projectHookSha256 = existsSync(hookInProject) ? sha(readFileSync(hookInProject)) : null;
  result.projectHookMode = existsSync(hookInProject) ? lstatSync(hookInProject).mode & 0o777 : null;
} finally {
  result.registryLog = registryLog;
  // Every hub the stand-in started for this home, then the registry: all started here, stopped by PID.
  const log = join(work, 'launched');
  const pids = existsSync(log) ? readFileSync(log, 'utf8').split('\n').map(Number).filter((n) => n > 0) : [];
  for (const pid of pids) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  await new Promise((r) => setTimeout(r, 2000));
  for (const pid of pids) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  registry.kill('SIGKILL');
  result.stoppedPids = pids;
  save();
  process.stdout.write(`clean-machine: result in ${join(work, 'result.json')}\n`);
}
