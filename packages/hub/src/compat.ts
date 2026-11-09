// Whether the hub's hello (its contract version and the methods it lists) covers what an app or the CLI calls (#41).
// A mismatch is one screen that names the older side and the one step that fixes it, never a failure call by call.
export interface Hello { contract?: string; features?: readonly string[] }
export interface Needs { contract: string; features: readonly string[] }
export type Compat = { ok: true } | { ok: false; older: 'hub' | 'client'; screen: string; fix: string };

const parts = (contract: string): [number, number] => {
  const [major = '0', minor = '0'] = contract.split('.');
  return [Number(major), Number(minor)];
};

const HUB_FIX = 'Update DeepBuild so the hub matches this app, then restart it with `deep setup`.';
const CLIENT_FIX = 'Update this app or CLI to the version that matches the running hub.';

export function checkCompat(hello: Hello, needs: Needs): Compat {
  const [needMajor, needMinor] = parts(needs.contract);
  const have = hello.contract === undefined ? undefined : parts(hello.contract);
  const missing = needs.features.filter((feature) => !hello.features?.includes(feature));
  if (have && have[0] > needMajor) {
    return { ok: false, older: 'client', fix: CLIENT_FIX, screen: `This app is older than the hub: it speaks contract ${needs.contract} and the hub speaks ${hello.contract}.\n${CLIENT_FIX}` };
  }
  if (!have || have[0] < needMajor || (have[0] === needMajor && have[1] < needMinor)) {
    return { ok: false, older: 'hub', fix: HUB_FIX, screen: `The hub is older than this app: it speaks contract ${hello.contract ?? 'none'} and this app needs ${needs.contract}.\n${HUB_FIX}` };
  }
  if (missing.length) {
    return { ok: false, older: 'hub', fix: HUB_FIX, screen: `The hub is older than this app: it does not list ${missing.join(', ')}.\n${HUB_FIX}` };
  }
  return { ok: true };
}

/** Calls a hub method only if the hello lists it; otherwise refuses, naming the method, and never calls. */
export async function guardedCall<T>(hello: Hello, method: string, call: () => T | Promise<T>): Promise<T> {
  if (!hello.features?.includes(method)) throw new Error(`The hub does not list ${method}, so it was not called.`);
  return call();
}
