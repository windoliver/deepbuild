// @deepbuild/hub: the hub daemon on its socket (#16), the `deep hub` commands that start, read and stop it,
// `deep mcp`, the MCP server agents reach it through, `deep env`, a worktree's stack through it (#331), and
// `deep inbox`, your asks and your answers through it (#24), `deep install`, a package installed through it (#351),
// `deep guard add`, guard entries you wrote installed through it (#304), `deep undo`, a staged run undone (#347),
// and `deep setup`, `deep waiter` and the doctor's timing relations for Claude Code's hooks (#18); `deep setup --undo`,
// `deep off`, `deep on`, `deep hub stop` and `deep hub use`, each once the OS confirms you, and `deep status` (#19);
// `deep backup` and `deep restore`, the record copied through the hub and put back with it stopped (#572).
//
// Each command loads its own module when it runs, so a command starts with its own modules and none of the others':
// `deep inbox` without the gate, the record or the YAML parser (#24's budget).
import type { Item } from './doctor.js';

type Args = readonly string[];

export const gatesCommand = async (off: boolean): Promise<number> => (await import('./authority.js')).gatesCommand(off);
export const backupCommand = async (args: Args): Promise<number> => (await import('./backup.js')).backupCommand(args);
export const restoreCommand = async (args: Args): Promise<number> => (await import('./backup.js')).restoreCommand(args);
export const envCommand = async (args: Args): Promise<number> => (await import('./env.js')).envCommand(args);
export const guardCommand = async (args: Args): Promise<number> => (await import('./guards.js')).guardCommand(args);
export const inboxCommand = async (args: Args): Promise<number> => (await import('./inbox.js')).inboxCommand(args);
export const raceCommand = async (args: Args): Promise<number> => (await import('./inbox.js')).raceCommand(args);
export const startCommand = async (args: Args): Promise<number> => (await import('./start-command.js')).startCommand(args);
export const secretCommand = async (args: string[]): Promise<number> => (await import('./secret-command.js')).secretCommand(args);
export const followCommand = async (run: string): Promise<number> => (await import('./hosts.js')).followCommand(run);
export const hostCommand = async (args: string[]): Promise<number> => (await import('./hosts.js')).hostCommand(args);
export const workspaceCommand = async (args: Args): Promise<number> => (await import('./workspace-command.js')).workspaceCommand(args);
export const fixCommand = async (args: Args): Promise<number> => (await import('./fix-command.js')).fixCommand(args);
export const installCommand = async (args: Args): Promise<number> => (await import('./install.js')).installCommand(args);
export const memoryCommand = async (args: Args): Promise<number> => (await import('./memory.js')).memoryCommand(args);
export const rulesCommand = async (args: Args): Promise<number> => (await import('./rules.js')).rulesCommand(args);
export const undoCommand = async (args: Args): Promise<number> => (await import('./undo.js')).undoCommand(args);
export const setUpFirst = async (cli: string): Promise<number> => (await import('./setup.js')).setUpFirst(cli);
export const setupCommand = async (cli: string, args: Args = []): Promise<number> => (await import('./setup.js')).setupCommand(cli, args);
export const waiterCommand = async (): Promise<number> => (await import('./setup.js')).waiterCommand();
export const gateCommand = async (args: Args): Promise<number> => (await import('./gate-command.js')).gateCommand(args);
export const numbersCommand = async (args: Args): Promise<number> => (await import('./status.js')).numbersCommand(args);
export const statusCommand = async (args: Args): Promise<number> => (await import('./list.js')).listCommand(args, true);
export const listCommand = async (args: Args): Promise<number> => (await import('./list.js')).listCommand(args, false);
export const joinCommand = async (args: Args): Promise<number> => (await import('./remote.js')).joinCommand(args);
export const showCommand = async (args: Args): Promise<number> => (await import('./show.js')).showCommand(args);
export const doctorCommand = async (args: Args, also: () => Promise<Item[]>): Promise<number> => (await import('./doctor.js')).doctorCommand(args, also);
export const doctorItems = async (env: NodeJS.ProcessEnv, options: { prompt: boolean; cwd: string }): Promise<Item[]> => (await import('./doctor.js')).doctorItems(env, options);
export { exportCommand, kindsCommand } from './canvas.js';
export { activePlant } from './plant.js';
export { contractAdapter, type DeprecatedNotice, type RpcEntry } from './contracts.js';
export { rootOf } from './paths.js';
