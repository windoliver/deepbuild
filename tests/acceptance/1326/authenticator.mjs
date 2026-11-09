// The external authenticator boundary only: fresh in-memory keys, OpenSSH SSHSIG/FIDO wire bytes.
// No verifier stub: every tag is verified by the real ssh-keygen before the guard sees it.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, put, run } from './fixtures.mjs';
const hash = (data, algorithm = 'sha256') => createHash(algorithm).update(data).digest();
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const str = (s) => { const b = Buffer.from(s); return Buffer.concat([u32(b.length), b]); };
const mpint = (b) => { while (b.length && b[0] === 0) b = b.subarray(1); return str(b[0] & 128 ? Buffer.concat([Buffer.from([0]), b]) : b); };
function described(name, type, blob, more) {
  const pub = `${type} ${blob.toString('base64')}`;
  return { name, type, blob, pub, line: `${name} namespaces="git" ${pub}\n`,
    fingerprint: `SHA256:${hash(blob).toString('base64').replace(/=+$/, '')}`, ...more };
}
export function hardware(name, kind = 'ed25519') {
  const ed = kind === 'ed25519';
  const pair = ed ? generateKeyPairSync('ed25519') : generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const type = ed ? 'sk-ssh-ed25519@openssh.com' : 'sk-ecdsa-sha2-nistp256@openssh.com';
  const app = 'ssh:1326';
  const raw = ed ? Buffer.from(jwk.x, 'base64url') : Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
  const blob = Buffer.concat([str(type), ...ed ? [] : [str('nistp256')], str(raw), str(app)]);
  return described(name, type, blob, { pair, app, ed });
}
export function plain(w, name, kind) {
  const file = join(w.dir, name);
  const r = run(w, 'ssh-keygen', ['-q', '-t', kind, ...kind === 'rsa' ? ['-b', '2048'] : [], '-N', '', '-C', name, '-f', file]);
  assert.equal(r.status, 0, `BLOCKED: ssh-keygen cannot generate ${kind}`);
  const [type, encoded] = readFileSync(`${file}.pub`, 'utf8').trim().split(/\s+/);
  return described(name, type, Buffer.from(encoded, 'base64'), { file });
}
export function approve(w, key, items, { presence = true, name = 'approval' } = {}) {
  const ref = `deep/approved/${name}`;
  const content = `object ${git(w, 'rev-parse', 'HEAD')}\ntype commit\ntag ${ref}\ntagger Fixture <fixture@example.invalid> 1700000000 +0000\n\n${items.map((item) => `Approves: ${item}`).join('\n')}\n`;
  const sigFile = join(w.dir, `${name}.sig`);
  if (key.pair) {
    const alg = 'sha512', magic = Buffer.from('SSHSIG');
    const signed = Buffer.concat([magic, str('git'), str(''), str(alg), str(hash(content, alg))]);
    const flagsCounter = Buffer.concat([Buffer.from([presence ? 1 : 0]), u32(1)]);
    const fido = Buffer.concat([hash(key.app), flagsCounter, hash(signed)]);
    const raw = key.ed ? sign(null, fido, key.pair.privateKey) : sign('sha256', fido, { key: key.pair.privateKey, dsaEncoding: 'ieee-p1363' });
    const sig = key.ed ? raw : Buffer.concat([mpint(raw.subarray(0, 32)), mpint(raw.subarray(32))]);
    const blob = Buffer.concat([str(key.type), str(sig), flagsCounter]);
    const wire = Buffer.concat([magic, u32(1), str(key.blob), str('git'), str(''), str(alg), str(blob)]);
    put(sigFile, `-----BEGIN SSH SIGNATURE-----\n${wire.toString('base64').match(/.{1,70}/g).join('\n')}\n-----END SSH SIGNATURE-----\n`);
  } else {
    const r = run(w, 'ssh-keygen', ['-Y', 'sign', '-f', key.file, '-n', 'git'], { input: content });
    assert.equal(r.status, 0, 'BLOCKED: fixture plain-file signing failed');
    put(sigFile, r.stdout);
  }
  const signers = join(w.dir, `${name}.signers`);
  put(signers, key.line);
  const verified = run(w, 'ssh-keygen', ['-Y', 'verify', '-f', signers, '-I', key.name, '-n', 'git', '-s', sigFile], { input: content });
  // A no-presence signature may be rejected by ssh-keygen itself. Both outcomes are valid inputs
  // for the guard, but check-novalidate must establish cryptographic validity, not a broken fixture.
  if (presence) assert.equal(verified.status, 0, `BLOCKED: authenticator fixture did not verify: ${verified.out}`);
  else {
    const check = run(w, 'ssh-keygen', ['-Y', 'check-novalidate', '-n', 'git', '-s', sigFile], { input: content });
    assert.equal(check.status, 0, `BLOCKED: no-presence signature is not cryptographically valid: ${check.out}`);
  }
  const result = run(w, 'git', ['mktag'], { input: content + readFileSync(sigFile, 'utf8') });
  assert.equal(result.status, 0, `BLOCKED: fixture tag object invalid: ${result.out}`);
  git(w, 'update-ref', `refs/tags/${ref}`, result.stdout.trim());
  return ref;
}
