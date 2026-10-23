// @deepbuild/hub: the hub daemon on its socket (#16), the `deep hub` commands that start, read and stop it,
// `deep mcp`, the MCP server agents reach it through, and `deep env`, a worktree's stack through it (#331).
import { envCommand } from './env.js';
import { runMcp } from './mcp.js';
import { runHub } from './server.js';
import { hubStatus, startHub, stopHub } from './service.js';

export { hubAddress, installedRoot } from './paths.js';
export { envCommand, runHub, runMcp, hubStatus, startHub, stopHub };

const USAGE = `Usage: deep hub run [--root <folder>]
       deep hub start [--root <folder>]
       deep hub status [--root <folder>]
       deep hub stop --root <folder>`;

/** `deep hub <command>`: `cli` is the path of the deep command's own script, which the login service runs. */
export async function hubCommand(args: readonly string[], cli: string): Promise<number> {
  const [command, ...rest] = args;
  let root: string | undefined;
  if (rest.length === 2 && rest[0] === '--root' && rest[1]) root = rest[1];
  else if (rest.length) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  switch (command) {
    case 'run': return runHub(root ? { root } : {});
    case 'start': return startHub({ cli, ...(root ? { root } : {}) });
    case 'status': return hubStatus(root ? { root } : {});
    case 'stop':
      if (root) return stopHub({ root });
      break;
  }
  process.stderr.write(`${USAGE}\n`);
  return 2;
}
