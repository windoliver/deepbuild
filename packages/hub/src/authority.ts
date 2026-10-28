// The commands that take effect only once the OS confirms you (#19): `deep off` and `deep on`, `deep hub stop` of the
// installed hub, `deep hub use --root` and `deep setup --undo`. The hub asks the OS, as it does for an answer (#24), so
// a confirmation is never a claim the CLI makes; run inside an agent's process tree, each changes nothing. deep-hook
// also denies an agent's call to any of them (#17). A cancelled prompt changes nothing and exits 3, not decided.
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeJson } from './claude-settings.js';
import { call, type Reply } from './client.js';
import { hubAddress, installedRoot, rootOf } from './paths.js';
import { startOf } from './wire.js';

type Obj = Record<string, unknown>;

/** One call as this process, so the hub's peer check can tell whether an agent's process tree runs it. */
async function asYou(method: string, params: Obj): Promise<Reply> {
  const token = readFileSync(rootOf(installedRoot()).token, 'utf8').trim();
  return call(hubAddress(null).path, token, method, params, { pid: process.pid, start: (await startOf(process.pid)) ?? '' });
}
/** Why `command` doesn't count, or undefined once the OS confirmed you through the hub. */
export async function confirmed(command: string, detail?: string): Promise<string | undefined> {
  try {
    const reply = await asYou('you.confirm', { command, ...(detail ? { detail } : {}) });
    return 'error' in reply ? reply.error.remediation : undefined;
  } catch (error) {
    return `${command} changed nothing: no hub answered to ask the OS to confirm you (${error instanceof Error ? error.message : String(error)}). Start it with deep hub start, then run ${command} again.`;
  }
}

/** `deep off` or `deep on`: every gate watch-only at once, or back, while the floor holds. */
export async function gatesCommand(off: boolean): Promise<number> {
  const command = off ? 'deep off' : 'deep on';
  let reply: Reply;
  try {
    reply = await asYou(off ? 'gates.off' : 'gates.on', {});
  } catch (error) {
    process.stderr.write(`${command} changed nothing: no hub answered to ask the OS to confirm you (${error instanceof Error ? error.message : String(error)}).\n`);
    return 3;
  }
  if ('error' in reply) {
    process.stderr.write(`${reply.error.remediation}\n`);
    return 3;
  }
  process.stdout.write(off
    ? 'DeepBuild is off: every gate is watch-only, so no stop is held and no verdict blocks. The fail-closed guards, the .deepbuild/ guard and the core\'s floor still hold. deep on turns the gates back on.\n'
    : 'DeepBuild is on: its gates hold again.\n');
  return 0;
}

/** `deep hub use --root <folder>`: this worktree's sessions go to the dev hub at <folder>, once the OS confirms you. */
export async function useCommand(folder: string): Promise<number> {
  const socket = rootOf(folder).socket;
  const worktree = worktreeOf(process.cwd());
  const why = await confirmed('deep hub use', `--root ${resolve(folder)} for ${worktree}`);
  if (why) {
    process.stderr.write(`${why}\n`);
    return 3;
  }
  const file = rootOf(installedRoot()).dir + '/config.json';
  let config: Obj = {};
  try { config = JSON.parse(readFileSync(file, 'utf8')) as Obj; } catch { /* none yet */ }
  const hub = typeof config.hub === 'object' && config.hub !== null ? config.hub as Obj : {};
  const use = typeof hub.use === 'object' && hub.use !== null ? hub.use as Obj : {};
  writeJson(file, { ...config, hub: { ...hub, use: { ...use, [worktree]: `unix:${socket}` } } });
  process.stdout.write(`Sessions in ${worktree} now reach the dev hub at unix:${socket}.\n`);
  return 0;
}
/** The worktree a folder is in: git's top level, or the folder itself outside git. */
function worktreeOf(cwd: string): string {
  try {
    return realpathSync(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  } catch {
    return realpathSync(cwd);
  }
}
