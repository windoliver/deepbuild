// The OS confirming you (#24): what makes an answer from a control-token holder count, never the peer check or
// the token alone. The hub asks, not the client, since a confirmation a client reports is a claim the hub can't
// check. On macOS it is LocalAuthentication's prompt, Touch ID or your password, through deep-confirm; elsewhere
// the hub can't ask yet (polkit lands with the Linux hub), so nothing it would confirm counts.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const HELPER = fileURLToPath(new URL('./deep-confirm', import.meta.url));

/**
 * Asks the OS to confirm you, showing `reason`; resolves with why it didn't, or undefined once it did. `stub` is
 * DEEP_HUB_TEST_CONFIRM, a file only tests name: read at each ask, `confirmed` stands for the OS confirming you
 * and anything else, a missing file included, for a cancelled prompt.
 */
export async function confirmYou(reason: string, stub?: string): Promise<string | undefined> {
  if (stub !== undefined) {
    const said = await readFile(stub, 'utf8').catch(() => '');
    return said.trim() === 'confirmed' ? undefined : 'the prompt was cancelled';
  }
  if (process.platform !== 'darwin') return `the hub can't ask ${process.platform} to confirm you yet`;
  return new Promise((done) => {
    execFile(HELPER, [reason], (error, _stdout, stderr) => done(error ? String(stderr).trim() || error.message : undefined));
  });
}
