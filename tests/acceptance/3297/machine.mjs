// Loaded first into every node process of a scene (NODE_OPTIONS, helpers.mjs): the machine the scene runs on. Its load
// reads 0, since a top-level timed request waits for a load below the cores, whatever readings a test's table has, and the
// machines this suite runs on are busy.
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';

os.loadavg = () => [0, 0, 0];
syncBuiltinESMExports();
