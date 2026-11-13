// Internal host primitives shared by the loading, source and job seams.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Connection } from '@deepbuild/record';
import { after } from '@deepbuild/supervisor';

export const CORE: Connection = { writer: 'core', actor: 'you', scope: 'you' };
export const CALL_MS = 10_000;
export const message = (e: unknown): string => String((e as Error)?.message ?? e);
export const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const texts = (v: unknown): boolean => Array.isArray(v) && v.every((x) => typeof x === 'string');
export function trustedPath(connection: Connection, what: string): void {
  if ((connection.writer !== 'app' && connection.writer !== 'cli') || connection.session !== undefined) {
    throw Error(`${what} only on your trusted path, the app or the CLI, not by ${connection.writer}${connection.session ? ` in session ${connection.session}` : ''}`);
  }
}

/** The host's existing atomic JSON files, kept under extensions/. */
export class HostFiles {
  constructor(private readonly home: string) {}
  read<T>(name: string): Record<string, T> {
    const path = join(this.home, 'extensions', name);
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as Record<string, T> : {};
  }
  save(name: string, value: unknown): void {
    const path = join(this.home, 'extensions', name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2));
    renameSync(`${path}.tmp`, path);
  }
}

export class Overran extends Error {}
export async function within<T>(ms: number, what: string, work: Promise<T>): Promise<T> {
  return stretchable(ms, what, work).done;
}
/** A running model job can extend its enclosing action's deadline. */
export function stretchable<T>(ms: number, what: string, work: Promise<T>): { done: Promise<T>; until: (ms: number) => void } {
  let disarm = (): void => undefined;
  let overran = (_: Error): void => undefined;
  const start = Date.now();
  let end = start + ms;
  const arm = (): void => {
    disarm();
    disarm = after(end - Date.now(), () => overran(new Overran(`${what} took longer than ${end - start} ms`)));
  };
  const late = new Promise<never>((_, reject) => { overran = reject; });
  arm();
  return {
    done: Promise.race([work, late]).finally(() => disarm()),
    until: (more) => {
      if (Date.now() + more <= end) return;
      end = Date.now() + more;
      arm();
    },
  };
}
