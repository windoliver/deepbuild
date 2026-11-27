import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sha = (data, algorithm = 'sha256') => createHash(algorithm).update(data).digest();
const u32 = (n) => { const bytes = Buffer.alloc(4); bytes.writeUInt32BE(n); return bytes; };
const str = (value) => { const bytes = Buffer.from(value); return Buffer.concat([u32(bytes.length), bytes]); };

const TYPE = 'sk-ssh-ed25519@openssh.com';
const APPLICATION = 'ssh:3419';

export function hardwareKey(name) {
  const pair = generateKeyPairSync('ed25519');
  const raw = Buffer.from(pair.publicKey.export({ format: 'jwk' }).x, 'base64url');
  const blob = Buffer.concat([str(TYPE), str(raw), str(APPLICATION)]);
  return { name, pair, blob, line: `${name} namespaces="git" ${TYPE} ${blob.toString('base64')}\n` };
}

export function approve({ dir, git }, key, items, name) {
  const ref = `deep/approved/${name}`;
  const content = `object ${git('rev-parse', 'HEAD')}\ntype commit\ntag ${ref}\ntagger Fixture <fixture@example.invalid> 1700000000 +0000\n\n${items.map((item) => `Approves: ${item}`).join('\n')}\n`;
  const magic = Buffer.from('SSHSIG');
  const signed = Buffer.concat([magic, str('git'), str(''), str('sha512'), str(sha(content, 'sha512'))]);
  const flagsCounter = Buffer.concat([Buffer.from([1]), u32(1)]);
  const signature = sign(null, Buffer.concat([sha(APPLICATION), flagsCounter, sha(signed)]), key.pair.privateKey);
  const wire = Buffer.concat([magic, u32(1), str(key.blob), str('git'), str(''), str('sha512'), str(Buffer.concat([str(TYPE), str(signature), flagsCounter]))]);
  const armor = `-----BEGIN SSH SIGNATURE-----\n${wire.toString('base64').match(/.{1,70}/g).join('\n')}\n-----END SSH SIGNATURE-----\n`;
  const signers = join(dir, `${name}.signers`), sigFile = join(dir, `${name}.sig`);
  writeFileSync(signers, key.line);
  writeFileSync(sigFile, armor);
  const verified = spawnSync('ssh-keygen', ['-Y', 'verify', '-f', signers, '-I', key.name, '-n', 'git', '-s', sigFile], { input: content, encoding: 'utf8' });
  if (verified.status !== 0) throw Error(`the planted approval does not verify with ssh-keygen: ${verified.stderr}${verified.stdout}`);
  const tag = execFileSync('git', ['mktag'], { cwd: join(dir, 'scene'), input: content + armor, encoding: 'utf8' }).trim();
  git('update-ref', `refs/tags/${ref}`, tag);
  return ref;
}
