// The criteria's judges, each returning the problems it found (empty when the criterion holds). The wrong programs
// in twins.ts must fail them with the problem the criterion names: the host (AC4), the form (AC5, AC7) or the case
// (AC6).

/** One printed form of a value, named as a problem names it. */
export interface Form { name: string; find(text: string): boolean }

/**
 * Every form the Privacy scrub covers (design, Privacy): raw; URL-encoded, with hex of either case; and base64 at
 * each of the three byte offsets the value can start at, in the standard and the URL-safe alphabets. A base64 form is
 * the part of the encoding that depends on the value's bytes alone, whatever comes before or after it.
 */
export function forms(value: string): Form[] {
  const bytes = Buffer.from(value, 'utf8');
  const out: Form[] = [{ name: 'raw', find: (t) => t.includes(value) }];
  const encoded = [...bytes].map((b) => (/[A-Za-z0-9\-_.~]/.test(String.fromCharCode(b)) ? String.fromCharCode(b) : `%${b.toString(16).padStart(2, '0')}`)).join('');
  if (encoded !== value) out.push({ name: 'URL-encoded', find: (t) => t.toLowerCase().includes(encoded.toLowerCase()) });
  for (const lead of [0, 1, 2]) {
    const b64 = Buffer.concat([Buffer.alloc(lead), bytes]).toString('base64');
    const core = b64.slice(Math.ceil((8 * lead) / 6), Math.floor((8 * (lead + bytes.length)) / 6));
    const safe = core.replaceAll('+', '-').replaceAll('/', '_');
    out.push({ name: `base64 at byte offset ${lead} in the standard alphabet`, find: (t) => t.includes(core) });
    out.push({ name: `base64 at byte offset ${lead} in the URL-safe alphabet`, find: (t) => t.includes(safe) });
  }
  return out;
}

/** The byte strings a file holding any form of the value holds: raw, URL-encoded in either hex case, and each base64 form. */
export function needles(value: string): string[] {
  const bytes = Buffer.from(value, 'utf8');
  const lower = [...bytes].map((b) => (/[A-Za-z0-9\-_.~]/.test(String.fromCharCode(b)) ? String.fromCharCode(b) : `%${b.toString(16).padStart(2, '0')}`)).join('');
  const out = new Set([value, lower, lower.replace(/%[0-9a-f]{2}/g, (h) => h.toUpperCase())]);
  for (const lead of [0, 1, 2]) {
    const b64 = Buffer.concat([Buffer.alloc(lead), bytes]).toString('base64');
    const core = b64.slice(Math.ceil((8 * lead) / 6), Math.floor((8 * (lead + bytes.length)) / 6));
    out.add(core).add(core.replaceAll('+', '-').replaceAll('/', '_'));
  }
  return [...out];
}

/** Each string in a value (object keys among them) with its path. */
function strings(value: unknown, at = ''): [string, string][] {
  if (typeof value === 'string') return [[at || '/', value]];
  if (typeof value === 'number' || typeof value === 'boolean') return [[at || '/', String(value)]];
  if (Array.isArray(value)) return value.flatMap((v, i) => strings(v, `${at}/${i}`));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => [[`${at}/${k} (name)`, k] as [string, string], ...strings(v, `${at}/${k}`)]);
  return [];
}

/** Where a value holds any form of the secret: one problem per form and place, naming the form. */
export function formsIn(value: unknown, secret: string, what: string): string[] {
  const problems: string[] = [];
  for (const [path, text] of strings(value)) {
    for (const form of forms(secret)) if (form.find(text)) problems.push(`${what} holds the key ${form.name} at ${path}`);
  }
  return problems;
}

/** AC5, AC7: what the plug-in's parser got holds no form of the key. */
export const judgeParser = (got: unknown, key: string): string[] => formsIn(got, key, "the plug-in's parser's input");

/**
 * AC4: the price call that got `302 Location: https://cdn.other.example/q` sent nothing to cdn.other.example, and what
 * needs the price reading is BLOCKED, cause off-host redirect.
 */
export function judgeRedirect(read: unknown, other: { host: string; seen: { url: string; headers: Record<string, string> }[] }, key: string): string[] {
  const problems: string[] = [];
  for (const s of other.seen) {
    const carried = formsIn(s, key, 'it');
    problems.push(`sent ${s.url} to ${other.host}${carried.length ? `, delivering the key (${carried.join('; ')})` : ''}`);
  }
  const r = read as { status?: unknown; cause?: unknown } | null;
  if (r?.status !== 'BLOCKED' || typeof r.cause !== 'string' || !/off-host redirect/.test(r.cause)) {
    problems.push(`what needs the price reading reads ${JSON.stringify(read)}, not BLOCKED, cause off-host redirect`);
  }
  return problems;
}

/** AC6: the key test's cases, each with what it reads and whether the value is saved. */
export type KeyCase = '200' | '401' | '503' | 'timeout' | 'no network';
export const KEY_CASES: { case: KeyCase; test: 'valid' | 'invalid' | 'INCONCLUSIVE'; saved: boolean }[] = [
  { case: '200', test: 'valid', saved: true },
  { case: '401', test: 'invalid', saved: false },
  { case: '503', test: 'INCONCLUSIVE', saved: true },
  { case: 'timeout', test: 'INCONCLUSIVE', saved: true },
  { case: 'no network', test: 'INCONCLUSIVE', saved: true },
];
export function judgeKeyTest(c: KeyCase, entered: unknown, saved: boolean): string[] {
  const want = KEY_CASES.find((k) => k.case === c)!;
  const problems: string[] = [];
  const test = (entered as { test?: unknown } | null)?.test;
  if (test !== want.test) problems.push(`${c}: the key test reads ${JSON.stringify(test)}, not ${want.test}`);
  if (saved !== want.saved) problems.push(`${c}: the value is ${saved ? 'saved' : 'not saved'}${want.test === 'INCONCLUSIVE' ? ': a test that couldn\'t run rejected it' : ''}`);
  return problems;
}
