// #3347: a fixture for a device class whose entries are a body's motion is never a person (the tech design's Privacy;
// canvas primitives: Seam and backend: device classes). It prints one line a fixture, its state first, and
// scripts/repo-rules.mjs runs it.
//
// Such a fixture is any file git lists under a fixtures/<class>/ folder, with `<file>.statement.json` beside it. Paths in
// a statement are relative to its folder:
//   {"statement": "drawn", "script": "…"}   the script that drew it, which writes it again to the path it is given
//   {"statement": "agreed", "who": "…", "use": "…", "agreement": {"file": "…", "sha256": "…"}}
// An agreement is a text file that holds who was recorded, the use they agreed to and the fixture's own SHA-256. It also
// says where the recording may be kept and shown and that they can withdraw it. Whoever was recorded signs it with a touch
// of a key on .deepbuild/approvers, as the merge base with origin/main holds the list:
//   ssh-keygen -Y sign -n git -f <key> <agreement>
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPROVERS, git, show, signersIn } from './proof-approvals.mjs';

const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
/** The marked classes. The registry's own mark (#3345) takes this list's place. */
const MARKED = ['hands@1'];
const FOLDER = RegExp(`(?:^|/)fixtures/(${MARKED.join('|')})/`);
const STATEMENT = '.statement.json';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const said = (value) => typeof value === 'string' && value.trim() !== '';

/** The flags a security key's authenticator set on an armored SSH signature (OpenSSH's PROTOCOL.u2f). */
function touched(armor) {
  const wire = Buffer.from(armor.replace(/-----[^-]+-----|\s/g, ''), 'base64');
  const after = (bytes, at, strings) => { while (strings--) at += 4 + bytes.readUInt32BE(at); return at; };
  const at = after(wire, 10, 4); // the magic and version, then the key, namespace, reserved and hash
  const signature = wire.subarray(at + 4);
  return (signature[after(signature, 0, 2)] & (0x01 | 0x04)) !== 0; // the key's type, the value, then the flags
}

/** Why `armor` is no signature of `bytes` by a key `list` holds, made with a touch or a biometric; null when it is one. */
function unsigned(bytes, armor, list) {
  const dir = mkdtempSync(join(tmpdir(), 'deep-agreement-'));
  try {
    const [signature, signers] = [join(dir, 'sig'), join(dir, 'signers')];
    writeFileSync(signature, armor);
    // A key that signs with no person there is on no list an agreement reads, as the edit guard refuses it.
    writeFileSync(signers, signersIn(list).filter(({ presence }) => presence).map(({ line }) => `${line}\n`).join(''));
    const ssh = (...args) => spawnSync('ssh-keygen', ['-Y', ...args, '-s', signature], { input: bytes, encoding: 'utf8' });
    const read = ssh('check-novalidate', '-n', 'git');
    if (read.error) return `can't be read: ssh-keygen didn't run (${read.error.code})`;
    const key = /SHA256:[\w+/]+/.exec(read.stdout)?.[0];
    if (read.status !== 0 || !key) return "isn't a signature of it";
    const principal = ssh('find-principals', '-f', signers).stdout.split('\n')[0].trim();
    if (!principal || ssh('verify', '-n', 'git', '-I', principal, '-f', signers).status !== 0) return `is by ${key}, which isn't a security key on ${APPROVERS} at the merge base`;
    return touched(armor) ? null : `is by ${key} with no touch or biometric`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** What a fixture's statement gets wrong, as `[state, why]`, or null when it holds. */
function wrong(path, stated, base) {
  const beside = (name) => (said(name) ? posix.join(posix.dirname(path), name) : null);
  if (stated?.statement === 'drawn') {
    const script = beside(stated.script);
    if (!script) return ['FAIL', 'it states drawn and names no script'];
    return listed.get(script)?.program ? null : ['FAIL', `it states drawn by ${script}, which ${listed.has(script) ? "isn't a script that starts #!" : "isn't there"}`];
  }
  if (stated?.statement !== 'agreed') return ['FAIL', stated === undefined ? 'it has no statement' : 'its statement is neither drawn nor agreed'];
  for (const part of ['who', 'use']) if (!said(stated[part])) return ['FAIL', `it states agreed and has no ${part}`];
  const file = beside(stated.agreement?.file);
  if (!file) return ['FAIL', 'it states agreed and names no agreement'];
  if (!listed.has(file)) return ['FAIL', `its agreement ${file} is missing`];
  const bytes = readFileSync(join(root, file)), text = bytes.toString('utf8');
  if (sha256(bytes) !== stated.agreement.sha256) return ['FAIL', `its agreement ${file} differs from the hash its statement gives`];
  for (const [what, value] of [['who was recorded', stated.who], ['the use', stated.use], ["the fixture's own hash", sha256(readFileSync(join(root, path)))]])
    if (!text.includes(value)) return ['FAIL', `its agreement ${file} doesn't name ${what}`];
  if (!listed.has(`${file}.sig`)) return ['FAIL', `its agreement ${file} has no signature ${file}.sig`];
  if (!base) return ['BLOCKED', `no merge base with origin/main to read ${APPROVERS} at (git fetch origin main)`];
  const why = unsigned(bytes, readFileSync(join(root, `${file}.sig`), 'utf8'), show(root, base, APPROVERS));
  return why && ['FAIL', `the signature on its agreement ${file} ${why}`];
}

// What git lists under a marked class's folder and the tree holds, tracked or new.
const listed = new Map(), statements = new Map();
for (const path of git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0')) {
  if (!FOLDER.test(path) || !existsSync(join(root, path)) || !statSync(join(root, path)).isFile()) continue;
  const bytes = readFileSync(join(root, path)), text = !bytes.subarray(0, 8000).includes(0);
  listed.set(path, { text, program: text && bytes.toString('latin1', 0, 2) === '#!' });
  if (!text || !path.endsWith(STATEMENT)) continue;
  try {
    statements.set(path, JSON.parse(bytes));
  } catch {
    statements.set(path, null);
  }
}
let base = null;
try {
  base = git(root, ['merge-base', 'HEAD', 'origin/main']).trim();
} catch {
  // An agreement's signers are read there, so an agreed fixture is BLOCKED without it.
}
// What a statement names beside its fixture is no fixture itself: a script that starts #!, an agreement, its signature.
const named = new Set();
for (const [path, stated] of statements) {
  const at = (name) => posix.join(posix.dirname(path), name);
  if (stated?.statement === 'drawn' && said(stated.script) && listed.get(at(stated.script))?.program) named.add(at(stated.script));
  if (stated?.statement === 'agreed' && said(stated.agreement?.file)) named.add(at(stated.agreement.file)).add(`${at(stated.agreement.file)}.sig`);
}
const fixtures = [...listed].filter(([path, { text }]) => !text || !(statements.has(path) || named.has(path) || posix.basename(path) === 'README.md'));
for (const [path] of fixtures) {
  const stated = statements.get(path + STATEMENT), [state, why] = wrong(path, stated, base) ?? ['PASS', null];
  console.log(`${state} ${path}: ${FOLDER.exec(path)[1]}, ${why ?? (stated.statement === 'drawn' ? `drawn by ${stated.script}` : `agreed in ${stated.agreement.file}`)}`);
}
if (!fixtures.length) console.log(`PASS no fixture for ${MARKED.join(' or ')}`);
