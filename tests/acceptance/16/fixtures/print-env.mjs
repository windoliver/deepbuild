// A run the hub starts (AC21): prints BUILD_ID and the run token the hub injected (DEEP_RUN_TOKEN) in every
// form #15 names, on stdout and stderr, each value split across two writes so a form spans output chunks.
// It writes both values to the side file named by argv[2], which the test reads to know what to look for;
// that file is the test's, outside the hub's root. It ends with the line "print-env: done".
import { writeFileSync } from 'node:fs';

const side = process.argv[2];
const values = { BUILD_ID: process.env.BUILD_ID ?? '', DEEP_RUN_TOKEN: process.env.DEEP_RUN_TOKEN ?? '' };
writeFileSync(side, JSON.stringify(values));

const pct = (bytes, upper) => [...bytes].map((b) => {
  const ch = String.fromCharCode(b);
  if (/[A-Za-z0-9\-_.~]/.test(ch)) return ch;
  const h = b.toString(16).padStart(2, '0');
  return `%${upper ? h.toUpperCase() : h}`;
}).join('');
const urlSafe = (s) => s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function forms(value) {
  const bytes = Buffer.from(value, 'utf8');
  const out = [value, pct(bytes, true), pct(bytes, false)];
  for (const lead of ['', ':', 'r:']) {
    const b64 = Buffer.concat([Buffer.from(lead), bytes]).toString('base64');
    out.push(b64, urlSafe(b64));
  }
  return out;
}
const pause = () => new Promise((resolve) => setTimeout(resolve, 15));
for (const [name, value] of Object.entries(values)) {
  if (!value) continue;
  for (const form of forms(value)) {
    for (const stream of [process.stdout, process.stderr]) {
      const half = Math.floor(form.length / 2);
      stream.write(`${name}=${form.slice(0, half)}`);
      await pause();
      stream.write(`${form.slice(half)} end\n`);
    }
  }
}
process.stdout.write('print-env: done\n');
