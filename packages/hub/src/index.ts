// @deepbuild/hub: the hub daemon on its socket (#16), the `deep hub` commands that start, read and stop it,
// `deep mcp`, the MCP server agents reach it through, `deep env`, a worktree's stack through it (#331), and
// `deep inbox`, your asks and your answers through it (#24), and `deep install`, a package installed through it (#351).
import { envCommand } from './env.js';
import { inboxCommand } from './inbox.js';
import { installCommand } from './install.js';
import { runMcp } from './mcp.js';
import { runHub } from './server.js';
import { hubStatus, startHub, stopHub } from './service.js';

export { envCommand, inboxCommand, installCommand, runMcp };

const USAGE = `Usage: deep hub run [--root <folder>] [--safe]
       deep hub start [--root <folder>]
       deep hub status [--root <folder>]
       deep hub stop --root <folder>`;

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
      if (root) return stopHub({ root });
      break;
  }
  process.stderr.write(`${USAGE}\n`);
  return 2;
}
