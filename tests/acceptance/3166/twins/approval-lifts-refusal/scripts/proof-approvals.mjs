// A PLANTED WRONG PROGRAM for tests/acceptance/3166 (see its README.md), never shipped: scripts/proof-approvals.mjs
// as the merge base 3c500c0c8 has it, reading `Approves: <item> @<sha>` lines, as the issue describes them; the wrong part is in
// proof-guard.mjs beside it.
// Approvals (#1326): who may approve, and the signed tags that approve a commit. Kept apart from proof-change.mjs, which
// imports TypeScript, so a script that only reads approvals, as the budget window does for a raised ceiling (#2665),
// runs in a checkout with no node_modules.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export function git(root, args, options = {}) {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe'], ...options });
}

/** A file as `rev` holds it, or null when it doesn't. `rev` null reads the worktree. */
export function show(root, rev, path) {
  if (rev === null) {
    const file = join(root, path);
    return existsSync(file) && statSync(file).isFile() ? readFileSync(file, 'utf8') : null;
  }
  const result = spawnSync('git', ['cat-file', 'blob', `${rev}:${path}`], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 30 });
  return result.status === 0 ? result.stdout : null;
}

/** The people whose signature approves (#1326): one list in the repo, an SSH allowed-signers file, read at the merge base only. */
export const APPROVERS = '.deepbuild/approvers';
// The key types whose every signature carries its authenticator's flags: a security key's, or a platform
// authenticator's such as a Secure Enclave key made for ssh. A key in a plain file signs for whatever reads it.
const PRESENCE = new Set(['sk-ssh-ed25519@openssh.com', 'sk-ecdsa-sha2-nistp256@openssh.com']);
const fingerprint = (blob) => `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`;

/**
 * The keys an allowed-signers text lists, each with its line, its principal, its type, whether that type needs a
 * person's presence, and `name`, how a line names it: principal, type and fingerprint. A line whose key can't be
 * read has the type null.
 */
export function signersIn(text) {
  return (text ?? '').split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#')).map((line) => {
    const words = line.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
    const at = words.findIndex((word, index) => index > 0 && /^(?:ssh|ecdsa|sk)-[\w@.-]+$/.test(word) && /^[A-Za-z0-9+/]+={0,2}$/.test(words[index + 1] ?? ''));
    const type = at < 0 ? null : words[at];
    const principal = words[0] ?? '';
    return { line, principal, type, presence: PRESENCE.has(type), name: at < 0 ? `${principal} (a line whose key can't be read)` : `${principal} (${type} ${fingerprint(Buffer.from(words[at + 1], 'base64'))})` };
  });
}

/** The signer's key and the flags its authenticator set, from an armored SSH signature; null when it can't be read. */
function sshsig(armor) {
  try {
    const bytes = Buffer.from(armor.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, ''), 'base64');
    const reader = (buffer, at = 0) => () => { const length = buffer.readUInt32BE(at); const value = buffer.subarray(at + 4, at + 4 + length); at += 4 + length; return Object.assign(value, { end: at }); };
    if (bytes.subarray(0, 6).toString() !== 'SSHSIG') return null;
    const take = reader(bytes, 10);
    const blob = take();
    take(); take(); take();
    const signature = take(), part = reader(signature);
    const type = part().toString();
    const end = part().end;
    // A security key's signature carries the flags its authenticator set, then its counter (OpenSSH's PROTOCOL.u2f).
    return { blob, type, flags: PRESENCE.has(type) && end < signature.length ? signature[end] : 0 };
  } catch {
    return null;
  }
}
// FIDO's user-present and user-verified flags: a touch, or a biometric or PIN.
const PRESENT = 0x01 | 0x04;

