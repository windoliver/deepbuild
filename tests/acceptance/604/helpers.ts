// Shared test-side tools for the issue #604 acceptance tests: the seven kinds and the writer each must
// carry, the writer forms, and a driver for the Rust types' `deep-contracts check`. None of them stands in
// for the contracts package.

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtures } from '../../../packages/contracts/src/index.ts';
import type { JsonValue } from '../../../packages/contracts/src/index.ts';

export const HERE = fileURLToPath(new URL('.', import.meta.url));
export const REPO = join(HERE, '..', '..', '..');
export const BIN = join(REPO, 'target', 'debug', process.platform === 'win32' ? 'deep-contracts.exe' : 'deep-contracts');

/** The base commit these tests were drafted against. */
export const BASE = 'f346706';

/** The issue's Change: each of the seven kinds and the one writer its pattern takes. */
export const NARROWED: readonly { name: string; writer: 'hook' | 'core' }[] = [
  { name: 'tool.before@1', writer: 'hook' },
  { name: 'tool.after@1', writer: 'hook' },
  { name: 'agent.stop@1', writer: 'hook' },
  { name: 'session.start@1', writer: 'hook' },
  { name: 'user.ask@1', writer: 'hook' },
  { name: 'reading.recorded@1', writer: 'core' },
  { name: 'reading.batch@1', writer: 'core' },
];

/** Every writer form the design names (technical-design.md:103, plus the core), one instance each, as the issue spells them. */
export const WRITER_FORMS = ['hook', 'core', 'app', 'cli', 'mcp:x', 'ext:x'] as const;

/** The writer forms a kind must refuse: every form but its own. */
export const othersThan = (writer: string): string[] => WRITER_FORMS.filter((w) => w !== writer);

type JsonObject = { [key: string]: JsonValue };

/** The kind's first fixture as the package ships it, with `writer` set. */
export function firstWith(name: string, writer: string): JsonObject {
  const first = fixtures(name)[0];
  if (typeof first !== 'object' || first === null || Array.isArray(first)) throw Error(`${name} has no first fixture object`);
  return { ...structuredClone(first), writer };
}

export function cargo(args: string[]): void {
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) throw Error(`cargo ${args.join(' ')} failed:\n${run.stderr}`);
}

/** The Rust types' verdict on each value: `ok`, or `refused <reason>`, one line per value. */
export function rustCheck(name: string, values: readonly JsonValue[]): string[] {
  const run = spawnSync(BIN, ['check', name], { input: `${values.map((v) => JSON.stringify(v)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) throw Error(`deep-contracts check ${name} failed:\n${run.stderr}`);
  const out = run.stdout.trimEnd().split('\n');
  if (out.length !== values.length) throw Error(`deep-contracts check ${name}: ${out.length} lines for ${values.length} values`);
  return out;
}
