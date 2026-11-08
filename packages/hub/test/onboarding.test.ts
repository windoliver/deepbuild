// A newcomer's first minutes (design: How it installs): what the first commands say in a home where nothing of
// DeepBuild is set up yet, what setup says once it has run, and the Node path setup leaves in files that must outlive
// the next Node upgrade. Each runs the built CLI in a temporary home, or the function a file names, never a stand-in.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { lastingNode } from '../src/paths.js';
import { buildFailure } from '../src/setup.js';
import { render } from '../src/status.js';

const CLI = fileURLToPath(new URL('../../cli/dist/main.js', import.meta.url));
const made: string[] = [];
const temp = () => { const dir = realpathSync(mkdtempSync('/tmp/deep-onb-')); made.push(dir); return dir; };
const started: number[] = [];
afterAll(() => {
  // Only the hubs this file's launcher started, by PID.
  for (const pid of started) try { process.kill(pid); } catch { /* gone */ }
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});
/** A home with nothing of DeepBuild, and an environment that reaches no agent, no service manager and no real home. */
function fresh(): { home: string; env: NodeJS.ProcessEnv; tmp: string } {
  const tmp = temp();
  const home = join(tmp, 'h');
  mkdirSync(home);
  writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
  const env: NodeJS.ProcessEnv = { HOME: home, PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, SHELL: '/bin/sh', DEEP_HUB_TEST_CONFIRM: join(tmp, 'confirm'), XDG_CONFIG_HOME: join(home, '.config') };
  return { home, env, tmp };
}
const deep = (env: NodeJS.ProcessEnv, ...args: string[]) => spawnSync(process.execPath, ['--no-warnings', CLI, ...args], { env, cwd: dirname(env.HOME!), encoding: 'utf8', timeout: 120_000 });

describe('deep doctor in a home nobody set up', () => {
  it('names deep setup as the fix for the hub, not deep hub start, which starts a hub no hook reaches', () => {
    const { env, home } = fresh();
    const ran = deep(env, 'doctor', '--json');
    const hub = ran.stdout.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, string>).find((i) => i.item === 'hub.socket');
    expect(hub, ran.stdout + ran.stderr).toMatchObject({ code: 'hub_unreachable', level: 'fail' });
    expect(hub!.fix).toMatch(/deep setup/);
    expect(hub!.fix).not.toMatch(/deep hub start/);
    expect(existsSync(join(home, '.deepbuild')), 'doctor reads; it sets nothing up').toBe(false);
  });
});

describe('deep setup', () => {
  it('says in one line what it added, with no line for a timing relation that holds', () => {
    const { env, tmp } = fresh();
    // The login service's stand-in: starts what the plist or the unit names, in a session of its own, and keeps its PID.
    const launcher = join(tmp, 'launcher');
    writeFileSync(launcher, `#!${process.execPath}
const { spawn } = require('node:child_process'); const fs = require('node:fs');
const text = fs.readFileSync(process.argv[2], 'utf8');
const plist = /<key>ProgramArguments<\\/key>\\s*<array>([\\s\\S]*?)<\\/array>/.exec(text);
const argv = plist
  ? [...plist[1].matchAll(/<string>([\\s\\S]*?)<\\/string>/g)].map((m) => m[1].replace(/&amp;/g, '&'))
  : [.../^ExecStart=(.*)$/m.exec(text)[1].matchAll(/"((?:[^"\\\\]|\\\\.)*)"/g)].map((m) => m[1].replace(/\\\\(.)/g, '$1'));
const child = spawn(argv[0], argv.slice(1), { detached: true, stdio: 'ignore' });
fs.appendFileSync(${JSON.stringify(join(tmp, 'pids'))}, child.pid + '\\n'); child.unref();
`);
    chmodSync(launcher, 0o755);
    const ran = deep({ ...env, DEEP_HUB_LAUNCHER: launcher }, 'setup');
    if (existsSync(join(tmp, 'pids'))) started.push(...readFileSync(join(tmp, 'pids'), 'utf8').split('\n').filter(Boolean).map(Number));
    expect(ran.status, ran.stderr).toBe(0);
    const lines = ran.stdout.split('\n').filter((l) => l && !l.startsWith('Wiki: '));
    expect(lines, ran.stdout).toHaveLength(1);
    expect(lines[0]).toMatch(/deep setup --undo/);
  }, 150_000);
});

