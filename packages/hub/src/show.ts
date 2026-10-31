// `deep show` (#806): a canvas document drawn through the hub, as deep_show draws it, from a file. Run inside an agent's
// process tree it acts as that agent's session, so it lands in that agent's writer layer; anywhere else it is yours.
// `--check` makes its reply carry the check's verdict, `--include …,pixels` is `--snap`, and `--claim` names the claim
// the check is for. It prints the reply as one JSON line with --json, and exits by the deep commands' table.
import { readFileSync } from 'node:fs';
import { call } from './client.js';
import { hubAddress, installedRoot, rootOf } from './paths.js';
import { startOf } from './wire.js';

const USAGE = 'Usage: deep show --doc <doc ID> --document <file> [--removes id,id] [--t <time>] [--size WxH] [--include issues,audit,timing,pixels] [--check] [--snap] [--claim <claim>] [--json]';
const VALUED = new Set(['--doc', '--document', '--removes', '--t', '--size', '--include', '--claim']);

/** Exit 0 for presented or PASS, 1 for refused or FAIL, 3 for anything not decided, 2 for a usage error. */
export async function showCommand(args: readonly string[]): Promise<number> {
  const opts = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (VALUED.has(a) && args[i + 1] !== undefined) opts.set(a, args[++i]!);
    else if (a === '--check' || a === '--snap' || a === '--json') flags.add(a);
    else return usage();
  }
  const doc = opts.get('--doc');
  const file = opts.get('--document');
  if (!doc || !file) return usage();
  let document: unknown;
  try {
    document = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    process.stderr.write(`deep show: can't read ${file} as JSON: ${(error as Error).message}\n`);
    return 2;
  }
  const include = opts.get('--include')?.split(',').filter(Boolean) ?? ['issues'];
  if (flags.has('--snap') && !include.includes('pixels')) include.push('pixels');
  const size = opts.get('--size')?.split('x').map(Number);
  if (size && (size.length !== 2 || !size.every((n) => Number.isSafeInteger(n) && n > 0))) return usage();
  const params = {
    doc, document: JSON.stringify(document), include,
    ...(opts.has('--removes') ? { removes: opts.get('--removes')!.split(',').filter(Boolean) } : {}),
    ...(opts.has('--t') ? { t: opts.get('--t') } : {}),
    ...(size ? { size } : {}),
    ...(flags.has('--check') ? { check: true } : {}),
    ...(opts.has('--claim') ? { claim: opts.get('--claim') } : {}),
  };
  const at = rootOf(installedRoot());
  let token: string;
  try {
    token = readFileSync(at.token, 'utf8').trim();
  } catch {
    process.stderr.write('deep show: the hub is not running (no control token); start it with deep hub start\n');
    return 3;
  }
  const peer = { pid: process.pid, start: (await startOf(process.pid)) ?? '' };
  let reply;
  try {
    reply = await call(hubAddress().path, token, 'canvas.show', params, peer);
  } catch (error) {
    process.stderr.write(`deep show: ${(error as Error).message}\n`);
    return 3;
  }
  if ('error' in reply) {
    process.stderr.write(`deep show: ${reply.error.remediation}\n`);
    if (flags.has('--json')) process.stdout.write(`${JSON.stringify({ error: reply.error })}\n`);
    return 3;
  }
  const r = reply.result as { outcome?: string; result?: string; reason?: string; code?: string };
  process.stdout.write(flags.has('--json') ? `${JSON.stringify(r)}\n` : `${r.result ?? r.outcome}${r.reason ? ` (${r.reason})` : ''}${r.code ? ` (${r.code})` : ''}\n`);
  const decided = r.result ?? (r.outcome === 'presented' ? 'PASS' : r.outcome === 'refused' ? 'FAIL' : 'BLOCKED');
  return decided === 'PASS' ? 0 : decided === 'FAIL' ? 1 : 3;
}

function usage(): number {
  process.stderr.write(`${USAGE}\n`);
  return 2;
}
