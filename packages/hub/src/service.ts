// `deep hub start`, `status` and `stop`. The installed hub runs as a per-user service that starts at login,
// never as a child of the terminal or hook that first needed it: launchd on macOS, a systemd user service on
// Linux. A dev hub (--root) is started in a session of its own, so it outlives its terminal too.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { hubAddress, installedRoot, rootOf } from './paths.js';
import { line } from './wire.js';

const LABEL = 'com.deepbuild.hub';
const UNIT = 'deepbuild-hub.service';
const WAIT_MS = 15_000;
/** The file limit the login service raises the hub's to: a connection per hook in flight, the record, evidence and runs. */
const FILES = 8192;
type Obj = Record<string, unknown>;

/** A connection's lines, read one at a time. */
function connect(path: string, timeoutMs = 2000): Promise<{ next(): Promise<Obj>; send(o: object): void; close(): void }> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(path);
    const lines: Obj[] = [];
    const waiting: ((o: Obj) => void)[] = [];
    let buffer = '';
    let failed: Error | undefined;
    const timer = setTimeout(() => fail(Error(`no answer within ${timeoutMs} ms`)), timeoutMs);
    const fail = (error: Error) => {
      failed = error;
      clearTimeout(timer);
      sock.destroy();
      reject(error);
    };
    sock.setEncoding('utf8');
    sock.on('error', (error) => fail(error));
    sock.on('close', () => { if (!failed) failed = Error('the hub closed the connection'); });
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const o = JSON.parse(buffer.slice(0, i)) as Obj;
        buffer = buffer.slice(i + 1);
        const wake = waiting.shift();
        if (wake) wake(o);
        else lines.push(o);
      }
    });
    const next = () => new Promise<Obj>((done, stop) => {
      const ready = lines.shift();
      if (ready) return done(ready);
      if (failed) return stop(failed);
      const t = setTimeout(() => stop(Error(`no answer within ${timeoutMs} ms`)), timeoutMs);
      waiting.push((o) => { clearTimeout(t); done(o); });
    });
    // Connected once the hub's hello arrives.
    next().then(() => { clearTimeout(timer); resolve({ next, send: (o) => sock.write(line(o)), close: () => sock.destroy() }); }, () => undefined);
  });
}
/** Whether a hub answers at `path` with its hello. */
const answers = (path: string) => connect(path).then((c) => { c.close(); return true; }, () => false);
async function waitForHub(path: string): Promise<boolean> {
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    if (await answers(path)) return true;
    await new Promise((done) => setTimeout(done, 100));
  }
  return false;
}

