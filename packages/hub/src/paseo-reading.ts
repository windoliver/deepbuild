import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFacts } from '@deepbuild/adapters';
import { coverage, coveredBy } from './adapter-facts.js';
import { onPath } from './paths.js';

export const PLUGIN_ID = 'deepbuild';
export interface ListedPlugin { id?: string; plugin?: string; status?: string; enabled?: boolean; error?: string }

type Ran = { code: number | null; out: string; err: string };
function ran(program: string, args: string[], timeout: number): Promise<Ran | null> {
  return new Promise((done) => {
    execFile(program, args, { timeout, encoding: 'utf8', env: process.env }, (error, out, err) => {
      if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') return done(null);
      done({ code: error ? (typeof error.code === 'number' ? error.code : null) : 0, out: String(out), err: String(err) });
    });
  });
}
const firstLine = (r: Ran): string => (r.err.trim() || r.out.trim()).split('\n')[0] || 'nothing';

export const covered = (): string => coverage('paseo').join(', ');

export async function paseoVersion(paseo: string, timeout: number): Promise<{ version: string } | { unread: string }> {
  const r = await ran(paseo, ['--version'], timeout);
  const version = /(\d+\.\d+\.\d+[\w.-]*)/.exec(r?.out ?? '')?.[1];
  return version ? { version } : { unread: `${paseo} --version printed no version (${r ? firstLine(r) : "it didn't start"})` };
}
export const paseoCovered = (version: string): boolean => coveredBy('paseo', version);

export async function listedPlugin(paseo: string, timeout: number): Promise<{ plugin: ListedPlugin | undefined } | { unread: string }> {
  const r = await ran(paseo, ['plugin', 'ls', '--json'], timeout);
  if (!r || r.code !== 0) return { unread: `paseo plugin ls --json ${r ? `exited ${r.code}: ${firstLine(r)}` : "didn't start"}` };
  let list: unknown;
  try { list = JSON.parse(r.out.slice(Math.max(0, Math.min(...['[', '{'].map((c) => r.out.indexOf(c)).filter((i) => i >= 0))))); } catch { return { unread: `paseo plugin ls --json printed no list: ${firstLine(r)}` }; }
  const items = (Array.isArray(list) ? list : Array.isArray((list as { plugins?: unknown })?.plugins) ? (list as { plugins: unknown[] }).plugins : []) as ListedPlugin[];
  return { plugin: items.find((p) => (p?.id ?? p?.plugin) === PLUGIN_ID) };
}
export function pluginProblem(p: ListedPlugin): string | undefined {
  if (p.status === 'running') return undefined;
  if (p.status === 'disabled' || p.enabled === false) return `paseo lists its plugin ${PLUGIN_ID} as disabled, so it doesn't load`;
  if (p.status === 'failed') return `paseo lists its plugin ${PLUGIN_ID} and refused to load it: ${p.error ?? 'paseo gave no reason'}`;
  return `paseo lists its plugin ${PLUGIN_ID} as ${p.status ?? 'in no state'}, not loaded${p.error ? `: ${p.error}` : ''}`;
}

export const pluginSource = (): string => readFacts<{ install: { source: string } }>('paseo.facts.json').install.source;
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
