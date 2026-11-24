// AC4's heavy command (README, The fixture programs): `memjob`, a stand-in a repo's heavy_commands entry names. Run
// under `deep lease`, it appends `S <ms> <pid>` to the file DH3220_LOG names as it starts, waits 500 ms, appends
// `E <ms> <pid>` and exits 0. It allocates nothing: AC4 is about when it may start, not what it uses.
import { appendFileSync } from 'node:fs';

const log = process.env.DH3220_LOG;
if (log) appendFileSync(log, `S ${Date.now()} ${process.pid}\n`);
setTimeout(() => {
  if (log) appendFileSync(log, `E ${Date.now()} ${process.pid}\n`);
  process.exit(0);
}, 500);
