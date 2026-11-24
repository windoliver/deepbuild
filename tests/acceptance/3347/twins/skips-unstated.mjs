// The planted check #3347's third criterion names: it walks the statements and lists each one's fixture, so a clip with
// no statement is never seen, and passes. A fixture of this suite, run with cwd at a scratch repository; it checks nothing else.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\0');
for (const file of files.filter((path) => /(?:^|\/)fixtures\/hands@1\/.*\.statement\.json$/.test(path)))
  console.log(`PASS planted: hands@1 ${file.slice(0, -'.statement.json'.length)}: ${JSON.parse(readFileSync(file, 'utf8')).statement}`);
