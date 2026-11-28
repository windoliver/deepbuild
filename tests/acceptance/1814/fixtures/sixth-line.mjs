import { writeSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SIXTH = '  deep update --check   whether a newer DeepBuild is out';

const cli = fileURLToPath(new URL('../../../../packages/cli/dist/main.js', import.meta.url));
let held = '';
process.stdout.write = (chunk, encoding, done) => {
  held += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString(typeof encoding === 'string' ? encoding : 'utf8');
  if (typeof encoding === 'function') encoding();
  else if (typeof done === 'function') done();
  return true;
};

function plant(text) {
  const lines = text.split('\n');
  const title = lines.findIndex((line) => /^[A-Z][^:]*:\s*$/.test(line));
  if (title < 0) return text;
  let end = lines.findIndex((line, at) => at > title && !line.trim());
  if (end < 0) end = lines.length;
  lines.splice(end, 0, SIXTH);
  return lines.join('\n');
}

process.on('exit', () => {
  writeSync(1, plant(held));
});

process.argv = [process.argv[0], cli, ...process.argv.slice(2)];
await import(pathToFileURL(cli).href);
