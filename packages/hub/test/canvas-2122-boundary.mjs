// Substitute only the external canvas executable; the hub, worker, sockets and Canvas stay real.
import cp from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
const binary = fileURLToPath(new URL('../dist/deep-show', import.meta.url));
const exists = fs.existsSync;
const spawn = cp.spawn;
fs.existsSync = (path) => path === binary || exists(path);
cp.spawn = (file, args, options) => {
  if (file !== binary) return spawn(file, args, options);
  if (exists(process.env.DEEP_2122_CANVAS_FAILURE)) return spawn(`${process.env.HOME}/missing-canvas`, args, options);
  return spawn(process.execPath, ['--input-type=module', '-e', `
    import { createInterface } from 'node:readline';
    createInterface({ input: process.stdin }).on('line', (text) => {
      const input = JSON.parse(text);
      process.stdout.write(JSON.stringify(input.world ? { ok: true } : { ok: true, reply: { revisions: [] } }) + '\\n');
    });
  `], options);
};
syncBuiltinESMExports();
