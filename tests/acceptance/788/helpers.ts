// A real hub on a temp home with one real installed extension whose tool.before handler answers by the call's
// command, guard entries in rules.json, and Claude Code PreToolUse hooks sent through the hub's socket the way
// deep-hook sends them (design: Extension API; #304 guard modes; #350).
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { openAsks } from '@deepbuild/asks';
import { openEvidenceStore } from '@deepbuild/evidence';
import { openExtensionHost, openTrust, packageDigest } from '@deepbuild/extension-host';
import { openRecord } from '@deepbuild/record';
import { openSupervisor } from '@deepbuild/supervisor';

const CLI = fileURLToPath(new URL('../../../packages/cli/dist/main.js', import.meta.url));
const SESSION = '0b7c3d2e-7880-4788-8788-078807880788';

/** The installed extension's ID: the label its deny reasons and context blocks carry. */
export const EXT = 'test/warned';

// The extension's tool.before handler, by what the call's command names:
//   deny-me   denies the call ("this is a force-push call");
//   tell-me   adds one context block ("3 notes are open");
//   quiet-me  answers nothing;
//   late-me   answers past any deadline;
//   throw-me  throws;
//   probe-me  answers nothing, and is counted: each call the handler is asked about that names it;
//   report-me adds the count so far as context ("<n> probes seen"), so the test reads what the handler was asked.
const MANIFEST = {
  id: EXT, version: '1.0.0', digest: 'd1:0000000000000000000000000000000000000000000000000000000000000000',
  access: { words: ['record'] },
  requires: { preview: ['deep.on'] },
  templates: [
    { name: 'blocked', hook: 'tool.before', text: 'this is a {what} call', fields: { what: { type: 'one_of', values: ['force-push'] } } },
    { name: 'open', hook: 'tool.before', text: '{count} notes are open', fields: { count: { type: 'number' } } },
    { name: 'seen', hook: 'tool.before', text: '{count} probes seen', fields: { count: { type: 'number' } } },
  ],
};
const CODE = `let probes = 0;
export default function (deep: any): void {
  deep.on('tool.before', async (req: any) => {
    const command = String(req?.data?.command ?? '');
    if (command.includes('probe-me')) probes += 1;
    if (command.includes('deny-me')) return { deny: { template: 'blocked', values: { what: 'force-push' } } };
    if (command.includes('tell-me')) return { context: { template: 'open', values: { count: 3 } } };
    if (command.includes('report-me')) return { context: { template: 'seen', values: { count: probes } } };
    if (command.includes('late-me')) { await new Promise((r) => setTimeout(r, 10_000)); return { context: { template: 'open', values: { count: 9 } } }; }
    if (command.includes('throw-me')) throw new Error('the handler broke');
    return null;
  });
}
`;

/** The extension's deny reason and context, as the agent reads them. */
export const DENY_WORDS = 'this is a force-push call';
export const CONTEXT_WORDS = '3 notes are open';

/** A warn-mode guard entry (#304) and the words it gives the agent. */
export const WARN = { name: 'warn-echo', entry: { match: 'run:echo', scope: 'all_repos', mode: 'warn', reason: 'Echo output here goes to a shared log.', next_step: 'Say what the echo is for.' } };
/** A block-mode guard entry (#304). */
export const BLOCK = { name: 'block-echo', entry: { match: 'run:echo', scope: 'all_repos', mode: 'block', reason: 'Echo is not allowed in this repo.', next_step: 'Use printf instead.' } };

export interface Exchange { ack: Record<string, unknown>; reply: { exit: number; stdout: string; stderr: string }; sent: number; replied: number }

/** What the agent's hook output says to the model: its additionalContext, or '' when it carries none. */
export function contextOf(reply: Exchange['reply']): string {
  if (!reply.stdout) return '';
  const out = JSON.parse(reply.stdout) as { hookSpecificOutput?: { additionalContext?: unknown } };
  return typeof out.hookSpecificOutput?.additionalContext === 'string' ? out.hookSpecificOutput.additionalContext : '';
}
/** The permission decision the hook output gives, if any. */
export function decisionOf(reply: Exchange['reply']): unknown {
  if (!reply.stdout) return undefined;
  return (JSON.parse(reply.stdout) as { hookSpecificOutput?: { permissionDecision?: unknown } }).hookSpecificOutput?.permissionDecision;
}

let ids = 0;
/** A ULID-shaped hook ID, unique in this process. */
function nextId(): string {
  ids += 1;
  return `01K788${String(Date.now() % 1e8).padStart(8, '0')}${String(ids).padStart(6, '0')}`.slice(0, 26).padEnd(26, '0').replace(/[ILOU]/g, '0');
}

