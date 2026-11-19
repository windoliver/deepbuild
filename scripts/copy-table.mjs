// The app's copy tables (#2403): crates/deep-app/copy/en.json is the source, each other <tag>.json a translation
// beside it, read the way crates/deep-app/src/copy.rs reads them. A source entry is a string or plural forms (CLDR's
// `one` … `other`, and `zero`, the form a count of 0 reads); a translation entry is `{text, source}`, `text` a string or
// forms and `source` the hash of the English it was written from. A shipped language is any table beside the source.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const TABLES = 'crates/deep-app/copy';
export const SOURCE = 'en';

/** What a translation records of its English: SHA-256, in hex, of the string, or of the plural forms as JSON with the
 *  forms in sorted order (copy.rs `source_hash`). */
export function sourceHash(entry) {
  const text = typeof entry === 'string'
    ? entry
    : JSON.stringify(Object.fromEntries(Object.entries(entry).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))));
  return createHash('sha256').update(text).digest('hex');
}

/** A translation entry's text: a string, or plural forms. */
export const shownOf = (entry) => (typeof entry === 'string' ? entry : entry?.text);

/** Each table under `root`: `{source: {key: entry}, languages: {tag: {key: {text|forms, source}}}}`. */
export function readTables(root) {
  const dir = join(root, TABLES);
  const read = (tag) => JSON.parse(readFileSync(join(dir, `${tag}.json`), 'utf8'));
  const languages = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const tag = file.slice(0, -'.json'.length);
    if (tag !== SOURCE) languages[tag] = read(tag);
  }
  return { source: read(SOURCE), languages };
}

/** The placeholders `{0}`, `{1}` … a text or each of its forms holds, as one sorted list. */
function holes(entry) {
  const texts = typeof entry === 'string' ? [entry] : Object.values(entry ?? {});
  return [...new Set(texts.flatMap((t) => [...String(t).replaceAll('{{', '').matchAll(/\{(\d+)\}/g)].map((m) => m[1])))].sort().join(',');
}

/** Every key a shipped language would draw in English, and every translation whose placeholders differ from its
 *  English: `[{language, key, why: 'missing' | 'stale' | 'placeholders', said}]`, by language then key. */
export function unshown({ source, languages }) {
  const out = [];
  for (const [language, table] of Object.entries(languages)) {
    for (const key of Object.keys(source).sort()) {
      const t = table[key];
      if (t === undefined || shownOf(t) === undefined) {
        out.push({ language, key, why: 'missing', said: `${language} has no translation of ${key} ("${preview(source[key])}"), so it draws its English` });
      } else if (t.source !== sourceHash(source[key])) {
        out.push({ language, key, why: 'stale', said: `${language}'s ${key} is stale: it was written from English that has since changed to "${preview(source[key])}"; translate it again or confirm it` });
      } else if (holes(shownOf(t)) !== holes(source[key])) {
        out.push({ language, key, why: 'placeholders', said: `${language}'s ${key} holds the placeholders {${holes(shownOf(t))}}, its English {${holes(source[key])}}` });
      }
    }
  }
  return out;
}

const preview = (entry) => (typeof entry === 'string' ? entry : entry.other ?? JSON.stringify(entry));

/** Records, on `language`'s `key`, the hash of the English it now reads right against: a translation written again,
 *  or one a person confirmed still reads right. */
export function confirm(root, language, key, text) {
  const { source, languages } = readTables(root);
  if (!(key in source)) throw new Error(`the English table has no key ${key}`);
  const table = languages[language];
  if (!table) throw new Error(`no table for ${language} beside the English`);
  const was = table[key] ?? {};
  const entry = text === undefined ? { ...was } : { text: typeof source[key] === 'string' ? text : JSON.parse(text) };
  if (shownOf(entry) === undefined) throw new Error(`${language} has no translation of ${key} to confirm; give its text`);
  table[key] = { ...entry, source: sourceHash(source[key]) };
  writeFileSync(join(root, TABLES, `${language}.json`), `${JSON.stringify(sorted(table), null, 2)}\n`);
}

const sorted = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
