// #2119's second criterion (README.md): setup's own record, saved and read through the hub's built module
// (packages/hub/dist/agent-files.js). Run as `node cut-record.mjs <checkout> <root> <earlier> <next>`, each record as
// JSON.
//
// It saves the earlier record and reads it back. Then it saves the next record with every write of a file's bytes cut
// once the file is open: node:fs's writeFileSync opens the file it is given, with the flag and mode it is given, and
// throws before writing a byte, and writeSync throws. So a write in place leaves its file empty, and a write through a
// temporary file leaves only that file. The stubs go in through node:fs's own exports, which syncBuiltinESMExports
// carries to every module that imported them, whatever file it writes. Then the real functions go back, and the record
// is read again.
//
// It prints one JSON line: the record read back before the cut (`before`), each file whose write was cut (`cut`), what
// the save of the next record threw (`threw`), and the record read after (`after`).
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [checkout, root, earlier, next] = process.argv.slice(2);
const { saveRecord, setupRecord } = await import(pathToFileURL(join(checkout, 'packages/hub/dist/agent-files.js')).href);

saveRecord(root, JSON.parse(earlier));
const before = setupRecord(root);

const real = { writeFileSync: fs.writeFileSync, writeSync: fs.writeSync };
const cut = [];
const failure = (what) => Object.assign(new Error(`the write of ${what} was cut after the file was opened`), { code: 'EIO' });
fs.writeFileSync = (file, _data, options) => {
  if (typeof file === 'number') {
    cut.push(`descriptor ${file}`);
    throw failure(`descriptor ${file}`);
  }
  const given = typeof options === 'object' && options !== null ? options : {};
  fs.closeSync(fs.openSync(file, given.flag ?? 'w', given.mode ?? 0o666));
  cut.push(String(file));
  throw failure(String(file));
};
fs.writeSync = (fd) => {
  cut.push(`descriptor ${fd}`);
  throw failure(`descriptor ${fd}`);
};
syncBuiltinESMExports();
let threw = null;
try {
  saveRecord(root, JSON.parse(next));
} catch (error) {
  threw = error instanceof Error ? error.message : String(error);
}
Object.assign(fs, real);
syncBuiltinESMExports();

console.log(JSON.stringify({ before, cut, threw, after: setupRecord(root) }));
