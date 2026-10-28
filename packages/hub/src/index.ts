// @deepbuild/hub: the hub daemon on its socket (#16), the `deep hub` commands that start, read and stop it,
// `deep mcp`, the MCP server agents reach it through, `deep env`, a worktree's stack through it (#331), and
// `deep inbox`, your asks and your answers through it (#24), `deep install`, a package installed through it (#351),
// `deep guard add`, guard entries you wrote installed through it (#304),
// and `deep setup`, `deep waiter` and the doctor's timing relations for Claude Code's hooks (#18); `deep setup --undo`,
// `deep off`, `deep on`, `deep hub stop` and `deep hub use`, each once the OS confirms you, and `deep status` (#19).
import { confirmed, gatesCommand, useCommand } from './authority.js';
import { envCommand } from './env.js';
import { guardCommand } from './guards.js';
import { inboxCommand } from './inbox.js';
import { installCommand } from './install.js';
import { runMcp } from './mcp.js';
import { resolve } from 'node:path';
import { installedRoot } from './paths.js';
import { runHub } from './server.js';
import { hubStatus, startHub, stopHub, stopIfRunning } from './service.js';
import { relationItems, setUpFirst, setupCommand, waiterCommand } from './setup.js';

export { envCommand, gatesCommand, guardCommand, inboxCommand, installCommand, relationItems, runMcp, setUpFirst, setupCommand, waiterCommand };
export { statusCommand } from './status.js';
export { doctorCommand, doctorItems } from './doctor.js';
export { activePlant } from './plant.js';

const USAGE = `Usage: deep hub run [--root <folder>] [--safe]
       deep hub start [--root <folder>]
       deep hub status [--root <folder>]
       deep hub stop [--root <folder>]
       deep hub use --root <folder>`;

/** `deep hub <command>`: `cli` is the path of the deep command's own script, which the login service runs. */
export async function hubCommand(args: readonly string[], cli: string): Promise<number> {
  const [command, ...given] = args;
  // Safe mode, only for `run`: the hub starts with no extension loaded.
  const safe = command === 'run' && given.includes('--safe');
  const rest = given.filter((a) => !(safe && a === '--safe'));
  let root: string | undefined;
  if (rest.length === 2 && rest[0] === '--root' && rest[1]) root = rest[1];
  else if (rest.length) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  switch (command) {
    case 'run': return runHub({ ...(root ? { root } : {}), safe });
    case 'start': return startHub({ cli, ...(root ? { root } : {}) });
    case 'status': return hubStatus(root ? { root } : {});
    case 'stop':
      // A dev hub stops when asked; the installed one only once the OS confirms you.
      if (root && resolve(root) !== installedRoot()) return stopHub({ root });
      return stopInstalled();
    case 'use':
      if (root) return useCommand(root);
      break;
  }
  process.stderr.write(`${USAGE}\n`);
  return 2;
}

/** `deep hub stop` of the installed hub, once the OS confirms you. */
async function stopInstalled(): Promise<number> {
  const why = await confirmed('deep hub stop');
  if (why) {
    process.stderr.write(`${why}\n`);
    return 3;
  }
  await stopIfRunning(installedRoot());
  process.stdout.write('The hub stopped. It starts again at your next login, or with deep hub start.\n');
  return 0;
}
