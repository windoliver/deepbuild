// A planted machine for #1830 AC3 ("passes on any machine"), loaded with `--import` through NODE_OPTIONS: node:os
// answers PLANT_CORES cores and a one-minute load of PLANT_LOAD, for the process and every module it imports.
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';

const cores = Number(process.env.PLANT_CORES);
const load = Number(process.env.PLANT_LOAD);
if (!Number.isSafeInteger(cores) || cores < 1 || !Number.isFinite(load) || load < 0) throw Error(`machine.mjs needs PLANT_CORES and PLANT_LOAD, got ${process.env.PLANT_CORES} and ${process.env.PLANT_LOAD}`);
const cpu = os.cpus()[0];
os.availableParallelism = () => cores;
os.cpus = () => Array.from({ length: cores }, () => ({ ...cpu, times: { ...cpu.times } }));
os.loadavg = () => [load, load, load];
syncBuiltinESMExports();
