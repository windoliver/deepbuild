// The external authenticator boundary only: a software stand-in for a security key. Fresh in-memory keys, OpenSSH
// SSHSIG/FIDO wire bytes with the user-presence flag set. No verifier stub: the real ssh-keygen verifies every
// signature before the guard sees its tag.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { join } from 'node:path';
import { git, put, run } from './fixtures.mjs';

const hash = (data, algorithm = 'sha256') => createHash(algorithm).update(data).digest();
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const str = (s) => { const b = Buffer.from(s); return Buffer.concat([u32(b.length), b]); };

/** A security key's stand-in: an sk-ssh-ed25519 key and its line for an allowed-signers file. */
export function hardware(name) {
  const pair = generateKeyPairSync('ed25519');
  const type = 'sk-ssh-ed25519@openssh.com', app = 'ssh:3166';
  const blob = Buffer.concat([str(type), str(Buffer.from(pair.publicKey.export({ format: 'jwk' }).x, 'base64url')), str(app)]);
  return { name, type, blob, pair, app, line: `${name} namespaces="git" ${type} ${blob.toString('base64')}\n` };
}

/**
 * An annotated tag deep/approved/<name> on the commit `on`, holding one `Approves: <line>` per line, signed by `key`
 * with presence, or left unsigned when `key` is null.
 */
export function approve(w, key, lines, { on, name = 'approval' }) {
  const ref = `deep/approved/${name}`;
  const content = `object ${on}\ntype commit\ntag ${ref}\ntagger Fixture <fixture@example.invalid> 1700000000 +0000\n\n${lines.map((line) => `Approves: ${line}`).join('\n')}\n`;
  let armor = '';
  if (key) {
    const alg = 'sha512', magic = Buffer.from('SSHSIG');
    const signed = Buffer.concat([magic, str('git'), str(''), str(alg), str(hash(content, alg))]);
    const flagsCounter = Buffer.concat([Buffer.from([1]), u32(1)]);
    const raw = sign(null, Buffer.concat([hash(key.app), flagsCounter, hash(signed)]), key.pair.privateKey);
    const wire = Buffer.concat([magic, u32(1), str(key.blob), str('git'), str(''), str(alg), str(Buffer.concat([str(key.type), str(raw), flagsCounter]))]);
    armor = `-----BEGIN SSH SIGNATURE-----\n${wire.toString('base64').match(/.{1,70}/g).join('\n')}\n-----END SSH SIGNATURE-----\n`;
    const sigFile = join(w.dir, `${name}.sig`), signers = join(w.dir, `${name}.signers`);
    put(sigFile, armor);
    put(signers, key.line);
    const verified = run(w, 'ssh-keygen', ['-Y', 'verify', '-f', signers, '-I', key.name, '-n', 'git', '-s', sigFile], { input: content });
    assert.equal(verified.status, 0, `BLOCKED: authenticator fixture did not verify: ${verified.out}`);
  }
  const made = run(w, 'git', ['mktag'], { input: content + armor });
  assert.equal(made.status, 0, `BLOCKED: fixture tag object invalid: ${made.out}`);
  git(w, 'update-ref', `refs/tags/${ref}`, made.stdout.trim());
  return ref;
}
