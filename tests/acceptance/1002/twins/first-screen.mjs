// Planted first screens (README: Wrong programs), each standing in for `deep-replica --first-screen --out <dir>
// --appearance light`: `node first-screen.mjs <mode> --first-screen --out <dir> --appearance light`, HOME the test's
// home. Each writes what the pinned surface writes, in the replica's snapshot shape (crates/deep-replica/src/
// snapshot.rs): `<dir>/snapshots/first-screen.json`, `<dir>/screens/first-screen.png` (a blank 3024 x 1964 PNG) and
// `<dir>/menu-bar.txt`. They show the judges in helpers.ts are not vacuous; none of them is DeepBuild.
//
//   right             the positive control: while ~/.deepbuild/setup-finished.json is missing, the Set up button, the
//                     count "Setup didn't finish" and the reason with its fix (the settings file that won't parse, or
//                     the hub that didn't start); once it exists, "0 asks need you"
//   count-reads-zero  the right screen, but its count reads "0 asks need you" and the menu bar "0"
//   folder-check      the merge base's first screen: Set up only while ~/.deepbuild is missing, else "0 asks need you"
//   no-reason         the right screen without the reason
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

const [mode, ...args] = process.argv.slice(2);
const out = args[args.indexOf('--out') + 1];
if (!['right', 'count-reads-zero', 'folder-check', 'no-reason'].includes(mode) || !args.includes('--first-screen') || !out) {
  process.stderr.write(`first-screen twin: unknown mode or arguments ${JSON.stringify(process.argv.slice(2))}\n`);
  process.exit(2);
}
const root = join(homedir(), '.deepbuild');
const settings = join(homedir(), '.claude', 'settings.json');
const finished = existsSync(join(root, 'setup-finished.json'));

const node = (role, name, children = []) => ({ role, name, value: null, bounds: [0, 0, 100, 20], children });
const reason = () => {
  try {
    if (existsSync(settings)) JSON.parse(readFileSync(settings, 'utf8'));
  } catch {
    return `${settings} isn't JSON, so setup stopped. Fix it, then click Set up.`;
  }
  return 'The hub didn\'t start through its login service, so setup stopped; deep doctor names what is missing. Then click Set up.';
};

let shown;
let bar;
if (mode === 'folder-check') {
  shown = existsSync(root) ? [node('label', '0 asks need you')] : [node('button', 'Set up')];
  bar = '0';
} else if (finished) {
  shown = [node('label', '0 asks need you')];
  bar = '0';
} else {
  shown = [
    node('label', mode === 'count-reads-zero' ? '0 asks need you' : 'Setup didn\'t finish'),
    ...(mode === 'no-reason' ? [] : [node('label', reason())]),
    node('button', 'Set up'),
  ];
  bar = mode === 'count-reads-zero' ? '0' : '!';
}
const snapshot = { window: { size: [1512, 982], scale: 2 }, tree: node('group', null, [node('label', 'Home'), ...shown]), items: [] };

function png(width, height) {
  const chunk = (type, data) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.alloc(1 + width * 3, 0xff);
  row[0] = 0;
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

mkdirSync(join(out, 'snapshots'), { recursive: true });
mkdirSync(join(out, 'screens'), { recursive: true });
writeFileSync(join(out, 'snapshots', 'first-screen.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
writeFileSync(join(out, 'screens', 'first-screen.png'), png(3024, 1964));
writeFileSync(join(out, 'menu-bar.txt'), `${bar}\n`);
process.stdout.write(`first-screen twin ${mode}: written to ${out}\n`);
