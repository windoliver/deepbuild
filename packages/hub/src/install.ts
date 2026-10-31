// `deep install <folder>` (#351): shows the package's source and permissions first, read from its manifest as data,
// then asks the hub to install it as the cli role. The install counts only once the OS confirms you, which the hub
// asks for, naming the package; the installer's own refusals (a digest, a signature, a conflict...) come back named.
// `--trust-key` trusts the publisher key the package names first, in the same confirmation: an update signed by
// another key than the one trusted for the package installs only that way.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { call, type Reply } from './client.js';
import { deprecatedCalls } from './contracts.js';
import { hubAddress, installedRoot, rootOf } from './paths.js';
import { startOf } from './wire.js';

const USAGE = 'Usage: deep install [--trust-key] <package folder>';
/** Refusals that leave nothing installed and nothing decided: not confirmed, an agent's command, or a hub that couldn't. */
const UNDECIDED_CODES = new Set(['unconfirmed', 'role', 'unavailable']);

interface Manifest {
  id?: string; version?: string; digest?: string; publisher_key?: string; access?: { words?: string[] }; notices?: string[]; actions?: string[];
  checks?: string[]; provides?: { interface: string }[]; uses?: { interface: string }[]; replaces?: string[]; conflicts?: string[]; kernel?: string[];
  calls?: string[];
}

const list = (values: readonly string[] | undefined): string => (values?.length ? values.join(', ') : 'none');

/** `deep install [--trust-key] <folder>`: exit 0 installed, 2 a usage error, 3 not decided, 1 refused. */
export async function installCommand(args: readonly string[]): Promise<number> {
  const trustKey = args[0] === '--trust-key';
  const folders = trustKey ? args.slice(1) : args;
  if (folders.length !== 1 || folders[0]!.startsWith('--')) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const from = resolve(folders[0]!);
  let m: Manifest;
  try {
    m = JSON.parse(readFileSync(join(from, 'deepbuild.json'), 'utf8')) as Manifest;
  } catch (error) {
    process.stderr.write(`deep install: ${from} has no readable deepbuild.json (${error instanceof Error ? error.message : String(error)})\n`);
    return 2;
  }
  process.stdout.write([
    `Source: ${from}`,
    `  ${m.id}@${m.version}, digest ${m.digest}, ${m.publisher_key ? `signed by ${m.publisher_key}` : 'unsigned'}`,
    'Permissions:',
    `  access: ${list(m.access?.words)}`,
    `  notices: ${list(m.notices)}`,
    `  actions: ${list(m.actions)}`,
    `  check kinds: ${list(m.checks)}`,
    `  provides: ${list(m.provides?.map((p) => p.interface))}`,
    `  uses: ${list(m.uses?.map((u) => u.interface))}`,
    `  replaces: ${list(m.replaces)}`,
    `  conflicts with: ${list(m.conflicts)}`,
    `  runs on: ${list(m.kernel)}`,
    // The install check names each deprecated method the manifest calls, served through its adapter until it stops (#139).
    ...deprecatedCalls(m).map((e) => `  deprecated: ${m.id} calls ${e.method}, deprecated since ${e.deprecated_since}; it is served through ${e.replaced_by}${e.stops_serving ? ` until ${e.stops_serving}` : ''}, so call ${e.replaced_by}`),
    '',
  ].join('\n'));
  let reply: Reply;
  try {
    const token = readFileSync(rootOf(installedRoot()).token, 'utf8').trim();
    reply = await call(hubAddress().path, token, 'extension.install', { from, ...(trustKey ? { trust_key: true } : {}) }, { pid: process.pid, start: (await startOf(process.pid)) ?? '' });
  } catch (error) {
    process.stderr.write(`BLOCKED: ${error instanceof Error ? error.message : String(error)}; nothing was installed\n`);
    return 3;
  }
  if ('error' in reply) {
    process.stderr.write(`${reply.error.remediation}\n`);
    return UNDECIDED_CODES.has(reply.error.code) ? 3 : 2;
  }
  if (reply.result.status === 'refused') {
    process.stderr.write(`REFUSED: ${String(reply.result.reason)}\n`);
    return 1;
  }
  process.stdout.write(`Installed ${String(reply.result.id)}@${String(reply.result.version)}\n`);
  if (typeof reply.result.not_loaded === 'string') {
    process.stderr.write(`It is not loaded: ${reply.result.not_loaded}\n`);
    return 1;
  }
  return 0;
}
