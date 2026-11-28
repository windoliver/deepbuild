// `deep hub run | start | status | stop | use | promote` (#16, #19, #1334), an entry of its own (`@deepbuild/hub/hub`), so the
// long-running hub loads the server's modules and none of the other commands'.
import { installedRoot, real } from './paths.js';
import { promoteCommand } from './promote.js';
import { hubStatus, startHub, stopHub } from './service.js';

const USAGE = `Usage: deep hub run [--root <folder>] [--safe]
       deep hub start [--root <folder>]
       deep hub status [--root <folder>]   the hub's health as one line of JSON, a developer's command
       deep hub stop [--root <folder>]
       deep hub use --root <folder>
       deep hub promote <build folder>`;

/** `deep hub <command>`: `cli` is the path of the deep command's own script, which the login service runs. */
export async function hubCommand(args: readonly string[], cli: string): Promise<number> {
  const [command, ...given] = args;
  if (command === 'promote') return promoteCommand(given);
  // Safe mode, only for `run`: the hub starts with no extension loaded.
  const safe = command === 'run' && given.includes('--safe');
  const rest = given.filter((a) => !(safe && a === '--safe'));
  let root: string | undefined;
  // A flag where the folder goes is a usage error, not a folder named for it (#2581).
  if (rest.length === 2 && rest[0] === '--root' && rest[1] && !rest[1].startsWith('-')) root = rest[1];
  else if (rest.length) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  switch (command) {
    case 'run': return (await import('./server.js')).runHub({ ...(root ? { root } : {}), safe });
    case 'start': return startHub({ cli, ...(root ? { root } : {}) });
    case 'status': return hubStatus(root ? { root } : {});
    case 'stop':
      // A dev hub stops when asked; the installed one only once the OS confirms you.
      if (root && real(root) !== real(installedRoot())) return stopHub({ root });
      return stopInstalled();
    case 'use':
      if (root) return (await import('./authority.js')).useCommand(root);
      break;
  }
  process.stderr.write(`${USAGE}\n`);
  return 2;
}

/** `deep hub stop` of the installed hub, once the OS confirms you. */
async function stopInstalled(): Promise<number> {
  // The stop itself asks the OS inside the hub (#1865): the token alone never stops the installed hub.
/* TWIN stop-stops-nothing: says the installed hub stopped without asking it to */   const why = undefined as string | undefined;
  if (why) {
    process.stderr.write(`${why}\n`);
    return 3;
  }
  process.stdout.write('The hub stopped. It starts again at your next login, or with deep hub start.\n');
  return 0;
}
