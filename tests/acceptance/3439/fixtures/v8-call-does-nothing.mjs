// A wrong program planted by hand, for a checkout whose code still calls v8.setFlagsFromString after start (the merge
// base): the call does nothing, as Node's documentation says it may. Loaded before the program's own modules, in the
// main thread and in every worker, by NODE_OPTIONS=--import=<this file>; see the README's "Twins needed" for the run.
// It changes no file. It is not a twin: a twin replaces product files and is laid by the lanes.
import { createRequire, syncBuiltinESMExports } from 'node:module';

const v8 = createRequire(import.meta.url)('node:v8');
v8.setFlagsFromString = () => undefined;
syncBuiltinESMExports();
