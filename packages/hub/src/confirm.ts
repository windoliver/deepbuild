// The OS confirming you (#24): what makes an answer from a control-token holder count, never the peer check or
// the token alone. The hub asks, not the client, since a confirmation a client reports is a claim the hub can't
// check. On macOS it is LocalAuthentication's prompt, Touch ID or your password, through deep-confirm; elsewhere
// the hub can't ask yet (polkit lands with the Linux hub), so nothing it would confirm counts.
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const HELPER = fileURLToPath(new URL('./deep-confirm', import.meta.url));

/**
 * Asks the OS to confirm you, showing `reason`; resolves with why it didn't, or undefined once it did. `stub` is
 * DEEP_HUB_TEST_CONFIRM, a file only tests name: read at each ask, `confirmed` stands for the OS confirming you
 * and anything else, a missing file included, for a cancelled prompt. An executable stub stands in for the
 * prompt itself (#34's tests): it runs once per ask with `reason` as its one argument, and exit 0 is you confirming.
 */
export async function confirmYou(reason: string, stub?: string): Promise<string | undefined> {
  if (stub !== undefined && (await access(stub, constants.X_OK).then(() => true, () => false))) {
    return new Promise((done) => execFile(stub, [reason], (error) => done(error ? 'the prompt was cancelled' : undefined)));
  }
  if (stub !== undefined) {
    const said = await readFile(stub, 'utf8').catch(() => '');
    return said.trim() === 'confirmed' ? undefined : 'the prompt was cancelled';
  }
  if (process.platform !== 'darwin') return `the hub can't ask ${process.platform} to confirm you yet`;
  return new Promise((done) => {
    execFile(HELPER, [reason], (error, _stdout, stderr) => done(error ? String(stderr).trim() || error.message : undefined));
  });
}