describe('deep status with no session yet', () => {
  it('says how a session comes to be listed, beside the count', () => {
    const text = render([], 'Reading the hub at unix:/x');
    expect(text).toContain('0 sessions');
    expect(text).toMatch(/Start a Claude Code or Codex session/);
  });
  it('says nothing more once a session is listed', () => {
    expect(render([{ id: 'abcdefgh', repo: 'r', agent: 'claude', state: 'working', why: '' }], 'from')).not.toMatch(/Start a Claude Code or Codex session/);
  });
});

describe('the Node that files outliving this run name', () => {
  // Homebrew's layout: <prefix>/Cellar/node/<version>/bin/node, and <prefix>/opt/node linking the version installed now.
  const brew = () => {
    const prefix = temp();
    const node = join(prefix, 'Cellar', 'node', '23.9.0', 'bin', 'node');
    mkdirSync(dirname(node), { recursive: true });
    writeFileSync(node, '');
    mkdirSync(join(prefix, 'opt'));
    return { prefix, node };
  };
  it("is Homebrew's opt link, which the next upgrade keeps, when that link runs the same Node", () => {
    const { prefix, node } = brew();
    symlinkSync('../Cellar/node/23.9.0', join(prefix, 'opt', 'node'));
    expect(lastingNode(node)).toBe(join(prefix, 'opt', 'node', 'bin', 'node'));
  });
  it('stays the Node running when the opt link names another version, or there is none', () => {
    const { prefix, node } = brew();
    expect(lastingNode(node)).toBe(node);
    mkdirSync(join(prefix, 'Cellar', 'node', '24.0.0', 'bin'), { recursive: true });
    writeFileSync(join(prefix, 'Cellar', 'node', '24.0.0', 'bin', 'node'), '');
    symlinkSync('../Cellar/node/24.0.0', join(prefix, 'opt', 'node'));
    expect(lastingNode(node)).toBe(node);
  });
  it('is the path as it is for a Node outside a Cellar', () => {
    expect(lastingNode('/usr/local/bin/node')).toBe('/usr/local/bin/node');
  });
});

describe("the hub's login service on macOS", () => {
  /**
   * A home whose `launchctl` stands in for launchd, never the real one: one job per label, kept in `<tmp>/job` as the
   * plist it was loaded from. bootstrap of a loaded label exits 5, as launchd's does; print names the job's path, as
   * launchd's does; kickstart runs the job's program and bootstrap a new one's, each logged to `<tmp>/ran`.
   */
  function withLaunchd() {
    const { home, env, tmp } = fresh();
    const bin = join(tmp, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'launchctl'), `#!/bin/sh
job='${join(tmp, 'job')}'; ran='${join(tmp, 'ran')}'
case "$1" in
  bootstrap) [ -f "$job" ] && { echo 'Bootstrap failed: 5: Input/output error' >&2; exit 5; }; printf %s "$3" > "$job"; echo "bootstrap $3" >> "$ran" ;;
  print) [ -f "$job" ] || exit 113; printf 'com.deepbuild.hub = {\n\tpath = %s\n}\n' "$(cat "$job")" ;;
  kickstart) [ -f "$job" ] || exit 113; echo "kickstart $(cat "$job")" >> "$ran" ;;
esac
`);
    chmodSync(join(bin, 'launchctl'), 0o755);
    const ran = () => (existsSync(join(tmp, 'ran')) ? readFileSync(join(tmp, 'ran'), 'utf8') : '');
    return { home, tmp, ran, env: { ...env, PATH: `${bin}:${env.PATH}` } };
  }
  it.runIf(process.platform === 'darwin')("never starts a job another home's plist loaded under the same label, and names that plist", () => {
    const w = withLaunchd();
    const other = join(w.tmp, 'other', 'com.deepbuild.hub.plist');
    writeFileSync(join(w.tmp, 'job'), other);
    const result = deep(w.env, 'hub', 'start');
    expect(w.ran(), "the other home's hub job was started").not.toContain('kickstart');
    expect(result.status).toBe(3);
    expect(result.stderr).toContain(other);
  }, 60_000);
  it.runIf(process.platform === 'darwin')("starts its own job again when that job is the one loaded", () => {
    const w = withLaunchd();
    const own = join(w.home, 'Library', 'LaunchAgents', 'com.deepbuild.hub.plist');
    writeFileSync(join(w.tmp, 'job'), own);
    deep(w.env, 'hub', 'start');
    expect(w.ran()).toContain(`kickstart ${own}`);
  }, 60_000);
  it.runIf(process.platform === 'darwin')('gives the hub its own HOME, so a hub launchd starts reads and writes only its own home', () => {
    const w = withLaunchd();
    deep(w.env, 'hub', 'start');
    const text = readFileSync(join(w.home, 'Library', 'LaunchAgents', 'com.deepbuild.hub.plist'), 'utf8');
    expect(text).toMatch(new RegExp(`<key>HOME</key>\\s*<string>${w.home}</string>`));
  }, 60_000);
});

