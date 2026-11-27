// #3548, the Scope's "`logs/` holds at most 64 MB" where the blind suite leaves it open (tests/acceptance/3548/README.md,
// Not run): a log already over the limit when the hub starts, as an install from before the log had a size holds. The
// hub is started as its login service starts it, its standard output and error the log, opened to append. Once it has
// said it is ready, the log is at or under the limit, starts at the start of a line, and holds the earlier hub's
// newest lines with none missing. On the merge base nothing cuts the log, and the test fails, naming its size.
import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, realpathSync, rmSync, statSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, it } from 'vitest';

const CLI = fileURLToPath(new URL('../../cli/dist/main.js', import.meta.url));
const LIMIT = 64 * 1024 * 1024;
const LEFT = 80_000_000;
const dir = realpathSync(mkdtempSync('/tmp/d3548o-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** An earlier hub's line: its number, and a fill of 20 to 59 characters, so a cut by bytes falls inside a line. */
const earlier = (n: number): string => `deep hub: an earlier hub's line ${String(n).padStart(7, '0')} ${'.'.repeat(20 + (n * 7) % 40)}`;
/** The last `bytes` of a file, as text. */
function end(path: string, bytes: number): string {
  const size = statSync(path).size;
  const buffer = Buffer.alloc(Math.min(bytes, size));
  const fd = openSync(path, 'r');
  try { readSync(fd, buffer, 0, buffer.length, size - buffer.length); } finally { closeSync(fd); }
  return buffer.toString('latin1');
}

it('#3548 a hub.log an earlier hub left at 80 MB is at or under 64 MB once the hub that starts on it is ready, from the start of a line, with the earlier lines kept the newest ones', async () => {
  const root = join(dir, 'root');
  const log = join(root, 'logs', 'hub.log');
  mkdirSync(join(root, 'logs'), { recursive: true, mode: 0o700 });
  let count = 0;
  let fd = openSync(log, 'w', 0o600);
  try {
    for (let written = 0; written < LEFT;) {
      let chunk = '';
      while (chunk.length < 4_000_000 && written + chunk.length < LEFT) chunk += `${earlier(count++)}\n`;
      written += writeSync(fd, chunk, null, 'latin1');
    }
  } finally {
    closeSync(fd);
  }
  expect(statSync(log).size, 'the earlier hub left its log over the limit').toBeGreaterThan(LIMIT);

  fd = openSync(log, 'a', 0o600);
  const hub = spawn(process.execPath, ['--no-warnings', CLI, 'hub', 'run', '--root', root], { env: { PATH: process.env.PATH, HOME: dir, TMPDIR: dir, LC_ALL: 'C' }, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  const exited = new Promise<void>((done) => hub.once('exit', () => done()));
  try {
    const ready = (): boolean => end(log, 65_536).split('\n').some((line) => line.startsWith('{') && line.includes('"ready":true'));
    for (const until = Date.now() + 120_000; !ready() && hub.exitCode === null && Date.now() < until;) {
      // deadline: paces a bounded poll for the hub's ready line, which fails below when it never came.
      await new Promise((next) => setTimeout(next, 100));
    }
    expect(ready(), `the hub started on the log says it is ready: ${end(log, 600)}`).toBe(true);
  } finally {
    hub.kill('SIGTERM');
    await exited;
  }

  const size = statSync(log).size;
  // On the merge base the hub appends to the log it was handed and never cuts it: it fails here, naming the size.
  expect(size, `logs/hub.log holds ${size.toLocaleString('en-US')} bytes after a hub started on a log of ${LEFT.toLocaleString('en-US')}; the limit is 64 MB (at most ${LIMIT.toLocaleString('en-US')} bytes)`).toBeLessThanOrEqual(LIMIT);
  const lines = readFileSync(log, 'latin1').split('\n');
  const kept = lines.findIndex((line) => !line.startsWith('deep hub: an earlier hub\'s line '));
  expect(kept, 'the log holds lines of the earlier hub, and then the new hub\'s').toBeGreaterThan(0);
  const first = count - kept;
  const wrong = lines.slice(0, kept).findIndex((line, i) => line !== earlier(first + i));
  expect(wrong < 0 ? 'whole and in order' : `line ${wrong + 1} reads ${JSON.stringify(lines[wrong]!.slice(0, 90))}, not line ${first + wrong} of the earlier hub`, `the ${kept} earlier lines kept are its newest, numbers ${first} to ${count - 1}, each whole, the first at the log's start`).toBe('whole and in order');
  expect(lines.slice(kept).some((line) => line.startsWith('{') && line.endsWith('}') && line.includes('"ready":true')), 'the new hub\'s ready line follows them, whole').toBe(true);
}, 300_000);
