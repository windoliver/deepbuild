// The OS confirming you (#24, #880): what makes an answer from a control-token holder count, never the peer check or
// the token alone. The hub asks, not the client, since a confirmation a client reports is a claim the hub can't
// check. On macOS it is deep-confirm, which signs a challenge the hub picked with a Secure Enclave key that signs only
// after Touch ID or your password; the hub counts that signature, verified by the key setup recorded, never the
// helper's exit code, and runs no helper whose code signature isn't the one recorded with the key. On Linux (#70) it
// is polkit: pkcheck, on the action this package ships, for the process the peer check proved, with your password at
// that process's own agent (client.ts). The hub counts pkcheck's exit 0 alone. Elsewhere nothing it would confirm counts.
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readFile, stat } from 'node:fs/promises';
import { createPublicKey, randomBytes, verify } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { canonicalize, type JsonValue } from '@deepbuild/contracts';
import type { Devices } from './trusted.js';
import { startOf, ulid } from './wire.js';

const HELPER = fileURLToPath(new URL('./deep-confirm', import.meta.url));
const CODESIGN = '/usr/bin/codesign';
const PKCHECK = '/usr/bin/pkcheck';
/** The action native/dev.deepbuild.confirm.policy declares: your own password each time, never kept. */
const ACTION = 'dev.deepbuild.confirm';

/**
 * What a confirmation is for: the handle the prompt answers, and its revision, which the signature covers with the
 * words; and the process asking, by ID and start time, which is who polkit prompts.
 */
interface Subject { handle: string; revision: string; process?: { pid: number; start: string } | undefined }

/** A program's output, whatever its exit code: that counts for nothing here. */
function ran(file: string, args: string[], o: { env?: NodeJS.ProcessEnv; input?: Uint8Array } = {}): Promise<{ stdout: string; stderr: string; failed?: Error }> {
  return new Promise((done) => {
    const child = execFile(file, args, { env: o.env ?? process.env, maxBuffer: 1 << 20 }, (error, stdout, stderr) => done({ stdout, stderr, ...(error ? { failed: error } : {}) }));
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(o.input ?? new Uint8Array());
  });
}

/** The helper's designated requirement as codesign reads it: for an ad-hoc signature, its CDHash. */
async function requirementOf(file: string): Promise<string | undefined> {
  const { stdout, stderr } = await ran(CODESIGN, ['--display', '--requirements', '-', file]);
  return /designated => (.+)$/m.exec(`${stdout}\n${stderr}`)?.[1]?.trim();
}

/** SecStaticCodeCheckValidity, through codesign, against the requirement recorded at setup. */
async function signedAs(file: string, requirement: string): Promise<boolean> {
  return !(await ran(CODESIGN, ['--verify', '--strict', '-R', `=${requirement}`, file])).failed;
}

/** A process of yours as pkcheck names one, `pid,start,uid`, once it is still the one the peer check proved; else undefined. */
async function polkitSubject(peer: Subject['process']): Promise<string | undefined> {
  if (!peer || (await startOf(peer.pid)) !== peer.start) return undefined;
  const uid = process.getuid!();
  const [owner, line] = await Promise.all([stat(`/proc/${peer.pid}`).catch(() => undefined), readFile(`/proc/${peer.pid}/stat`, 'utf8').catch(() => '')]);
  // The start time in clock ticks, field 22; fields count from the end of the program's name, which may hold anything.
  const ticks = line.slice(line.lastIndexOf(')') + 2).split(' ')[19];
  return owner?.uid === uid && ticks ? `${peer.pid},${ticks},${uid}` : undefined;
}

