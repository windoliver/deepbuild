// Tokens the hub holds by handle (#1606; design: Secrets): a channel's token in channels.json and the Slack connector's
// in slack.json live in the OS secret store, as a plug-in's secret does (#364). Each file names its token by handle,
// `"secret": "secret:<owner>/<name>"`, kept under `deepbuild/<owner>/<name>`, and the hub adds the value to a provider
// call's header and nowhere else. A file that still holds a plain `token` is read once: the token moves into the store
// and the file is rewritten with the handle. A file that names a token is refused while it isn't yours or anyone else
// can read or write it, naming the file and its mode.
import { readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { keychainStore, type SecretStore } from '@deepbuild/extension-host';
import { ownHome } from './keychain.js';
import { installedRoot } from './paths.js';

type Obj = Record<string, unknown>;

/**
 * The OS secret store the hub keeps a secret in (#364, #1606): your Keychain, only while HOME is your own account's
 * home and, for a hub's own tokens, `root` is the installed hub's; DEEP_HUB_TEST_SECRETS, a JSON file of key to value,
 * stands in for it in tests. Undefined when there is none, so neither a hub under a test's temp HOME nor a dev hub on a
 * root of its own ever touches the installed hub's tokens in your Keychain.
 */
export function hubSecrets(root?: string): SecretStore | undefined {
  const file = process.env.DEEP_HUB_TEST_SECRETS;
  if (file) {
    const all = (): Obj => { try { return JSON.parse(readFileSync(file, 'utf8')) as Obj; } catch { return {}; } };
    const save = (v: Obj) => writeFileSync(file, `${JSON.stringify(v)}\n`, { mode: 0o600 });
    return {
      get: (k) => Promise.resolve(typeof all()[k] === 'string' ? all()[k] as string : undefined),
      set: (k, v) => Promise.resolve(save({ ...all(), [k]: v })),
      delete: (k) => { const v = all(); delete v[k]; save(v); return Promise.resolve(); },
    };
  }
  return process.platform === 'darwin' && ownHome() && (root === undefined || resolve(root) === installedRoot()) ? keychainStore() : undefined;
}

/** One token a file names: the object it sits in, and its `<owner>/<name>`, which its handle and store key are made of. */
export interface Named { at: Obj; path: string }
const handleOf = (n: Named): string => `secret:${n.path}`;
const keyOf = (n: Named): string => `deepbuild/${n.path}`;
const names = (n: Named): boolean => typeof n.at.token === 'string' || typeof n.at.secret === 'string';

/** Why a file that names a token isn't read: not yours, or others can read or write it. Undefined when it is read. */
export function refusedFile(file: string): string | undefined {
  const s = statSync(file);
  const mode = (s.mode & 0o777).toString(8).padStart(4, '0');
  if (process.getuid && s.uid !== process.getuid()) return `${file} isn't yours (its owner is uid ${s.uid}, mode ${mode}), so no token in it was read`;
  if (s.mode & 0o077) return `${file} is mode ${mode}, so others can reach the token it names, and none in it was read; chmod 600 ${file}`;
  return undefined;
}

/** Whether `named` picks any token out of the file's JSON: then the file is refused unless it is yours alone. */
export const namesToken = <T>(json: T, named: (json: T) => Named[]): boolean => named(json).some(names);

function write(file: string, json: unknown): void {
  writeFileSync(`${file}.tmp`, `${JSON.stringify(json, null, 2)}\n`, { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}

/**
 * Reads a file that may name tokens: refused (see `refusedFile`), or its JSON once each plain token it held is in
 * `store` and the file rewritten with its handle. `named` picks the tokens out of the JSON. With no store, a plain token
 * stays where it is, and `kept` names it.
 */
export async function hold<T>(file: string, named: (json: T) => Named[], store: SecretStore | undefined): Promise<{ json: T; moved: string[]; kept: string[] } | { refused: string }> {
  const json = JSON.parse(readFileSync(file, 'utf8')) as T;
  const tokens = named(json).filter(names);
  if (!tokens.length) return { json, moved: [], kept: [] };
  const refused = refusedFile(file);
  if (refused) return { refused };
  const plain = tokens.filter((n) => typeof n.at.token === 'string');
  if (!plain.length || !store) return { json, moved: [], kept: plain.map((n) => n.path) };
  for (const n of plain) {
    await store.set(keyOf(n), n.at.token as string);
    delete n.at.token;
    n.at.secret = handleOf(n);
  }
  write(file, json);
  return { json, moved: plain.map((n) => n.path), kept: [] };
}

/**
 * The value of a token: by its own handle, from the store; a plain one a host with no store kept, as written. A handle
 * other than its own names nothing, so another secret in the store never goes out in its place.
 */
export async function valueOf(n: Named, store: SecretStore | undefined): Promise<string | undefined> {
  if (typeof n.at.secret === 'string') return n.at.secret === handleOf(n) ? store?.get(keyOf(n)) : undefined;
  return typeof n.at.token === 'string' ? n.at.token : undefined;
}

/**
 * A token entered on the trusted path (#1606): its value into the store, and its handle into the file at the place
 * `at` picks, written only you can read. Throws, naming the file, when the file has no such place.
 */
export async function enter(file: string, at: (json: Obj) => Obj | undefined, path: string, value: string, store: SecretStore | undefined): Promise<void> {
  if (!store) throw Error('this host has no OS secret store to keep the token in');
  let json: Obj;
  try { json = JSON.parse(readFileSync(file, 'utf8')) as Obj; } catch { throw Error(`${file} can't be read as JSON`); }
  const place = at(json);
  if (!place) throw Error(`${file} names no place for this token`);
  const n = { at: place, path };
  await store.set(keyOf(n), value);
  delete place.token;
  place.secret = handleOf(n);
  write(file, json);
}
