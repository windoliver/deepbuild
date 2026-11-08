// `deep start approve` and `deep start` (#1330): a run you approve, and a session started under it, through the hub's
// socket as the cli role, naming this process for the peer check: run inside an agent's process tree, a start acts as
// that session and is refused.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { call, type Reply } from './client.js';
import { hubAddress, installedRoot, rootOf } from './paths.js';
import { startOf } from './wire.js';

type Obj = Record<string, unknown>;
const USAGE = `Usage: deep start approve --repo <path> --issues <n>[,<n>...] --agents <agent>[,<agent>...] [--home <agent>=<folder>]...
                          [--mode <agent>=<mode>]... --at-once <n> --plan-share <percent> [--until <ISO time>] [--host <host>]... [--json]
       deep start --repo <path> --issue <n> --agent <agent> [--mode <mode>] --prompt <words> [--json]`;
const REPEATED = new Set(['--home', '--mode', '--host']);
const FLAGS = new Set(['--repo', '--issues', '--agents', '--home', '--mode', '--at-once', '--plan-share', '--until', '--host', '--issue', '--agent', '--prompt']);

/** Each flag's values in order, or undefined for one this command doesn't take. */
function flagsOf(args: readonly string[]): Map<string, string[]> | undefined {
  const flags = new Map<string, string[]>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--json') continue;
    const value = args[i + 1];
    if (!FLAGS.has(a) || value === undefined) return undefined;
    if (flags.has(a) && !REPEATED.has(a)) return undefined;
    flags.set(a, [...(flags.get(a) ?? []), value]);
    i++;
  }
  return flags;
}
const pairs = (values: string[] | undefined): Record<string, string> | undefined => {
  if (!values) return undefined;
  const out: Record<string, string> = {};
  for (const v of values) {
    const at = v.indexOf('=');
    if (at < 1) return undefined;
    out[v.slice(0, at)] = v.slice(at + 1);
  }
  return out;
};

/** `deep start approve ...` or `deep start ...`: 0 asked or started, 1 refused, 2 a usage error, 3 no hub answered. */
export async function startCommand(args: readonly string[]): Promise<number> {
  const approving = args[0] === 'approve';
  const json = args.includes('--json');
  const flags = flagsOf(approving ? args.slice(1) : args);
  const one = (name: string): string | undefined => flags?.get(name)?.[0];
  const repo = one('--repo');
  let params: Obj | undefined;
  if (flags && repo) {
    if (approving) {
      const homes = pairs(flags.get('--home'));
      const modes = pairs(flags.get('--mode'));
      const until = one('--until');
      params = {
        repo: resolve(repo), issues: one('--issues')?.split(',').map(Number), agents: one('--agents')?.split(','),
        ...(homes ? { homes: Object.fromEntries(Object.entries(homes).map(([a, h]) => [a, resolve(h)])) } : {}), ...(modes ? { modes } : {}),
        at_once: Number(one('--at-once')), plan_share: Number(one('--plan-share')),
        ...(until ? { until: Date.parse(until) } : {}), ...(flags.has('--host') ? { hosts: flags.get('--host') } : {}),
      };
      if ((flags.has('--home') && !homes) || (flags.has('--mode') && !modes) || (until && Number.isNaN(Date.parse(until)))) params = undefined;
    } else if (one('--issue') && one('--agent') && one('--prompt')) {
      params = { repo: resolve(repo), issue: Number(one('--issue')), agent: one('--agent'), prompt: one('--prompt'), ...(one('--mode') ? { mode: one('--mode') } : {}) };
    }
  }
  if (!params) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  let reply: Reply;
  try {
    const token = readFileSync(rootOf(installedRoot()).token, 'utf8').trim();
    reply = await call(hubAddress().path, token, approving ? 'start.approve' : 'start.session', params, { pid: process.pid, start: (await startOf(process.pid)) ?? '' });
  } catch (error) {
    process.stderr.write(`BLOCKED: ${error instanceof Error ? error.message : String(error)}; nothing ${approving ? 'was asked' : 'started'}\n`);
    return 3;
  }
  if ('error' in reply) {
    process.stderr.write(`${reply.error.remediation}\n`);
    return ['type', 'required', 'enum', 'not_found'].includes(reply.error.code) ? 2 : 1;
  }
  const r = reply.result;
  if (json) process.stdout.write(`${JSON.stringify(r)}\n`);
  if (approving) {
    if (!json) process.stdout.write(`${String(r.ask)} asks you to approve the run; answer it with deep inbox answer ${String(r.ask)} allow\n`);
    return 0;
  }
  if (r.status !== 'started') {
    if (!json) process.stderr.write(`Refused (${String(r.bound)}): ${String(r.reason)}\n`);
    return 1;
  }
  if (!json) {
    const sandbox = r.sandbox as { sandboxed: boolean; walls: Record<string, boolean> };
    const held = Object.entries(sandbox.walls).filter(([, v]) => v).map(([k]) => k);
    process.stdout.write(`Started ${String(r.agent)} ${String(r.version)} as ${String(r.run)} in ${String(r.worktree)} on ${String(r.branch)}, mode ${String(r.mode)}; ${sandbox.sandboxed ? `its own sandbox holds ${held.join(', ') || 'nothing'}` : 'it has no sandbox of its own'}\n`);
  }
  return 0;
}
