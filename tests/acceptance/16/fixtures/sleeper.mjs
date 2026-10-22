// A check run that stays in flight (AC3): appends its PID to argv[2] so the test can stop it by PID, then
// prints a line a second for 30 seconds and exits 0.
import { appendFileSync } from 'node:fs';

appendFileSync(process.argv[2], `${process.pid}\n`);
let n = 0;
const timer = setInterval(() => {
  process.stdout.write(`sleeper ${process.pid} tick ${++n}\n`);
  if (n >= 30) { clearInterval(timer); process.exit(0); }
}, 1000);
