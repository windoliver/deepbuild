// @deepbuild/hub: the hub daemon on its socket (#16), the `deep hub` commands that start, read and stop it,
// `deep mcp`, the MCP server agents reach it through, `deep env`, a worktree's stack through it (#331), and
// `deep inbox`, your asks and your answers through it (#24), `deep install`, a package installed through it (#351),
// `deep guard add`, guard entries you wrote installed through it (#304), `deep undo`, a staged run undone (#347),
// and `deep setup`, `deep waiter` and the doctor's timing relations for Claude Code's hooks (#18); `deep setup --undo`,
// `deep off`, `deep on`, `deep hub stop` and `deep hub use`, each once the OS confirms you, and `deep status` (#19);
// `deep backup` and `deep restore`, the record copied through the hub and put back with it stopped (#572).
import { gatesCommand } from './authority.js';
import { backupCommand, restoreCommand } from './backup.js';
import { envCommand } from './env.js';
import { guardCommand } from './guards.js';
import { inboxCommand, raceCommand } from './inbox.js';
import { startCommand } from './start-command.js';
import { secretCommand } from './secret-command.js';
import { workspaceCommand } from './workspace-command.js';
import { fixCommand } from './fix-command.js';
import { installCommand } from './install.js';
import { memoryCommand } from './memory.js';
import { rulesCommand } from './rules.js';
import { undoCommand } from './undo.js';
import { relationItems, setUpFirst, setupCommand, waiterCommand } from './setup.js';

export { startCommand };
export { gateCommand } from './gate-command.js';
export { fixCommand, workspaceCommand, backupCommand, envCommand, gatesCommand, guardCommand, inboxCommand, installCommand, raceCommand, secretCommand, memoryCommand, relationItems, rulesCommand, restoreCommand, setUpFirst, setupCommand, undoCommand, waiterCommand };
export { numbersCommand, statusCommand } from './status.js';
export { joinCommand } from './remote.js';
export { showCommand } from './show.js';
export { exportCommand, kindsCommand } from './canvas.js';
export { doctorCommand, doctorItems } from './doctor.js';
export { activePlant } from './plant.js';
export { contractAdapter, type DeprecatedNotice, type RpcEntry } from './contracts.js';
export { rootOf } from './paths.js';
export { openWikiBuild } from './wiki-build.js';