/** One control call on the hub at `path`, as the CLI, with the token `tokenFile` holds. */
async function control(path: string, tokenFile: string, method: string): Promise<Obj> {
  const c = await connect(path);
  try {
    c.send({ hello: 'cli', token: readFileSync(tokenFile, 'utf8').trim() });
    const hello = await c.next();
    if (hello.error) throw Error(`the hub refused the CLI's credential: ${JSON.stringify(hello.error)}`);
    c.send({ id: method, method, params: {} });
    const reply = await c.next();
    if (reply.error) throw Error(`${method} was refused: ${JSON.stringify(reply.error)}`);
    return reply.result as Obj;
  } finally {
    c.close();
  }
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const quoted = (s: string) => `"${s.replace(/(["\\])/g, '\\$1')}"`;

/** The login service's definition: where it goes, and what it holds. It runs `deep hub run`. */
function definition(program: string[], logs: string): { file: string; text: string } {
  const env = { PATH: process.env.PATH ?? '/usr/bin:/bin' };
  if (process.platform === 'darwin') {
    const strings = (items: string[]) => items.map((s) => `<string>${xml(s)}</string>`).join('\n    ');
    return {
      file: join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`),
      text: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    ${strings(program)}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>SoftResourceLimits</key>
  <dict>
    <key>NumberOfFiles</key>
    <integer>${FILES}</integer>
  </dict>
  <key>EnvironmentVariables</key>
  <dict>
    ${Object.entries(env).map(([k, v]) => `<key>${xml(k)}</key>\n    <string>${xml(v)}</string>`).join('\n    ')}
  </dict>
  <key>StandardOutPath</key>
  <string>${xml(join(logs, 'hub.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${xml(join(logs, 'hub.log'))}</string>
</dict>
</plist>
`,
    };
  }
  const config = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return {
    file: join(config, 'systemd', 'user', UNIT),
    text: `[Unit]
Description=DeepBuild hub

[Service]
ExecStart=${program.map(quoted).join(' ')}
Environment=${Object.entries(env).map(([k, v]) => quoted(`${k}=${v}`)).join(' ')}
Restart=on-failure
LimitNOFILE=${FILES}

[Install]
WantedBy=default.target
`,
  };
}

/** Hands the definition to the service manager, or to $DEEP_HUB_LAUNCHER where a test stands in for it. */
function launch(file: string): string | undefined {
  const run = (command: string, args: string[]) => spawnSync(command, args, { encoding: 'utf8' });
  const launcher = process.env.DEEP_HUB_LAUNCHER;
  if (launcher) {
    const r = run(launcher, [file]);
    return r.status === 0 ? undefined : `${launcher} exited ${r.status}: ${r.stderr}`;
  }
  if (process.platform === 'darwin') {
    const domain = `gui/${process.getuid!()}`;
    const loaded = run('launchctl', ['bootstrap', domain, file]);
    if (loaded.status === 0) return undefined;
    // Already loaded: start it again.
    const kicked = run('launchctl', ['kickstart', `${domain}/${LABEL}`]);
    return kicked.status === 0 ? undefined : `launchctl: ${loaded.stderr.trim()} ${kicked.stderr.trim()}`;
  }
  if (process.platform === 'linux') {
    for (const args of [['--user', 'daemon-reload'], ['--user', 'enable', '--now', UNIT]]) {
      const r = run('systemctl', args);
      if (r.status !== 0) return `systemctl ${args.join(' ')}: ${r.stderr.trim()}`;
    }
    return undefined;
  }
  return `a login service on ${process.platform} isn't supported yet`;
}

/** `deep hub start [--root <folder>]`: exits 0 once a hub answers on the root's socket, started now or already running. */
export async function startHub(options: { root?: string; cli: string }): Promise<number> {
  const root = rootOf(options.root ?? installedRoot());
  if (await answers(root.socket)) return 0;
  mkdirSync(root.logs, { recursive: true, mode: 0o700 });
  const program = [process.execPath, realpathSync(options.cli), 'hub', 'run', ...(options.root ? ['--root', root.dir] : [])];
  if (options.root) {
    // A dev hub: in a session of its own, so its terminal's hangup never reaches it.
    const log = openSync(join(root.logs, 'hub.log'), 'a', 0o600);
    spawn(program[0]!, program.slice(1), { detached: true, stdio: ['ignore', log, log] }).unref();
  } else {
    const { file, text } = definition(program, root.logs);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    const failed = launch(file);
    if (failed) {
      process.stderr.write(`deep hub start: ${failed}\n`);
      return 3;
    }
  }
  if (await waitForHub(root.socket)) return 0;
  process.stderr.write(`deep hub start: no hub answered at unix:${root.socket} within ${WAIT_MS / 1000} s; see ${join(root.logs, 'hub.log')}\n`);
  return 3;
}

/** `deep hub status [--root <folder>]`: the hub's health as one JSON line; 3 when no hub could be read. */
export async function hubStatus(options: { root?: string }): Promise<number> {
  let path: string;
  try {
    path = options.root ? rootOf(options.root).socket : hubAddress().path;
  } catch (error) {
    process.stderr.write(`deep hub status: ${error instanceof Error ? error.message : String(error)}\n`);
    return 3;
  }
  const tokenFile = rootOf(options.root ?? installedRoot()).token;
  try {
    process.stdout.write(`${JSON.stringify(await control(path, tokenFile, 'hub.health'))}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`deep hub status: no hub could be read at unix:${path}: ${error instanceof Error ? error.message : String(error)}\n`);
    return 3;
  }
}

/** `deep hub stop --root <folder>`: stops a dev hub and waits for its socket to go quiet. */
export async function stopHub(options: { root: string }): Promise<number> {
  const root = rootOf(options.root);
  try {
    await control(root.socket, root.token, 'hub.stop');
  } catch (error) {
    process.stderr.write(`deep hub stop: no hub could be stopped at unix:${root.socket}: ${error instanceof Error ? error.message : String(error)}\n`);
    return 3;
  }
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline && (await answers(root.socket))) await new Promise((done) => setTimeout(done, 100));
  return 0;
}

/** Unloads the hub's login service and removes its definition, so no login starts the hub again (`deep setup --undo`). */
export function removeService(): void {
  const { file } = definition([], '');
  const run = (command: string, args: string[]) => spawnSync(command, args, { encoding: 'utf8' });
  if (process.platform === 'darwin') run('launchctl', ['bootout', `gui/${process.getuid!()}`, file]);
  if (process.platform === 'linux') run('systemctl', ['--user', 'disable', '--now', UNIT]);
  rmSync(file, { force: true });
  if (process.platform === 'linux') run('systemctl', ['--user', 'daemon-reload']);
}
/** Stops the hub at `root` if one answers there, and waits for its socket to go quiet. */
export async function stopIfRunning(root: string): Promise<void> {
  const at = rootOf(root);
  if (!(await answers(at.socket))) return;
  try { await control(at.socket, at.token, 'hub.stop'); } catch { return; }
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline && (await answers(at.socket))) await new Promise((done) => setTimeout(done, 100));
}