describe("the hub's login service on Linux", () => {
  /**
   * A home whose `systemctl` stands in for the user manager, never the real one: one unit per name, kept in `<tmp>/unit`
   * as the file it was loaded from. `show --property=FragmentPath --value` names that file, as systemd's does; every
   * other call is logged to `<tmp>/ran`, with the loaded file after `enable`.
   */
  function withSystemd() {
    const { home, env, tmp } = fresh();
    const bin = join(tmp, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'systemctl'), `#!/bin/sh
unit='${join(tmp, 'unit')}'; ran='${join(tmp, 'ran')}'
case "$2" in
  show) [ -f "$unit" ] && cat "$unit"; echo ;;
  enable) echo "$* $(cat "$unit" 2>/dev/null)" >> "$ran" ;;
  *) echo "$*" >> "$ran" ;;
esac
`);
    chmodSync(join(bin, 'systemctl'), 0o755);
    const ran = () => (existsSync(join(tmp, 'ran')) ? readFileSync(join(tmp, 'ran'), 'utf8') : '');
    return { home, tmp, ran, env: { ...env, PATH: `${bin}:${env.PATH}` } };
  }
  const own = (home: string) => join(home, '.config', 'systemd', 'user', 'deepbuild-hub.service');
  it.runIf(process.platform === 'linux')("never starts a unit another home's file loaded under the same name, and names that file", () => {
    const w = withSystemd();
    const other = join(w.tmp, 'other', 'deepbuild-hub.service');
    writeFileSync(join(w.tmp, 'unit'), other);
    const result = deep(w.env, 'hub', 'start');
    expect(w.ran(), "the other home's hub unit was started").not.toContain('enable');
    expect(result.status).toBe(3);
    expect(result.stderr).toContain(other);
  }, 60_000);
  it.runIf(process.platform === 'linux')('starts its own unit again when that unit is the one loaded', () => {
    const w = withSystemd();
    writeFileSync(join(w.tmp, 'unit'), own(w.home));
    deep(w.env, 'hub', 'start');
    expect(w.ran()).toContain(`--user enable --now deepbuild-hub.service ${own(w.home)}`);
  }, 60_000);
  it.runIf(process.platform === 'linux')('gives the hub its own HOME, so a hub systemd starts reads and writes only its own home', () => {
    const w = withSystemd();
    deep(w.env, 'hub', 'start');
    expect(readFileSync(own(w.home), 'utf8')).toMatch(new RegExp(`^Environment=.*"HOME=${w.home}"`, 'm'));
  }, 60_000);
});

describe('setup on a machine without what it needs', () => {
  it('says to install Rust when cargo is missing, never a bare ENOENT', () => {
    const missing = Object.assign(Error('spawnSync cargo ENOENT'), { code: 'ENOENT' });
    const said = buildFailure(missing);
    expect(said).not.toMatch(/ENOENT/);
    expect(said).toMatch(/rustup/);
    expect(said).toMatch(/cargo build --locked -p deep-hook/);
  });
  it("keeps a failed build's own message when cargo ran", () => {
    expect(buildFailure(Error('Command failed: cargo build'))).toContain('Command failed: cargo build');
  });
});