/**
 * Approval items by the commit they approve. An approval is an annotated tag under
 * refs/tags/deep/approved/ on a commit of the change, SSH-signed by a key that `.deepbuild/approvers`
 * lists at the merge base, with one `Approves: <item>` line per item. The list is never read from the
 * working tree, a home folder or a variable, so every checkout reads the same one (#1326). Only keys
 * of a type that needs a touch or a biometric count, and only a signature whose authenticator says
 * one was made: so no agent running as a person can make one. A signature by a listed key without
 * that is refused, and `approvals.refused` names it. The signature is checked with ssh-keygen itself,
 * never through git verify-tag, whose verifier the repository's own config could replace. A tag
 * under refs/tags/deep/gate/<n>/, signed by a key the gates file ($DEEP_GATES, else
 * ~/.deepbuild/gates) lists, approves only files of the issue's own test folder.
 */
export function readApprovals(root, change, issue) {
  const approvals = Object.assign(new Map(), { refused: [] });
  const shas = new Set(change.commits.map(({ sha }) => sha).filter(Boolean));
  const directory = mkdtempSync(join(tmpdir(), 'deep-proof-approval-'));
  const listed = signersIn(show(root, change.base, APPROVERS));
  const people = join(directory, 'approvers');
  writeFileSync(people, listed.map(({ line }) => `${line}\n`).join(''));
  const read = (signers, refs, keep, presence) => {
    if (!existsSync(signers)) return;
    // The full ID of a commit of the change that the tagged commit is, or descends from.
    const reaches = (commit, target) => commit === target || (/^[0-9a-f]{40,64}$/.test(commit) && shas.has(commit) && spawnSync('git', ['merge-base', '--is-ancestor', commit, target], { cwd: root }).status === 0);
    for (const row of git(root, ['for-each-ref', '--format=%(refname)%09%(objecttype)%09%(*objectname)', refs]).split('\n').filter(Boolean)) {
      const [ref, type, target] = row.split('\t');
      if (type !== 'tag' || !shas.has(target)) continue;
      const tag = git(root, ['cat-file', 'tag', ref]);
      const at = tag.indexOf('-----BEGIN SSH SIGNATURE-----\n');
      if (at < 0 || !tag.trimEnd().endsWith('-----END SSH SIGNATURE-----')) continue;
      const signature = join(directory, 'signature');
      writeFileSync(signature, tag.slice(at));
      const ssh = (args, input) => spawnSync('ssh-keygen', ['-Y', ...args, '-f', signers, '-s', signature], { input, encoding: 'utf8' });
      const principal = ssh(['find-principals']).stdout?.split('\n')[0]?.trim();
      if (!principal || ssh(['verify', '-n', 'git', '-I', principal], tag.slice(0, at)).status !== 0) continue;
      const signed = presence && sshsig(tag.slice(at));
      if (presence && !(signed && signed.flags & PRESENT)) {
        approvals.refused.push(`${ref.replace(/^refs\/tags\//, '')}: signed by ${principal} (${signed?.type ?? 'a key'} ${signed ? fingerprint(signed.blob) : ''}) with no touch or biometric, so it approves nothing`);
        continue;
      }
      const message = tag.slice(0, at).split('\n\n').slice(1).join('\n\n');
      for (const [, line] of message.matchAll(/^Approves: (.+?)\s*$/gm)) {
        const named = / @([0-9a-f]+)$/.exec(line);
        const [item, commit] = named ? [line.slice(0, named.index), named[1]] : [line, target];
        if (keep(item) && reaches(commit, target)) approvals.set(commit, [...(approvals.get(commit) ?? []), item]);
      }
    }
  };
  try {
    if (listed.length) read(people, 'refs/tags/deep/approved/', () => true, true);
    // The gate identity's swap of a disputed blind test (#1328): in place of a person's signature for that folder alone.
    if (issue?.number) read(resolve(process.env.DEEP_GATES || join(homedir(), '.deepbuild', 'gates')), `refs/tags/deep/gate/${issue.number}/`, (item) => item.startsWith(`tests/acceptance/${issue.number}/`));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  return approvals;
}
