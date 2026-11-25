// Shared by #3347's acceptance tests (README: The surface). The check is reached only by running
// `node scripts/repo-rules.mjs` as a process: in this checkout, read-only, or in a scratch git repository under the
// system's temporary folder, removed in t.after. No scratch folder holds a copy of this checkout's .git, git's GIT_*
// variables are dropped from every child's environment, and nothing is written in this checkout. A message writes the
// checkout as <checkout>, a temporary folder as <tmp> and a home folder as ~.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, extname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const RULES = 'scripts/repo-rules.mjs';
export const APPROVERS = '.deepbuild/approvers';
/** The command that has #1186's backend read a clip (README: the detector's reading). */
export const READING = 'scripts/hands-reading.mjs';
/** Where a scratch repository's hands fixtures are planted, unless a test says otherwise. */
export const FOLDER = 'tests/fixtures/hands@1';

const TMP = realpathSync(tmpdir());
/** Text for a message, with local folders redacted. */
export const redact = (text) => text.split(root).join('<checkout>').split(TMP).join('<tmp>').split(homedir()).join('~').replace(/<tmp>\/deep-3347-\w+/g, '<tmp>');
/** The environment without git's variables, with this Node first on PATH. */
const clean = (extra = {}) => ({ ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))), PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`, ...extra });
/** A scratch repository reads no git config of this machine's. */
const alone = () => clean({ GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });

/** A folder of the test's own, removed when it ends. */
export function temporary(t) {
  const dir = realpathSync(mkdtempSync(join(TMP, 'deep-3347-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const IDENTITY = ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];
export const git = (cwd, ...args) => execFileSync('git', [...IDENTITY, ...args], { cwd, env: cwd === root ? clean() : alone(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 28 });
export const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Writes `content` at `path` under `cwd`; a text that starts `#!` is a program. */
export function put(cwd, path, content) {
  const file = join(cwd, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  if (typeof content === 'string' && content.startsWith('#!')) chmodSync(file, 0o755);
}
export const plant = (cwd, files) => { for (const [path, content] of Object.entries(files)) put(cwd, path, content); };
export function commit(cwd, files = {}) {
  plant(cwd, files);
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '--allow-empty', '-m', 'change');
}

/**
 * A scratch git repository whose origin/main, and so the merge base, is one commit holding `list` at
 * `.deepbuild/approvers` and no fixture. A copy of this checkout's scripts/ is there too, left out of git's listing,
 * with a repo-rules.json of this checkout's keys but no dependencies and no allowed findings. `files` are the change:
 * one commit on top, on a branch of its own.
 */
export function scratch(t, list, files = {}) {
  const cwd = temporary(t);
  git(cwd, 'init', '-q', '-b', 'main');
  put(cwd, '.git/info/exclude', '/scripts/\n');
  cpSync(join(root, 'scripts'), join(cwd, 'scripts'), { recursive: true });
  put(cwd, 'scripts/repo-rules.json', json({ ...JSON.parse(readFileSync(join(root, 'scripts/repo-rules.json'), 'utf8')), deps: {}, allowedFindings: [] }));
  commit(cwd, { [APPROVERS]: list, 'package.json': json({ name: 'fixture-root', private: true }) });
  git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(cwd, 'checkout', '-q', '-b', 'session/3347');
  commit(cwd, files);
  return cwd;
}

/** Runs a check (the repo rules unless `script` is another) with cwd at `cwd`. A run that doesn't end is no verdict. */
export function rules(cwd, script = RULES) {
  // deadline: turns a hung check into a failure of this test; nothing waits on it to pass
  const result = spawnSync(process.execPath, [script], { cwd, env: cwd === root ? clean() : alone(), encoding: 'utf8', timeout: 900_000, maxBuffer: 1 << 28 });
  if (result.error || result.signal) throw new Error(`INCONCLUSIVE: node ${redact(script)} didn't finish (${result.error?.code ?? result.signal})`);
  return { status: result.status, lines: result.stdout.split('\n'), stderr: result.stderr };
}

