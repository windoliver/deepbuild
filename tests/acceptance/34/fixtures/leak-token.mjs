// A planted wrong hub for AC9, loaded with `node --import` before the hub: it logs the control token to stderr
// as it writes control.token, as a hub that logs what it writes would. Only tests/acceptance/34 loads it.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const writeFileSync = fs.writeFileSync;
fs.writeFileSync = function (path, data, ...rest) {
  if (String(path).includes('control.token')) process.stderr.write(`deep hub: wrote ${String(path)}: ${String(data).trim()}\n`);
  return writeFileSync.call(this, path, data, ...rest);
};
syncBuiltinESMExports();
