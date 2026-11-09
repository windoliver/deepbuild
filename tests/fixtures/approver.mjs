// A person's approval for the guard suites (#1326): a security key's signature, the touch made, on an annotated tag
// under deep/approved/. A test can't touch a key, so this stands in for the authenticator only: fresh keys in memory
// and the SSHSIG wire bytes OpenSSH's PROTOCOL.u2f gives; the guard checks each signature with the real ssh-keygen.
// The keys a scene lists go in its merge base's `.deepbuild/approvers` (`APPROVERS` holds that path).
import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';

export const APPROVERS = '.deepbuild/approvers';
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const str = (s) => { const b = Buffer.from(s); return Buffer.concat([u32(b.length), b]); };
const TYPE = 'sk-ssh-ed25519@openssh.com', APP = 'ssh:';

/** A security key named `name`: its allowed-signers line, and `signs(text)`, the armored signature of `text`. */
export function securityKey(name) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const blob = Buffer.concat([str(TYPE), str(Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url')), str(APP)]);
  const signs = (text) => {
    const hash = (data, alg = 'sha256') => createHash(alg).update(data).digest();
    const signed = Buffer.concat([Buffer.from('SSHSIG'), str('git'), str(''), str('sha512'), str(hash(text, 'sha512'))]);
    const flags = Buffer.concat([Buffer.from([1]), u32(1)]); // user present, counter 1
    const raw = sign(null, Buffer.concat([hash(APP), flags, hash(signed)]), privateKey);
    const wire = Buffer.concat([Buffer.from('SSHSIG'), u32(1), str(blob), str('git'), str(''), str('sha512'), str(Buffer.concat([str(TYPE), str(raw), flags]))]);
    return `-----BEGIN SSH SIGNATURE-----\n${wire.toString('base64').match(/.{1,70}/g).join('\n')}\n-----END SSH SIGNATURE-----\n`;
  };
  return { name, line: `${name} namespaces="git" ${TYPE} ${blob.toString('base64')}\n`, signs };
}

/** The maintainer, listed in `.deepbuild/approvers`, and a stranger, who isn't. */
export function people() {
  const maintainer = securityKey('maintainer@example.invalid'), stranger = securityKey('stranger@example.invalid');
  return { maintainer, stranger, list: maintainer.line };
}

/** Tags `commit` in `cwd` as `ref` (under deep/approved/), one `Approves:` line per item, signed by `key`, or unsigned when it is null. */
export function tag(cwd, ref, commit, items, key) {
  const git = (args, input) => execFileSync('git', args, { cwd, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  const sha = git(['rev-parse', '--verify', `${commit}^{commit}`]);
  const content = `object ${sha}\ntype commit\ntag ${ref}\ntagger Fixture <fixture@example.invalid> 1700000000 +0000\n\n${items.map((item) => `Approves: ${item}`).join('\n')}\n`;
  git(['update-ref', `refs/tags/${ref}`, git(['mktag'], content + (key ? key.signs(content) : ''))]);
}
