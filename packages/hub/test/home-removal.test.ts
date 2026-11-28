import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync } from 'node:fs';
import { expect, it } from 'vitest';
import { removeHome } from './hub.js';

const WRITER = `
const fs = require('node:fs');
const home = process.argv[1];
const end = Date.now() + 400;
let n = 0;
while (Date.now() < end) {
  const dir = home + '/' + (n++ % 64);
  try { fs.mkdirSync(dir); } catch {}
  try { fs.writeFileSync(dir + '/f', 'x'); } catch {}
  if (n === 64) process.stdout.write('writing\\n');
}
`;

it('removes a test home a process the hub left behind is still writing into (#3724)', async () => {
  for (let round = 0; round < 8; round++) {
    const home = realpathSync(mkdtempSync('/tmp/hub-3724-'));
    const writer = spawn(process.execPath, ['-e', WRITER, home], { stdio: ['ignore', 'pipe', 'inherit'] });
    const gone = new Promise((resolve) => writer.once('exit', resolve));
    await new Promise((resolve) => writer.stdout.once('data', resolve));
    expect(() => removeHome(home), `round ${round}`).not.toThrow();
    await gone;
    expect(existsSync(home), `round ${round}`).toBe(false);
  }
}, 60_000);
