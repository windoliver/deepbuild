import { ContractError, issue } from './errors.js';

/** The closed list of record handle schemes. */
export const HANDLE_SCHEMES: readonly string[] = Object.freeze([
  'task', 'ask', 'claim', 'verdict', 'run', 'req', 'decision', 'plan', 'lease', 'reading', 'notice', 'doc', 'ev', 'session',
]);

export interface Handle { scheme: string; id: string; fragment?: string }

// The id is a record's ULID, or a content hash for a definition; the fragment picks a part of it.
const HANDLE = /^([^:#]*):([0-9A-Za-z]+)(?:#([A-Za-z0-9][A-Za-z0-9._-]*))?$/;

/** Parses `<scheme>:<id>[#<fragment>]`, refusing any scheme outside the closed list by name. */
export function parseHandle(text: string): Handle {
  const match = HANDLE.exec(text);
  if (!match || match[1] === '') throw new ContractError(issue('handle_syntax', '', text));
  const [, scheme, id, fragment] = match as unknown as [string, string, string, string | undefined];
  if (!HANDLE_SCHEMES.includes(scheme)) throw new ContractError(issue('handle_scheme', '', scheme));
  return fragment === undefined ? { scheme, id } : { scheme, id, fragment };
}

export const printHandle = (handle: Handle): string =>
  `${handle.scheme}:${handle.id}${handle.fragment === undefined ? '' : `#${handle.fragment}`}`;
