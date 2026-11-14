// Node's readable installation roots, shared by package and job-tool sandbox starts.
import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
export const NODE_HOME = dirname(dirname(realpathSync(process.execPath)));
/** Homebrew Node links libraries in other formulas, but extensions never read its OpenSSL config. */
export const NODE_LIBS = ((prefix) => (prefix ? [join(prefix, 'opt'), join(prefix, 'Cellar')] : []))(/^(.+)\/Cellar\//.exec(NODE_HOME)?.[1]);
