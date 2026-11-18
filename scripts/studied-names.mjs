// The studied-names list (#1329): scripts/studied-names.json holds the salted SHA-256 hashes of the names of products
// the project only studied, so the public text lane finds such a name without the list naming it. The lane reads a
// line's words (letters and numbers, joined inside by . _ - or '), lowercased: each word, each part of a joined word
// and each run of up to four words is a finding when its hash after the salt is listed.
//
// Run as `node scripts/studied-names.mjs <private list>` (#2405), it checks the maintainers' list, kept outside the
// repo: one name a line, spelled as public text spells it; `plain: <name>` for a name that is also a plain word, which
// is never listed; blank lines and lines starting with # skipped. Each other name, read as the lane reads it whole,
// must hash to an entry. It prints how many names it checked, or the line of each one missing, and never a name.
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const WORD = /[\p{L}\p{N}]+(?:['’._-][\p{L}\p{N}]+)*/gu;
const JOINER = /['’._-]/;
const PHRASE = 4;

/** A list of salted hashes, read as the lane reads a line: whether a form is listed, and a line's listed words and phrases. */
export function matcher({ salt, hashes }) {
  const entries = new Set(hashes);
  const listed = (form) => entries.has(createHash('sha256').update(salt + form.toLowerCase()).digest('hex'));
  const findings = (line) => {
    const words = line.match(WORD) ?? [];
    const found = new Set();
    for (const [i, word] of words.entries()) {
      for (const part of word.split(JOINER)) if (part !== word && listed(part)) found.add(part);
      for (let n = 1; n <= PHRASE && i + n <= words.length; n++) {
        const phrase = words.slice(i, i + n).join(' ');
        if (listed(phrase)) found.add(phrase);
      }
    }
    return [...found];
  };
  return { listed, findings };
}

/** The listed words and phrases in a line of public text. */
export const { listed, findings } = matcher(JSON.parse(readFileSync(new URL('./studied-names.json', import.meta.url), 'utf8')));

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [path] = process.argv.slice(2);
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    console.log(`FAIL the private list could not be read: ${path ? error.code : 'no path given'}; run node scripts/studied-names.mjs <private list>`);
    process.exit(2);
  }
  let checked = 0, plain = 0;
  const missing = [];
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('plain:')) {
      plain += 1;
      continue;
    }
    checked += 1;
    if (!listed((line.match(WORD) ?? []).join(' '))) missing.push(`line ${i + 1}`);
  }
  if (missing.length) {
    console.log(`FAIL ${missing.length} of ${checked} names on the private list hash to no entry of scripts/studied-names.json: ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log(`studied names: all ${checked} names on the private list hash to an entry of scripts/studied-names.json; ${plain} plain words left out`);
}
