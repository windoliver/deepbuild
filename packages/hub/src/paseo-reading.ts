// What DeepBuild reads of the paseo on your PATH (#3428): its version against the versions paseo's facts cover, the
// plugin as paseo lists it (installed, enabled, and loaded or refused with paseo's own reason), and whether the source
// the facts install from resolves. `deep setup` reads them before it writes anything, and `deep doctor` shows them as
// paseo's items.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFacts } from '@deepbuild/adapters';
import { coverage, coveredBy } from './adapter-facts.js';
import { onPath } from './paths.js';

/** The plugin's ID in paseo. */
export const PLUGIN_ID = 'deepbuild';
/** A plugin as `paseo plugin ls --json` lists it: its state is running, failed (with paseo's error) or disabled. */
export interface ListedPlugin { id?: string; plugin?: string; status?: string; enabled?: boolean; error?: string }

type Ran = { code: number | null; out: string; err: string };
/** A program's exit code and output; null when it couldn't start. */
function ran(program: string, args: string[], timeout: number): Promise<Ran | null> {
  return new Promise((done) => {
    execFile(program, args, { timeout, encoding: 'utf8', env: process.env }, (error, out, err) => {
      if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') return done(null);
      done({ code: error ? (typeof error.code === 'number' ? error.code : null) : 0, out: String(out), err: String(err) });
    });
  });
}
const firstLine = (r: Ran): string => (r.err.trim() || r.out.trim()).split('\n')[0] || 'nothing';

/** The versions paseo's facts cover, as a person reads them. */
export const covered = (): string => coverage('paseo').join(', ');

/** `paseo --version`'s version, or why there is none. */
export async function paseoVersion(paseo: string, timeout: number): Promise<{ version: string } | { unread: string }> {
  const r = await ran(paseo, ['--version'], timeout);
  const version = /(\d+\.\d+\.\d+[\w.-]*)/.exec(r?.out ?? '')?.[1];
  return version ? { version } : { unread: `${paseo} --version printed no version (${r ? firstLine(r) : "it didn't start"})` };
}
/** Whether the facts cover a paseo version: listed, never between two listed ones (#1884). */
export const paseoCovered = (version: string): boolean => coveredBy('paseo', version);

/** DeepBuild's plugin as paseo lists it, `undefined` when paseo lists no such plugin, or why the list couldn't be read. */
export async function listedPlugin(paseo: string, timeout: number): Promise<{ plugin: ListedPlugin | undefined } | { unread: string }> {
  const r = await ran(paseo, ['plugin', 'ls', '--json'], timeout);
  if (!r || r.code !== 0) return { unread: `paseo plugin ls --json ${r ? `exited ${r.code}: ${firstLine(r)}` : "didn't start"}` };
  let list: unknown;
  try { list = JSON.parse(r.out.slice(Math.max(0, Math.min(...['[', '{'].map((c) => r.out.indexOf(c)).filter((i) => i >= 0))))); } catch { return { unread: `paseo plugin ls --json printed no list: ${firstLine(r)}` }; }
  const items = (Array.isArray(list) ? list : Array.isArray((list as { plugins?: unknown })?.plugins) ? (list as { plugins: unknown[] }).plugins : []) as ListedPlugin[];
  return { plugin: items.find((p) => (p?.id ?? p?.plugin) === PLUGIN_ID) };
}
/** What keeps a listed plugin from gating paseo's agents, in paseo's own words; `undefined` when it is loaded. */
export function pluginProblem(p: ListedPlugin): string | undefined {
  if (p.status === 'running') return undefined;
  if (p.status === 'disabled' || p.enabled === false) return `paseo lists its plugin ${PLUGIN_ID} as disabled, so it doesn't load`;
  if (p.status === 'failed') return `paseo lists its plugin ${PLUGIN_ID} and refused to load it: ${p.error ?? 'paseo gave no reason'}`;
  return `paseo lists its plugin ${PLUGIN_ID} as ${p.status ?? 'in no state'}, not loaded${p.error ? `: ${p.error}` : ''}`;
}

/** The source the facts install the plugin from. */
export const pluginSource = (): string => readFacts<{ install: { source: string } }>('paseo.facts.json').install.source;
/** Why the facts' source doesn't resolve, named; `undefined` when it does. An npm source is looked up through npm. */
export async function sourceProblem(timeout: number): Promise<string | undefined> {
  const source = pluginSource();
  if (!source.startsWith('npm:')) return existsSync(source) ? undefined : `the plugin's source ${source} doesn't exist`;
  const spec = source.slice('npm:'.length);
  const at = spec.lastIndexOf('@');
  const [name, version] = at > 0 ? [spec.slice(0, at), spec.slice(at + 1)] : [spec, undefined];
  const npm = onPath('npm');
  if (!npm) return `the plugin's source ${source} can't be looked up: no npm is on your PATH`;
  const r = await ran(npm, ['view', spec, 'version', '--json'], timeout);
  if (!r) return `the plugin's source ${source} can't be looked up: npm didn't start`;
  if (r.code !== 0) return `the plugin's source ${source} doesn't resolve: npm view ${spec} answered ${/E404|404/.test(r.err + r.out) ? '404, no such package' : `exit ${r.code}`} (${firstLine(r)})`;
  if (version && !r.out.includes(`"${version}"`)) return `the plugin's source ${source} doesn't resolve: npm has no version ${version} of ${name}`;
  return undefined;
}