/** One JSON object from the helper's first line of output, or undefined. */
function replyOf(stdout: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(stdout.split('\n')[0] ?? '');
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

export class Confirmer {
  /**
   * `stub` is DEEP_HUB_TEST_CONFIRM and `polkit` DEEP_HUB_TEST_POLKIT, the program run in pkcheck's place, which only
   * tests set; `key` where deep-confirm keeps its enclave-wrapped key.
   */
  constructor(private readonly o: { devices: Devices; key: string; stub?: string; polkit?: string; plant?: string }) {}

  private helperEnv(): NodeJS.ProcessEnv {
    return { ...process.env, DEEP_CONFIRM_KEY: this.o.key };
  }

  /**
   * Asks the OS to confirm you, showing `words`; resolves with why it didn't, or undefined once it did. The stub, a
   * file only tests name: read at each ask, `confirmed` stands for the OS confirming you and anything else, a missing
   * file included, for a cancelled prompt. An executable stub stands in for the prompt itself (#34's tests): it runs
   * once per ask with `words` as its one argument, and exit 0 is you confirming.
   */
  async you(words: string, subject: Subject): Promise<string | undefined> {
    const { stub } = this.o;
    if (stub !== undefined && (await access(stub, constants.X_OK).then(() => true, () => false))) {
      return new Promise((done) => execFile(stub, [words], (error) => done(error ? 'the prompt was cancelled' : undefined)));
    }
    if (stub !== undefined) {
      const said = await readFile(stub, 'utf8').catch(() => '');
      return said.trim() === 'confirmed' ? undefined : 'the prompt was cancelled';
    }
    if (process.platform === 'linux') return this.polkit(subject);
    if (process.platform !== 'darwin') return `the hub can't ask ${process.platform} to confirm you yet`;
    const device = this.o.devices.enclave();
    if (!device?.requirement) return 'deep-confirm has no key set up; deep setup sets one up';
    if (!(await signedAs(HELPER, device.requirement))) {
      return `${HELPER} isn't the deep-confirm recorded at setup (its code signature doesn't match), so it wasn't run; a rebuilt helper is set up again from the app`;
    }
    return this.signed(device.public_key, words, subject);
  }

  /** polkit's answer for the process asking: pkcheck's exit 0 is you confirming, and anything else isn't. */
  private async polkit(subject: Subject): Promise<string | undefined> {
    const who = await polkitSubject(subject.process);
    if (!who) return `polkit has no process of yours to prompt for ${subject.handle}`;
    const { failed, stderr } = await ran(this.o.polkit ?? PKCHECK, ['--action-id', ACTION, '--process', who, '--allow-user-interaction']);
    if (!failed) return undefined;
    if ((failed as { code?: unknown }).code === 3) return 'the prompt was cancelled';
    return `polkit didn't confirm you${stderr.trim() ? `: ${stderr.trim().slice(0, 200)}` : ''}`;
  }

  /** deep-confirm's signature, made once you confirm, over a challenge for this confirmation alone, by the key `point`. */
  private async signed(point: string, words: string, subject: Subject): Promise<string | undefined> {
    // A nonce for this confirmation alone: the signature must cover it, so no earlier one counts again.
    const challenge = { v: 1, ask: subject.handle, revision: subject.revision, words, nonce: randomBytes(32).toString('base64url') };
    const bytes = canonicalize(challenge);
    const { stdout, stderr } = await ran(HELPER, ['sign'], { env: this.helperEnv(), input: Buffer.concat([bytes, Buffer.from('\n')]) });
    const reply = replyOf(stdout);
    if (reply?.error === 'cancelled') return 'the prompt was cancelled';
    if (typeof reply?.error === 'string') return reply.error;
    if (typeof reply?.signature !== 'string') return `deep-confirm returned no signature${stderr.trim() ? `: ${stderr.trim().slice(0, 200)}` : ''}`;
    const covered = this.o.plant === 'signature-covers-anything' && reply.signed !== undefined ? canonicalize(reply.signed as JsonValue) : bytes;
    return verifies(point, covered, reply.signature) ? undefined : `the signature deep-confirm returned doesn't cover this confirmation of ${subject.handle} at ${subject.revision}`;
  }

  /**
   * deep-confirm makes a new key in the Secure Enclave, and the key and the helper's code requirement are recorded as
   * a device of yours, replacing any earlier one, which stops counting at once. At setup that is all (#880); set up
   * again from the app, `confirm` has you confirm with the new key first, so it counts only once you do. Resolves
   * with why it didn't.
   */
  async enroll(at: number, confirm?: { words: string; subject: Subject }): Promise<string | undefined> {
    const requirement = await requirementOf(HELPER);
    if (!requirement) return `${HELPER} carries no code signature to record`;
    const { stdout, stderr } = await ran(HELPER, ['enroll'], { env: this.helperEnv() });
    const key = replyOf(stdout)?.public_key;
    const point = typeof key === 'string' ? Buffer.from(key, 'base64url') : Buffer.alloc(0);
    if (typeof key !== 'string' || point.length !== 65 || point[0] !== 4) return `deep-confirm made no key: ${String(replyOf(stdout)?.error ?? (stderr.trim() || 'no public key'))}`;
    const why = confirm ? await this.signed(key, confirm.words, confirm.subject) : undefined;
    if (why) return why;
    this.o.devices.enroll({ device: `device:${ulid(at)}`, name: 'deep-confirm on this Mac', kind: 'enclave', public_key: key, requirement, paired: at });
    return undefined;
  }
}

/** ECDSA P-256 over SHA-256 of `bytes`, the signature X9.62 DER, by the key whose X9.63 point is `point`. */
function verifies(point: string, bytes: Uint8Array, signature: string): boolean {
  try {
    const raw = Buffer.from(point, 'base64url');
    const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33, 65).toString('base64url') }, format: 'jwk' });
    return verify('sha256', bytes, { key, dsaEncoding: 'der' }, Buffer.from(signature, 'base64url'));
  } catch {
    return false;
  }
}
