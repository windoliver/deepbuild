// The criteria's checks as pure functions returning problems, so the tests run them on the real wiki and on a hand-built
// wrong one (a check that can't fail on a wrong wiki proves nothing). An empty array is a pass.
import { forms } from './history.ts';

/** 8e6a9c42: nothing changed but `log.md`, which may only grow at its end. */
export function changedFiles(before: Map<string, string>, after: Map<string, string>): string[] {
  const problems: string[] = [];
  for (const name of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(name); const b = after.get(name);
    if (a === b) continue;
    if (name === 'log.md' && a !== undefined && b !== undefined && b.startsWith(a)) continue;
    problems.push(a === undefined ? `${name} was added` : b === undefined ? `${name} was removed` : `${name} changed`);
  }
  return problems;
}
/** 65dd8324: each canary, in each form, in each file; names the file and the canary. */
export function leaks(files: Map<string, Buffer | string>, canaries: Record<string, string>): string[] {
  const problems: string[] = [];
  for (const [file, content] of files) {
    const text = typeof content === 'string' ? content : content.toString('latin1');
    for (const [name, value] of Object.entries(canaries)) {
      for (const f of forms(value)) if (text.includes(f)) problems.push(`${file} holds the ${name} canary (${f === value ? 'raw' : f.length === encodeURIComponent(value).length && f === encodeURIComponent(value) ? 'url-encoded' : 'base64'})`);
    }
  }
  return problems;
}
