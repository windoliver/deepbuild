import { NEEDS_NO_HUB, help, hubForms as frozenForms, type World } from '../1812/helpers.ts';

export { FIRST_RUN, SECOND, answers, cleanup, deep, hubDownFailures, needBuild, setUp, socketOf, stopHubs, world } from '../1812/helpers.ts';

const ID = '01KAZ3Y8M5Q2W7E4R6T9P1N3B5';

export function hubForms(w: World): Map<string, string[]> {
  const forms = frozenForms(w);
  forms.set('host add', ['host', 'add', 'h1']);
  forms.set('rules session', ['rules', 'session', `session:${ID}`]);
  return forms;
}

function alternatives(synopsis: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of synopsis) {
    if (ch === '[' || ch === '<') depth++;
    if (ch === ']' || ch === '>') depth = Math.max(0, depth - 1);
    if (ch === '|' && depth === 0) { out.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  out.push(current.trim());
  return out;
}

const WORD = /^[a-z][a-z0-9-]*$/;
const MARK = /^[^\p{L}\p{N}<>[\]|.-]+$/u;

export function listedCommands(text: string): string[][] {
  const seen = new Map<string, string[]>();
  for (const line of text.split('\n')) {
    const m = /^\s*(?:Usage:\s*)?(?:[^\p{L}\p{N}\s<[-]+\s+)?deep\s+(.*)$/u.exec(line);
    if (!m) continue;
    const synopsis = m[1]!.split(/\s{2,}/)[0]!.split(/\s+/).filter((token) => !MARK.test(token)).join(' ').trim();
    const alts = alternatives(synopsis);
    const tokens0 = alts[0]!.split(/\s+/).filter(Boolean);
    const first: string[] = [];
    for (const t of tokens0) { if (!WORD.test(t)) break; first.push(t); }
    if (!first.length || first.length > 2) continue;
    const takesArgs = tokens0.length > first.length;
    const add = (words: string[]) => { if (words.length <= 2) seen.set(words.join(' '), words); };
    add(first);
    for (const alt of alts.slice(1)) {
      const words: string[] = [];
      for (const t of alt.split(/\s+/).filter(Boolean)) { if (!WORD.test(t)) break; words.push(t); }
      if (!words.length) continue;
      if (first.length >= 2) add([...first.slice(0, -1), ...words]);
      else if (takesArgs) add([...first, ...words]);
      else add(words);
    }
  }
  return [...seen.values()];
}

export async function table(w: World): Promise<{ name: string; args: string[] }[]> {
  const forms = hubForms(w);
  const listed = listedCommands(await help()).map((words) => words.join(' '));
  const unknown = listed.filter((name) => !forms.has(name) && !Object.hasOwn(NEEDS_NO_HUB, name));
  if (unknown.length) throw Error(`BLOCKED: deep --help lists ${unknown.map((n) => `deep ${n}`).join(', ')}, which this table neither runs nor leaves out by name`);
  if (!listed.includes('inbox')) throw Error(`BLOCKED: deep --help doesn't list deep inbox: ${listed.join(', ')}`);
  return listed.filter((name) => forms.has(name)).map((name) => ({ name, args: forms.get(name)! }));
}