/** A Claude Code PreToolUse for a Bash call, as deep-hook writes it, with the guard entries deep-hook matched. */
function request(command: string, matched: string[]): string {
  const id = nextId();
  const payload = { session_id: SESSION, cwd: '/tmp', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, tool_use_id: `toolu_${id}` };
  const seq = String(BigInt(Date.now()) * 1_000_000n);
  return `${JSON.stringify({ v: 1, agent: 'claude-code', event: 'PreToolUse', seq, id, pid: process.pid, ppid: process.ppid, matched, payload })}\n`;
}

/** Installs and checks the extension under the hub's home through the host API, with the hub stopped. */
async function install(home: string, root: string): Promise<void> {
  const from = join(home, 'pkg');
  mkdirSync(from, { recursive: true });
  writeFileSync(join(from, 'index.ts'), CODE);
  writeFileSync(join(from, 'deepbuild.json'), JSON.stringify(MANIFEST));
  writeFileSync(join(from, 'deepbuild.json'), JSON.stringify({ ...MANIFEST, digest: packageDigest(from) }));
  const evidence = await openEvidenceStore({ root: join(home, 'pre', 'evidence') });
  const record = await openRecord({ path: join(home, 'pre', 'ledger.db'), now: Date.now, evidence });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } } });
  const trust = await openTrust({ record, now: Date.now });
  const host = await openExtensionHost({ record, supervisor: sup, trust, home: root, release: [], now: Date.now });
  try {
    await host.ready();
    const pkg = await host.install({ from, builtBy: null, grant: { record: ['tool.before'] } });
    const checked = await host.check(pkg);
    if (!checked.passed) throw Error(`BLOCKED: ${EXT} didn't pass its conformance check: ${checked.reasons.join('; ')}`);
  } finally {
    await host.close();
    await sup.close();
    await record.close();
  }
}

export interface World {
  /** Sends one PreToolUse for `command` with the guard entries deep-hook matched, and reads the ack and the reply. */
  call: (command: string, matched?: string[]) => Promise<Exchange>;
}

/**
 * Runs `body` against a hub on a temp home with the extension installed and loaded and rules.json holding
 * `entries`, then stops the hub and removes the home.
 */
export async function withWorld(entries: Record<string, unknown>, body: (w: World) => Promise<void>): Promise<void> {
  const home = realpathSync(mkdtempSync('/tmp/acc-788-'));
  const root = join(home, '.deepbuild');
  mkdirSync(root, { recursive: true });
  let hub: ChildProcessByStdio<null, Readable, null> | undefined;
  const start = async () => {
    const child = spawn(process.execPath, [CLI, 'hub', 'run'], { env: { ...process.env, HOME: home }, stdio: ['ignore', 'pipe', 'inherit'] });
    hub = child;
    let timer: NodeJS.Timeout | undefined;
    await new Promise((resolve, reject) => {
      child.stdout.once('data', resolve);
      child.once('exit', () => reject(Error('BLOCKED: the hub exited before it was ready')));
      timer = setTimeout(() => reject(Error("BLOCKED: the hub wasn't ready within 90 s")), 90_000);
    }).finally(() => clearTimeout(timer));
  };
  const stop = async () => {
    const child = hub;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const gone = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([gone, new Promise((resolve) => { timer = setTimeout(resolve, 60_000); })]).finally(() => clearTimeout(timer));
  };
  const socket = join(root, 'hub.sock');
  try {
    // The hub's first start sets its home up; the extension is installed with it stopped, then loaded at the next.
    await start();
    await stop();
    await install(home, root);
    writeFileSync(join(root, 'rules.json'), JSON.stringify({ v: 1, entries }), { mode: 0o600 });
    await start();
    await body({ call: (command, matched = []) => exchange(socket, request(command, matched)) });
  } finally {
    await stop();
    rmSync(home, { recursive: true, force: true });
  }
}

/** Sends one hook request the way deep-hook does and reads both lines back: the acknowledgement and the reply. */
function exchange(socket: string, line: string): Promise<Exchange> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(socket);
    let got = '';
    let sent = 0;
    sock.on('data', (d) => {
      got += d;
      if (!sent && got.includes('\n')) { sent = Date.now(); sock.write(line); }
    });
    sock.on('end', () => {
      const lines = got.split('\n');
      if (lines.length < 4) return reject(Error(`BLOCKED: the hub closed after ${lines.length - 1} line(s): ${got}`));
      resolve({ ack: JSON.parse(lines[1]!) as Record<string, unknown>, reply: JSON.parse(lines[2]!) as Exchange['reply'], sent, replied: Date.now() });
    });
    sock.on('error', reject);
  });
}