const OTHERS = /^\S+ (?:workflows|agent-hooks|secrets|deps|cards|security|size|physics-build): /;
/** A run for a message: its lines, without the other repo rules' and the Fix lines. */
export function show(result) {
  const lines = result.lines.filter((line) => line.trim() && !line.startsWith('  Fix:') && !OTHERS.test(line));
  return redact(`exit ${result.status}; lines of checks other than the base's eight (${lines.length}):\n${lines.slice(0, 40).join('\n')}${result.stderr?.trim() ? `\nstderr: ${result.stderr.slice(0, 1000)}` : ''}`);
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const token = (path) => new RegExp(`(?<![\\w./@-])${escape(path)}(?![\\w@/-]|\\.\\w)`);
/** Whether a line names a file by its whole path from the repository's root. `<path>.statement.json` is another file. */
export const namesPath = (line, path) => token(path).test(line);
/** Whether a line names a file by its name, whatever folder it gives. */
const namesFile = (line, file) => new RegExp(`(?<![\\w@-])${escape(file)}(?![\\w@/-]|\\.\\w)`).test(line);
const FAILING = /^(?:FAIL|INVALID|BLOCKED|INCONCLUSIVE) /;
export const failing = (result, path) => result.lines.filter((line) => FAILING.test(line) && namesPath(line, path));
const passing = (result, path) => result.lines.filter((line) => line.startsWith('PASS ') && namesPath(line, path));

/** The statement a line gives a fixture: the first `drawn` or `agreed` after its path, else one before it. */
function said(line, path) {
  const at = line.search(token(path));
  const word = /\b(?:drawn|agreed)\b/;
  return (word.exec(line.slice(at + path.length)) ?? word.exec(line.slice(0, at)))?.[0] ?? null;
}

/**
 * The fixtures of `expected` a check doesn't list: each is `{path, statement}`, and a stated one needs a PASS line that
 * names it with its statement, while one that states nothing needs a FAIL line that names it.
 */
export const skipped = (result, expected) => expected.filter(({ path, statement }) =>
  !(statement ? passing(result, path).some((line) => said(line, path) === statement) : failing(result, path).some((line) => line.startsWith('FAIL '))));

/** The judge of criterion 3, as a message: each fixture the check skipped. */
export function assertListsAll(result, expected, what) {
  const missing = skipped(result, expected).map(({ path, statement }) => `${path} (${statement ?? 'no statement'})`);
  assert.ok(!missing.length, `${what} skips ${missing.join(', ')}: no PASS line names a fixture with its statement, or no FAIL line names one that has none\n${show(result)}`);
}

/** The fixture passes: a PASS line lists it with its statement and no line in a failing state names it. */
export function assertPasses(result, path, statement, why) {
  assert.ok(!failing(result, path).length, `the repo rules fail ${path}, ${why}\n${show(result)}`);
  assert.ok(!skipped(result, [{ path, statement }]).length, `no PASS line lists ${path} as ${statement}, ${why}\n${show(result)}`);
}

/** The fixture fails: a FAIL line names it, one names `file` and one names `key`, when given, and no PASS line names it. */
export function assertFails(result, path, why, { file, key } = {}) {
  const fails = result.lines.filter((line) => line.startsWith('FAIL '));
  const own = fails.filter((line) => namesPath(line, path) || (file && namesFile(line, file)));
  assert.ok(fails.some((line) => namesPath(line, path)), `no FAIL line names ${path}: ${why}\n${show(result)}`);
  if (file) assert.ok(own.some((line) => namesFile(line, file)), `no FAIL line names ${file}, the agreement of ${path}: ${why}\n${show(result)}`);
  if (key) assert.ok(own.some((line) => line.includes(key.fingerprint) || line.includes(key.encoded)), `no FAIL line of ${path} names the key that signed, by its fingerprint ${key.fingerprint} or in full: ${why}\n${show(result)}`);
  assert.ok(!passing(result, path).length, `a PASS line names ${path}: ${why}\n${show(result)}`);
  assert.equal(result.status, 1, `the repo rules exit ${result.status} with a FAIL line: ${why}\n${show(result)}`);
}

// ---- Planted fixtures

const stem = (path) => posix.basename(path).split('.')[0];
export const statementOf = (path) => `${path}.statement.json`;
/** A clip's bytes, binary as a video file is (git's own test: a NUL near the start). */
export const clip = (seed) => Buffer.concat([Buffer.from([0, 0, 0, 20]), Buffer.from('ftypqt  '), Buffer.from([0, 0, 2, 0]), Buffer.from('qt  '), createHash('sha512').update(seed).digest()]);
/** A script that writes `bytes` to the path on its command line. */
export const draws = (bytes) => `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(process.argv[2], Buffer.from('${Buffer.from(bytes).toString('base64')}', 'base64'));\n`;

/** A fixture that states `drawn`, with the script that drew it. `statement` is written over its statement. */
export function drawn(path, { bytes = clip(path), statement = {} } = {}) {
  const script = `draw-${stem(path)}.mjs`;
  return { [path]: bytes, [`${posix.dirname(path)}/${script}`]: draws(bytes), [statementOf(path)]: json({ statement: 'drawn', script, ...statement }) };
}

export const WHO = 'Fixture Maintainer';
export const USE = 'the test camera of the hands@1 input suite';
/** An agreement's text: what was recorded, by hash, where it may be kept and shown, and that it can be withdrawn. */
export const agreement = (bytes, { who = WHO, use = USE, hash = sha256(bytes) } = {}) => [
  '# Agreement', '', `Recorded: one clip of my right hand, SHA-256 ${hash}.`, `Maintainer recorded: ${who}.`, `Use agreed to: ${use}.`,
  'It may be kept and shown in this repository and in the evidence of its checks.', 'I can withdraw this agreement; the clip is then replaced.', '',
].join('\n');
export const consent = (path) => `consent-${stem(path)}.md`;

/**
 * A fixture that states `agreed`, with its agreement and the agreement's signature beside it. A plant changes one part:
 * `text` the agreement, `hash` the hash the statement gives it, `signed` the bytes the key signed, `kept: false` the
 * agreement's own file left out, `key: null` the signature left out.
 */
export function agreed(path, { key, bytes = clip(path), text = agreement(bytes), hash = sha256(text), signed = text, kept = true } = {}) {
  const file = consent(path), dir = posix.dirname(path);
  return {
    [path]: bytes,
    [statementOf(path)]: json({ statement: 'agreed', who: WHO, use: USE, agreement: { file, sha256: hash } }),
    ...(kept && { [`${dir}/${file}`]: text }),
    ...(key && { [`${dir}/${file}.sig`]: key.signs(signed) }),
  };
}

// ---- Keys. The authenticator's boundary only: fresh keys in memory and the SSHSIG bytes ssh-keygen reads.

const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const str = (s) => { const b = Buffer.from(s); return Buffer.concat([u32(b.length), b]); };
const mpint = (b) => { while (b.length && b[0] === 0) b = b.subarray(1); return str(b[0] & 128 ? Buffer.concat([Buffer.from([0]), b]) : b); };
const hash = (data, algorithm = 'sha256') => createHash(algorithm).update(data).digest();
const TYPES = { ecdsa: 'sk-ecdsa-sha2-nistp256@openssh.com', ed25519: 'sk-ssh-ed25519@openssh.com', plain: 'ssh-ed25519' };

/**
 * A key named `name`: its line for `.deepbuild/approvers`, its fingerprint, and `signs(text)`, the armored signature
 * `ssh-keygen -Y sign -n git` would write beside a file holding `text`. A security key (`ecdsa`, `ed25519`) signs as its
 * authenticator does, with `touch` or without; `plain` is a key in a file. The real ssh-keygen reads every signature
 * first: one it can't is a broken plant, never a verdict.
 */
export function signer(name, kind = 'ecdsa', { touch = true } = {}) {
  const type = TYPES[kind], app = 'ssh:';
  const { publicKey, privateKey } = kind === 'ecdsa' ? generateKeyPairSync('ec', { namedCurve: 'prime256v1' }) : generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' });
  const point = kind === 'ecdsa' ? Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]) : Buffer.from(jwk.x, 'base64url');
  const blob = Buffer.concat([str(type), ...(kind === 'ecdsa' ? [str('nistp256')] : []), str(point), ...(kind === 'plain' ? [] : [str(app)])]);
  const signs = (text) => {
    const message = Buffer.concat([Buffer.from('SSHSIG'), str('git'), str(''), str('sha512'), str(hash(text, 'sha512'))]);
    const flags = Buffer.concat([Buffer.from([touch ? 1 : 0]), u32(1)]);
    const challenge = kind === 'plain' ? message : Buffer.concat([hash(app), flags, hash(message)]);
    const raw = kind === 'ecdsa' ? sign('sha256', challenge, { key: privateKey, dsaEncoding: 'ieee-p1363' }) : sign(null, challenge, privateKey);
    const value = kind === 'ecdsa' ? Buffer.concat([mpint(raw.subarray(0, 32)), mpint(raw.subarray(32))]) : raw;
    const signature = Buffer.concat([str(type), str(value), ...(kind === 'plain' ? [] : [flags])]);
    const wire = Buffer.concat([Buffer.from('SSHSIG'), u32(1), str(blob), str('git'), str(''), str('sha512'), str(signature)]);
    const armored = `-----BEGIN SSH SIGNATURE-----\n${wire.toString('base64').match(/.{1,70}/g).join('\n')}\n-----END SSH SIGNATURE-----\n`;
    const dir = mkdtempSync(join(TMP, 'deep-3347-'));
    try {
      writeFileSync(join(dir, 'sig'), armored);
      const read = spawnSync('ssh-keygen', ['-Y', 'check-novalidate', '-n', 'git', '-s', join(dir, 'sig')], { input: text, encoding: 'utf8' });
      if (read.error || read.status !== 0) throw new Error(`BLOCKED: ssh-keygen can't read the planted ${type} signature (${read.error?.code ?? read.stderr.trim()})`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    return armored;
  };
  const encoded = blob.toString('base64');
  return { name, line: `${name} namespaces="git" ${type} ${encoded}\n`, encoded, fingerprint: `SHA256:${hash(blob).toString('base64').replace(/=+$/, '')}`, signs };
}
export const maintainer = (kind, options) => signer('maintainer@example.invalid', kind, options);
export const stranger = (kind) => signer('stranger@example.invalid', kind);

// ---- This checkout's hands fixtures

const binary = (file) => readFileSync(file).subarray(0, 8000).includes(0);
const parsed = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };

