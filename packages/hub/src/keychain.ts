// Your login Keychain, which the runner hands a job your sign-in token from (#159) and the doctor reads its lifetime
// from (#19). A hub or a doctor under a test's temp HOME never reads your credentials.
import { execFile } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { userInfo } from 'node:os';

/** Whether HOME is your own account's home: a hub under a test's temp HOME never reads your credentials. */
export const ownHome = (): boolean => { try { return realpathSync(process.env.HOME ?? '') === realpathSync(userInfo().homedir); } catch { return false; } };
/** Your login Keychain, only while HOME is your own account's home; DEEP_HUB_TEST_KEYCHAIN, a JSON file of service to value, stands in for it in tests. */
export const keychain = (service: string): Promise<string | undefined> => {
  const stub = process.env.DEEP_HUB_TEST_KEYCHAIN;
  if (stub) {
    try { const value = (JSON.parse(readFileSync(stub, 'utf8')) as Record<string, unknown>)[service]; return Promise.resolve(typeof value === 'string' ? value : undefined); } catch { return Promise.resolve(undefined); }
  }
  if (process.platform !== 'darwin' || !ownHome()) return Promise.resolve(undefined);
  return new Promise((done) => execFile('/usr/bin/security', ['find-generic-password', '-s', service, '-w'], { timeout: 5000 }, (error, out) => done(error ? undefined : out.trim())));
};