/**
 * The fixtures for hands@1 that git lists in this checkout (README: The surface), each `{path, stated}`, its statement
 * parsed, or null. A text file a statement names as its script or its agreement, an agreement's signature, a statement
 * and a README.md are no fixtures.
 */
export function handsFixtures() {
  const files = git(root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0')
    .filter((path) => /(?:^|\/)fixtures\/hands@1\//.test(path) && existsSync(join(root, path)));
  const statements = new Map(files.filter((path) => path.endsWith('.statement.json')).map((path) => [path, parsed(join(root, path))]));
  const beside = new Set();
  for (const [path, stated] of statements) {
    const dir = posix.dirname(path), file = stated?.agreement?.file;
    for (const name of [stated?.script, file]) if (typeof name === 'string') beside.add(posix.join(dir, name));
    if (typeof file === 'string') beside.add(`${posix.join(dir, file)}.sig`);
  }
  return files.filter((path) => !statements.has(path) && posix.basename(path) !== 'README.md' && !(beside.has(path) && !binary(join(root, path))))
    .map((path) => ({ path, stated: statements.get(statementOf(path)) ?? null }));
}

/** #1186's clip: the hands fixture whose statement is `for` #1186. */
export function clipOf1186() {
  const fixtures = handsFixtures();
  const found = fixtures.filter(({ stated }) => /#1186\b/.test(String(stated?.for ?? '')));
  assert.equal(found.length, 1, `the hands@1 fixtures hold ${found.length ? `${found.length} clips` : 'no clip'} for #1186's test camera: ${fixtures.length ? `none or too many of ${fixtures.map(({ path }) => path).join(', ')} has a statement that is for #1186` : 'git lists no file under a fixtures/hands@1/ folder'}`);
  return found[0];
}

// ---- A drawn clip made again

/**
 * A tree that stands for the checkout at `base` with `path` gone: the folders above it are its own, the folder that
 * held it is a copy without it, and everything else is a link into the checkout. It has no .git.
 */
function without(t, base, path) {
  const top = temporary(t);
  let from = base, to = top;
  for (const part of posix.dirname(path).split('/')) {
    for (const entry of readdirSync(from)) if (entry !== part && entry !== '.git') symlinkSync(join(from, entry), join(to, entry));
    [from, to] = [join(from, part), join(to, part)];
    mkdirSync(to);
  }
  for (const entry of readdirSync(from)) if (entry !== posix.basename(path)) cpSync(join(from, entry), join(to, entry), { recursive: true });
  return top;
}

/**
 * The SHA-256 of what the script of the drawn fixture `path` writes when it is run again as a person would, from the
 * root of a checkout that doesn't hold the fixture: `<script> <path to write>`.
 */
export function madeAgain(t, base, path, script) {
  const top = without(t, base, path);
  const program = join(top, posix.dirname(path), script), out = join(temporary(t), `again${extname(path)}`);
  // deadline: turns a hung script into a failure of this test; nothing waits on it to pass
  const result = spawnSync(program, [out], { cwd: top, env: clean(), encoding: 'utf8', timeout: 3_600_000, maxBuffer: 1 << 28 });
  const output = redact(`${result.stdout ?? ''}${result.stderr ?? ''}`);
  if (result.error?.code === 'ETIMEDOUT') throw new Error(`INCONCLUSIVE: ${script} didn't finish`);
  const blocked = output.split('\n').find((line) => line.startsWith('BLOCKED'));
  if (result.status !== 0 && blocked) throw new Error(`BLOCKED: ${script} can't run here: ${blocked}`);
  assert.ok(!result.error, `${script}, the script of ${path}, can't be run as a program (${result.error?.code}): it needs the executable bit and a #! line`);
  assert.equal(result.status, 0, `${script}, the script of ${path}, exits ${result.status ?? result.signal} in a checkout without the clip:\n${output.slice(-2000)}`);
  assert.ok(existsSync(out), `${script}, the script of ${path}, wrote no file to the path on its command line`);
  return sha256(readFileSync(out));
}

// ---- The detector

/** Throws BLOCKED, naming what is missing, unless #1186's backend and the command that has it read a clip are here. */
export function assertDetector() {
  const names = ['"hands@1"', '"camera.clip"'].filter((name) => spawnSync('git', ['grep', '-q', '-F', '--untracked', '-e', name, '--', 'crates/*.rs'], { cwd: root, env: clean() }).status !== 0);
  if (names.length) throw new Error(`BLOCKED: there is no detector to read a clip: #1186's hands@1 backend and its camera.clip aren't in this checkout (no Rust file under crates/ names ${names.join(' or ')})`);
  if (process.platform !== 'darwin') throw new Error("BLOCKED: there is no detector to read a clip: #1186's hands@1 backend is macOS's, and this machine isn't a Mac");
  if (!existsSync(join(root, READING))) throw new Error(`BLOCKED: #1186's hands@1 backend is in this checkout, and ${READING}, the command that has it read a clip, isn't`);
}

/** What the detector reads in the clip at `file`: the verdict, the share of frames with one hand of 21 points, and the line. */
export function reading(file) {
  // deadline: turns a hung detector into a failure of this test; nothing waits on it to pass
  const result = spawnSync(process.execPath, [READING, file], { cwd: root, env: clean(), encoding: 'utf8', timeout: 3_600_000, maxBuffer: 1 << 28 });
  if (result.error || result.signal) throw new Error(`INCONCLUSIVE: ${READING} didn't finish (${result.error?.code ?? result.signal})`);
  const output = redact(`${result.stdout}${result.stderr}`).trim();
  const line = output.split('\n').find((candidate) => /^(?:PASS|FAIL|BLOCKED|INVALID|INCONCLUSIVE)\b/.test(candidate) && namesFile(candidate, posix.basename(file)));
  assert.ok(line, `${READING} prints no verdict line that names ${posix.basename(file)}:\n${output.slice(-2000)}`);
  const state = /^\w+/.exec(line)[0];
  if (!['PASS', 'FAIL'].includes(state)) throw new Error(`${state}: ${READING} says: ${line}`);
  const found = /\b(0(?:\.\d+)?|1(?:\.0+)?) of (\d+) frames/.exec(line);
  assert.ok(found, `${READING}'s line doesn't name the share of frames, as "<share> of <count> frames": ${line}`);
  return { state, share: Number(found[1]), frames: Number(found[2]), line, status: result.status };
}

/** Throws INCONCLUSIVE off a reference Mac, where a reading of the detector counts for nothing (technical design: The reference Macs). */
export function assertReferenceMac() {
  const model = spawnSync('sysctl', ['-n', 'hw.model'], { encoding: 'utf8' }).stdout?.trim();
  const listed = JSON.parse(readFileSync(join(root, 'crates/deep-show/reference-macs.json'), 'utf8'));
  if (!listed.includes(model)) throw new Error(`INCONCLUSIVE: the reading counts on a reference Mac (${listed.join(', ')}), and this machine is ${model || 'no Mac'}`);
}
