// The header, field-name and auth-scheme rules are ported from makecindy/cindy
// apps/desktop/src/main/log-upload/redact.ts at commit 82d44ec3eedb923e268ae963114a09849ee62655.
//
// Copyright 2026 XD Inc.
// Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in
// compliance with the License. You may obtain a copy of the License at
// http://www.apache.org/licenses/LICENSE-2.0
// Unless required by applicable law or agreed to in writing, software distributed under the License is
// distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and limitations under the License.
//
// Changed from the original: names are split into parts and a secret word must be a whole part, so
// `input_tokens` keeps its value; the rules are a scan from keyword hits instead of regexes, and keep the
// field name and quotes with the value masked; Cindy's email, home-path and URL-query rules are not ported.

/** Words whose presence in a field name starts a field check: every secret word holds one. */
export const FIELD_TRIGGERS = ['passw', 'pwd', 'secret', 'token', 'key', 'credential', 'authorization', 'cookie'];

const WORDS = new Set(['password', 'passwd', 'pwd', 'secret', 'token', 'credential', 'credentials', 'authorization', 'cookie']);
// The two-word secret words, as two parts or one.
const PAIRS = [['api', 'key'], ['access', 'key'], ['client', 'secret'], ['private', 'key'], ['session', 'key']];
for (const [a, b] of PAIRS) WORDS.add(a! + b!);
const HEADERS = new Set(['authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key']);
const SCHEME = /(?:bearer|basic|digest|negotiate|ntlm|token|bot|apikey|aws4-hmac-sha256)(?=[ \t\r\n]|$)/iy;
const JSON_LITERAL = /(?:-?\d[\d.eE+-]*|true|false|null)(?=[\s,}\]\\]|$)/y;
// The first byte of a JSON number or literal.
const JSON_WORD = /[-\dtfn]/;
const JSON_ESCAPE = /^(?:[bfnrt]|u[\da-f]{4})/i;
// The most of a line a type annotation is read for, so each name costs a bounded read.
const MAX_TYPE = 256;
// The most words a type annotation holds outside its brackets, as `&'static str` or `typeof x` do; prose holds more.
const TYPE_WORDS = 3;
// The extensions of source, config and text files, whose names hold secret words, as `token.ts` does.
const FILE_TYPES = new Set(['c', 'cc', 'cfg', 'cjs', 'conf', 'cpp', 'cs', 'css', 'dart', 'ex', 'exs', 'go', 'h', 'hpp', 'html', 'ini',
  'java', 'js', 'json', 'jsx', 'kt', 'log', 'lua', 'md', 'mjs', 'php', 'pl', 'proto', 'py', 'rb', 'rs', 'scala', 'sh', 'sql', 'svelte',
  'swift', 'tf', 'toml', 'ts', 'tsx', 'txt', 'vue', 'xml', 'yaml', 'yml', 'zig']);
// A line and column after a file's name.
const POSITION = /\d+(?::\d+)?(?![\w.])/y;
// Make's `::=` and `:::=` end with the `:=` read below.
const COMPOUND = /(?:\?\?|\|\||[?+])(?==)|:{1,2}(?=:=)/y;
const STRING_PREFIX = /[bfru]{1,2}(?=\\*["'])/iy;
const sticky = (regex: RegExp, text: string, at: number) => { regex.lastIndex = at; return regex.test(text) ? regex.lastIndex : -1; };
const isQuote = (c: string | undefined) => c === '"' || c === "'" || c === '`';

/** A range to mask, and the text to put there when it isn't the plain mask. */
export type Range = [from: number, to: number, replacement?: string | undefined];

const NAME = Uint8Array.from({ length: 128 }, (_, c) => Number(/[A-Za-z0-9_.-]/.test(String.fromCharCode(c))));
const isNameChar = (c: string | undefined) => c !== undefined && NAME[c.charCodeAt(0)] === 1;
// The most backslashes a quote of a document escaped in strings carries: four layers deep.
const MAX_ESCAPE = 15;
/** Whether `n` backslashes are a quote's escape at some layer: 0, 1, 3, 7 or 15. */
const layered = (n: number) => (n & (n + 1)) === 0;
// A quoted key may hold spaces, as `"API Key"` does; past this many characters it's read as text.
const SPACED_KEY = 64;
const CLOSERS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

// Logs repeat the same few names, so each name is split once.
const named = new Map<string, boolean>();

/** Whether a field name's parts, split at `_`, `-`, `.`, spaces and case changes, hold a secret word. */
export function secretName(name: string): boolean {
  const known = named.get(name);
  if (known !== undefined) return known;
  const parts = name.split(/[_. :-]+/).flatMap((part) => part.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/)).map((part) => part.toLowerCase());
  const secret = parts.some((part, i) => WORDS.has(part) || PAIRS.some(([a, b]) => part === a && parts[i + 1] === b));
  if (named.size >= 4096) named.clear();
  named.set(name, secret);
  return secret;
}

/**
 * The values of secret-named fields and auth headers on the lines of `text`, given positions inside
 * names where a trigger word was found, in ascending order. The field names, separators and quotes stay.
 * Each byte is read a bounded number of times: a hit inside a name or value already read is skipped.
 */
export function fieldRanges(text: string, hits: readonly number[], mask: string): Range[] {
  const ranges: Range[] = [];
  let read = 0;
  const line = new Line(text);
  const brackets = new Brackets(text);
  const push = (range: Range) => { if (range[1] > range[0] || range[2]) ranges.push(range); read = Math.max(read, range[1]); };
  for (const hit of hits) {
    if (hit < read) continue;
    let start = hit;
    // A name never starts with an escaped character, such as the n of a newline escaped in a JSON string,
    // whose backslashes depend on how deep that string is escaped; a `\u` escape is read whole below.
    while (start > read && isNameChar(text[start - 1]) && !(text[start - 2] === '\\' && text[start - 1] !== 'u' && escaped(text, start - 1, (line.end(hit), line.escape)))) start--;
    let at = hit;
    // A path through a module, as Rust's `token::new` or Ruby's `Token::KEY`, is one name.
    while (isNameChar(text[at]) || (text[at] === ':' && text[at + 1] === ':' && isNameChar(text[at + 2]))) at += text[at] === ':' ? 2 : 1;
    if (text[start - 1] === ' ' || text[at] === ' ') [start, at] = spacedKey(text, start, at, read);
    read = at;
    let name = text.slice(start, at);
    // A JSON escape of a string around the one read, as the `\\n` of a JSON string literal in a string or
    // Go's `&` around a body another encoder wrote, may run into the name.
    if (text[start - 1] === '\\') {
      const skip = JSON_ESCAPE.exec(name)?.[0].length ?? 0;
      if (skip && secretName(name.slice(skip))) [start, name] = [start + skip, name.slice(skip)];
    }
    if (!secretName(name)) continue;
    // `::` before a blank is LDIF's separator of a base64 value, as `userPassword:: e1NT...`; before a brace, `<`, `*`
    // or `~` it goes on through a path, as `crate::token::{A, B}` or `Token::<T>` do.
    const ldif = text.startsWith('::', at) && (text[at + 2] === ' ' || text[at + 2] === '\t');
    if (ldif) at++;
    else if (text.startsWith('::', at) && !'=:'.includes(text[at + 2] ?? '=')) continue;
    // A quoted key, as in JSON or JSON escaped in a string once or more, closes with the quote it opened with.
    const before = text[start - 1];
    let slashes = 0;
    if (isQuote(before)) while (slashes < MAX_ESCAPE && text[start - 2 - slashes] === '\\') slashes++;
    const keyQuote = isQuote(before) && layered(slashes) ? '\\'.repeat(slashes) + before : '';
    const quotedKey = keyQuote !== '' && text.startsWith(keyQuote, at);
    if (quotedKey) at += keyQuote.length;
    // An optional or definite member, as TypeScript's `password?: string = x`, keeps its mark with the name; it
    // is one only with an annotation and an `=` after it (below), as an elvis's `token?: fallback` never has.
    const member = !quotedKey && (text[at] === '?' || text[at] === '!') && text[at + 1] === ':';
    if (member) at++;
    const spaced = text[at] === ' ' || text[at] === '\t';
    at = skipBlanks(text, at);
    // A compound assignment, as Make's `?=` and `+=` or `||=` and `??=`, assigns as `=` does.
    if (!quotedKey) at = Math.max(at, sticky(COMPOUND, text, at));
    const separator = text[at];
    if (separator !== ':' && separator !== '=') continue;
    // A position in a file, as `src/token.rs:10:5` in a stack trace or grep's output, is no field.
    if (separator === ':' && FILE_TYPES.has(name.slice(name.lastIndexOf('.') + 1).toLowerCase()) && sticky(POSITION, text, at + 1) > 0) continue;
    // `==` and `===` compare; `:=` and `=>` assign, each one separator, and `=>` only a quoted value, as in a
    // hash, never an arrow function's body.
    if (separator === '=' && text[at + 1] === '=') continue;
    const arrow = separator === '=' && text[at + 1] === '>';
    if (arrow || (separator === ':' && text[at + 1] === '=')) at++;
    // `PASSWORD= USER=bob` has an empty value; `secret = x` and `password: x` don't.
    if (separator === '=' && !spaced && (text[at + 1] === ' ' || text[at + 1] === '\t')) continue;
    at = skipBlanks(text, at + 1);
    const eol = line.end(at);
    if (at >= eol) continue;
    // A header's whole value goes, to the end of the line.
    // Names in it are still read, as its string may end early at a quote the text never escaped.
    if (!quotedKey && separator === ':' && HEADERS.has(name.toLowerCase())) { ranges.push([at, eol]); continue; }
    // An LDIF value goes on through the lines after it that start with one space, as ldapsearch folds them.
    if (ldif) {
      let end = eol;
      for (;;) {
        const next = text.startsWith('\r\n', end) ? end + 2 : text[end] === '\n' ? end + 1 : -1;
        if (next < 0 || text[next] !== ' ' || text[next + 1] === ' ') break;
        const newline = text.indexOf('\n', next);
        end = newline < 0 ? text.length : text[newline - 1] === '\r' ? newline - 1 : newline;
      }
      push([at, end]);
      continue;
    }
    // A URL user's password, as in `https://x-access-token:k@host/r`, ends with its authority (below).
    const url = text.startsWith('://', start - 3) || text.startsWith(':\\/\\/', start - 5);
    // A type annotation, as in `password: str = x` or `token: string = x`, is masked and the value after it read.
    if (!quotedKey && !url && !ldif && separator === ':') {
      const type = annotationEnd(text, at, eol);
      if (type > 0) { push([at, type]); at = skipBlanks(text, skipBlanks(text, type) + 1); } else if (member) continue;
      if (at >= eol) continue;
    }
    // A string prefix, as in `b"..."` or `f"..."`, stays with the quote it opens.
    const prefix = sticky(STRING_PREFIX, text, at);
    if (prefix > 0) at = prefix;
    // A quote as printed, or escaped in a string once (`\"`) or more (`\\\"`, ...).
    let quoteAt = at;
    while (quoteAt - at < MAX_ESCAPE && text[quoteAt] === '\\') quoteAt++;
    const valueQuote = isQuote(text[quoteAt]) && layered(quoteAt - at) ? text.slice(at, quoteAt + 1) : '';
    if (arrow && !valueQuote) continue;
    // A triple-quoted string, as Python's `"""x"""`, closes with three of its quotes.
    const triple = valueQuote.repeat(3);
    if (valueQuote && text.startsWith(triple, at)) {
      const close = text.indexOf(triple, at + triple.length);
      push([at + triple.length, close < 0 || close > eol ? eol : close]);
      continue;
    }
    // After a bare name, a quote before a call's `)`, a statement's `;` or the next argument closes a string, as in
    // `input("Password: ")`; under a quoted key it opens the value.
    if (valueQuote && !quotedKey && ');,'.includes(text[quoteAt + 1] ?? '\n')) continue;
    if (valueQuote) {
      const from = at + valueQuote.length;
      // A quoted value with no closing quote is masked to the end of its line or of the string it is escaped in.
      push([from, closingQuote(text, from, eol, valueQuote)[0]]);
      continue;
    }
    if (sticky(SCHEME, text, at) > 0) { push([at, eol]); continue; }
    // A JSON value that isn't a string becomes one, so the document still parses.
    const json = quotedKey && keyQuote.endsWith('"') ? `${keyQuote}${mask}${keyQuote}` : undefined;
    // Where the bare value below is read from: past a group in brackets it starts with.
    let scan = at;
    if (text[at] === '{' || text[at] === '[') {
      // Under a JSON key the value may run past its line, as pretty-printed JSON's do; escaped in a string,
      // it ends with that string, which ends on its line. One that never closes is masked as far as it reads
      // as JSON.
      let escape = keyQuote.slice(0, -1);
      // Under a bare name, as in `password={\"a\":1}` in a string, the value's first quote shows how it is escaped.
      if (!quotedKey) {
        let quote = skipBlanks(text, at + 1);
        // Past the escaped newlines and indent of a value printed pretty.
        for (let k = quote; text[k] === '\\'; quote = k = skipBlanks(text, k + 1)) {
          while (text[k] === '\\') k++;
          if (!'ntr'.includes(text[k]!)) break;
        }
        let after = quote;
        while (after - quote < MAX_ESCAPE && text[after] === '\\') after++;
        if (after > quote && text[after] === '"' && layered(after - quote)) escape = text.slice(quote, after);
      }
      const [far, closed] = json && !escape && !line.quoted ? brackets.end(at) : [-1, false];
      if (closed) { push([at, far, json]); continue; }
      const [end, ended] = nestedEnd(text, at, escape && (json || !quotedKey) ? line.newline : eol, escape);
      // After a bare name, a scheme in braces, as `{bcrypt}$2a$...` or `{SSHA}W6ph...`, starts a value read on below;
      // a call on the group, as `{...}.get(x)`, or a quote, escaped or not, ends it.
      let next = end;
      while (text[next] === '\\') next++;
      if (!(ended && !quotedKey && end < eol && !isQuote(text[next]) && !' \t\r\f\v;,.)]}'.includes(text[end]!))) {
        push(ended ? [at, end, json] : [at, Math.max(end, far)]);
        continue;
      }
      scan = end;
    }
    const literal = json ? sticky(JSON_LITERAL, text, at) : -1;
    if (literal > 0) { push([at, literal, json]); continue; }
    // A bare value takes escapes whole and stops before an escaped quote, so a string around it still closes;
    // `&` or a fragment's `#` ends it in a URL's query, as `?a=1&token=x&b=2`, and `&` leaves a value it starts empty; a bracket it
    // didn't open ends it, as in `(password=x)`.
    // Go's JSON escapes a query's `&` as `&`.
    const query = text[start - 1] === '?' || text[start - 1] === '&' || (text.startsWith('u0026', start - 5) && text[start - 6] === '\\');
    // A URL user's password ends at `/`, `?` or `#` or a `<>` around the URL, and may hold `;` and `,`.
    const stops = url ? ' \t\r\f\v"\'`<>' : ' \t\r\f\v;,"\'`';
    const open: string[] = [];
    let end = scan;
    while (end < eol && !stops.includes(text[end]!) && !(text[end] === '&' && (query || end === at))) {
      const c = text[end]!;
      if ((url && '/?#'.includes(c)) || (query && c === '#')) break;
      if (c in CLOSERS && open.at(-1) !== CLOSERS[c]) {
        // A bracket it didn't open ends it only where the value would end anyway, as in `(password=x).`
        let next = end;
        while (next < eol && ')]}.!?:'.includes(text[next]!)) next++;
        if (next === eol || ' \t\r\f\v;,"\''.includes(text[next]!)) break;
        end = next;
        continue;
      }
      if (c in CLOSERS) open.pop();
      else if (c === '(' || c === '[' || c === '{') open.push(c);
      if (c !== '\\') { end++; continue; }
      // A run of backslashes is read as the string the value sits in reads it: its escaped backslashes are the
      // value's, and a quote after them ends it.
      let j = end;
      while (j < eol && text[j] === '\\') j++;
      const n = j - end;
      const p = line.escape;
      if ((query && text.startsWith('u0026', j)) || (url && text[j] === '/')) break;
      if (j < eol && text[j] === '"') {
        const kind = layer(n, p);
        if (kind !== 'outer') end = j - (kind === 'quote' ? p : 2 * p + 1);
        break;
      }
      // An odd last backslash before `'` escapes it, as in a Python string, and stays with it.
      if (j < eol && text[j] === "'") { end += n - (n % (p ? p + 1 : 2)); break; }
      end = Math.min(j + 1, eol);
    }
    // Its host, after the last `@`, stays; with no `@`, digits are the port of a host the name is part of, as in
    // `http://token:5000/api` or a list's `http://secret:8200,http://b`, and anything else is a password whose
    // host was cut off.
    if (url) {
      const value = text.slice(at, end);
      const host = value.lastIndexOf('@');
      if (host >= 0) end = at + host;
      else if (/^\d+(?:[.,;:!?)\]]|$)/.test(value)) continue;
    }
    // Sentence punctuation after a value is the sentence's: `password=x.` ends a sentence.
    while (end > at && '.!?:'.includes(text[end - 1]!) && (end === eol || ' \t\r\n'.includes(text[end]!))) end--;
    push([at, end]);
  }
  return ranges;
}

/** The quoted key with spaces around a name, as `"API Key": x`, or the name itself; quoted text with no separator after it is no key. */
function spacedKey(text: string, start: number, at: number, read: number): [number, number] {
  let from = start;
  let to = at;
  while (from > read && start - from < SPACED_KEY && (isNameChar(text[from - 1]) || text[from - 1] === ' ')) from--;
  while (to - at < SPACED_KEY && (isNameChar(text[to]) || text[to] === ' ')) to++;
  const separator = text[skipBlanks(text, to + 1)];
  return isQuote(text[from - 1]) && text[to] === text[from - 1] && (separator === ':' || separator === '=') ? [from, to] : [start, at];
}

/** Whether the character at `at` is escaped in a string whose quotes carry `p` backslashes: an odd number of runs of p + 1 before it. */
function escaped(text: string, at: number, p: number): boolean {
  let n = 0;
  while (text[at - 1 - n] === '\\') n++;
  return n % (p + 1) === 0 && (n / (p + 1)) % 2 === 1;
}

/**
 * Where a value's line ends. On a line that is JSON (or a Python dict or list), a value inside a string
 * ends with the innermost string it sits in, escaped once or twice in another or not, at its closing quote
 * or an escaped newline, so a mask never takes the quote or the lines a string holds. Positions come in
 * ascending order, so each byte is read once per line, and each string's end is found once.
 */
class Line {
  /** Where the line read last ends, at its newline or the text's end. */
  newline = -1;
  private start = 0;
  private json = false;
  private apostrophes = false;
  private pos = 0;
  /** The strings open at `pos`, innermost last: the backslashes its quotes carry (-1 for a `'` string), its end once found, and where its text starts. */
  private open: [quote: number, stop: number, from: number][] = [];
  /** Whether the position last asked about is inside a string of a JSON line. */
  get quoted(): boolean { return this.json && this.open.length > 0; }
  /** The backslashes a quote carries in the string the position last asked about sits in, 0 outside one. */
  escape = 0;
  constructor(private readonly text: string) {}

  end(at: number): number {
    const text = this.text;
    if (this.newline < at) {
      this.start = text.lastIndexOf('\n', at - 1) + 1;
      this.newline = Math.min(text.indexOf('\n', at) >>> 0, text.length);
      // `{"`, `{'`, `[{`, `["` and the like open a document, and `"key": x,` is a line of one printed
      // pretty; `[req 5"]` or `[2026-10-27]` opens a log line. Only a document opened with `'`, as a Python
      // dict is, has `'` strings.
      let first = skipBlanks(text, this.start);
      const second = text[skipBlanks(text, first + 1)];
      this.json = (text[first] === '{' && second !== undefined && '"\'}'.includes(second)) || (text[first] === '[' && second !== undefined && '{["\']'.includes(second))
        || (text[first] === '"' && prettyLine(text, first, this.newline));
      this.apostrophes = second === "'";
      // After a timestamp or other log prefix, the document starts at its first `{"`, `[{` or `["`.
      for (let k = first; !this.json && k < this.newline - 1; k++) {
        if ((text[k] === '{' && text[k + 1] === '"') || (text[k] === '[' && (text[k + 1] === '{' || text[k + 1] === '"'))) [first, this.json] = [k, true];
      }
      [this.pos, this.open] = [this.json ? first : this.start, []];
    }
    const eol = this.newline - (text[this.newline - 1] === '\r' ? 1 : 0);
    this.escape = 0;
    if (!this.json) return eol;
    const open = this.open;
    while (this.pos < at) {
      const c = text[this.pos]!;
      const top = open.at(-1)?.[0];
      if (top === -1) {
        if (c === "'") open.pop();
        this.pos += c === '\\' ? 2 : 1;
        continue;
      }
      if (c === "'" && top === undefined && this.apostrophes) { open.push([-1, -1, this.pos + 1]); this.pos++; continue; }
      if (c !== '\\' && c !== '"') { this.pos++; continue; }
      let j = this.pos;
      while (j < eol && text[j] === '\\') j++;
      const run = this.pos;
      const n = j - run;
      this.pos = j + 1;
      if (text[j] !== '"') continue;
      // Outside strings a quote opens one; inside, it closes the innermost, opens one of a document escaped in
      // it where a JSON string may start, or closes outer ones. Elsewhere an escaped quote is the string's text.
      if (top === undefined) { if (n % 2 === 0) open.push([0, -1, this.pos]); }
      else if (layer(n, top) === 'quote') open.pop();
      else if (layer(n, 2 * top + 1) === 'quote') { if (stringStarts(text, run, open.at(-1)![2])) open.push([2 * top + 1, -1, this.pos]); }
      else if (layer(n, top) === 'outer') while (open.length && layer(n, open.pop()![0]) !== 'quote');
    }
    // The innermost string that ends past `at`: a quote read as opening a string escaped in another may be
    // an unbalanced escaped quote, as in `5\" wide`, and then the value's own quote seems to close it.
    for (let level = open.length - 1; level >= 0; level--) {
      const string = open[level]!;
      if (string[1] < at) string[1] = stringEnd(text, Math.max(at, this.pos), eol, string[0]);
      // A value at its string's closing quote, with the document going on after it, is empty, as after the
      // `Enter password:` of a prompt; one escaped in text, as in `password: \"x`, opens the value.
      let quote = at;
      while (text[quote] === '\\') quote++;
      const own = string[0] < 0 ? text[at] === "'" : text[quote] === '"' && layer(quote - at, string[0]) === 'quote';
      const after = string[1] === at && own ? skipBlanks(text, quote + 1) : -1;
      // One at its string's escaped newline is empty too, as its line in that string ends there.
      const newline = string[1] === at && quote > at && (text[quote] === 'n' || text[quote] === 'r');
      if (string[1] > at || newline || (after >= 0 && (after >= eol || ',}]:'.includes(text[after]!)))) { this.escape = Math.max(string[0], 0); return string[1]; }
    }
    this.escape = 0;
    return eol;
  }
}

/** Whether a string of a document escaped in a string may open at `run`: after `{`, `[`, `,` or `:` and blanks, as no document opens with a quote. */
function stringStarts(text: string, run: number, from: number): boolean {
  let k = run - 1;
  while (k >= from) {
    if (text[k] === ' ' || text[k] === '\t') k--;
    // An escaped newline or tab of a document printed pretty, escaped once or more.
    else if ('ntr'.includes(text[k]!) && text[k - 1] === '\\') { k--; while (k >= from && text[k] === '\\') k--; }
    else break;
  }
  return k >= from && '{[,:'.includes(text[k]!);
}

/** Whether a line opening with a string at `first` is a line of pretty-printed JSON: `"key": ...` or a lone `"value",`. */
function prettyLine(text: string, first: number, newline: number): boolean {
  let i = first + 1;
  while (i < newline && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
  if (i >= newline) return false;
  let next = skipBlanks(text, i + 1);
  if (text[next] === ':') return true;
  if (text[next] === ',') next = skipBlanks(text, next + 1);
  if (text[next] === '\r') next++;
  return next >= newline;
}

/** Where a string whose quotes carry `p` backslashes (-1 for a `'` string) ends: its closing quote, an outer one, or an escaped newline. */
function stringEnd(text: string, from: number, eol: number, p: number): number {
  let i = from;
  if (p < 0) {
    while (i < eol && text[i] !== "'" && !(text[i] === '\\' && (text[i + 1] === 'n' || text[i + 1] === 'r'))) i += text[i] === '\\' ? 2 : 1;
    return Math.min(i, eol);
  }
  while (i < eol) {
    if (text[i] !== '\\' && text[i] !== '"') { i++; continue; }
    let j = i;
    while (j < eol && text[j] === '\\') j++;
    const n = j - i;
    // The string's escaped backslashes before its closing quote or an escaped newline are its own.
    if (text[j] === '"') {
      const kind = layer(n, p);
      if (kind === 'quote') return j - p;
      if (kind === 'outer') return i;
    // `n` backslashes before an `n` are an escaped newline of this string unless they're its escaped backslashes.
    } else if (n && (text[j] === 'n' || text[j] === 'r') && (n % (p + 1) || (n / (p + 1)) % 2)) return n % (p + 1) ? i : j - p - 1;
    i = j + 1;
  }
  return Math.min(i, eol);
}

/**
 * Where a type annotation before an assignment's `=` ends, as `str`, `Optional[Dict[str, str]]`,
 * `Annotated[str, Field(min_length=8)]`, `Map<K, () => V>`, `str | None`, `&'static str`, `String?`, `typeof x`
 * or a quoted `"Optional[str]"`, escaped in a string or not; -1 if none. Brackets and quotes nest and may hold
 * anything; outside them a comparison, a comment, the end of an argument or more words than a type has end it.
 */
function annotationEnd(text: string, at: number, eol: number): number {
  const limit = Math.min(eol, at + MAX_TYPE);
  const open: string[] = [];
  // A word after `|` or `&` starts a member of a union or intersection, which holds its own words.
  let [words, word, member, end] = [0, false, false, at];
  for (let i = at; i < limit; i++) {
    const c = text[i]!;
    if (c === ' ' || c === '\t') { word = false; continue; }
    const top = open.length === 0;
    if (top && !word && !'|&='.includes(c) && !(c === '-' && text[i + 1] === '>')) {
      if (member) [words, member] = [0, false];
      if (++words > TYPE_WORDS) return -1;
    }
    word = true;
    // A quote, escaped in a string or not, runs to the same quote; a `'` after `&` or `<` starts a Rust lifetime.
    let q = i;
    while (q < limit && text[q] === '\\') q++;
    if (q > i && !isQuote(text[q])) return -1;
    if (isQuote(text[q]) && !(text[q] === "'" && (text[i - 1] === '&' || text[i - 1] === '<'))) {
      const quote = text.slice(i, q + 1);
      const close = text.slice(q + 1, limit).indexOf(quote);
      if (close < 0) return -1;
      i = q + close + quote.length;
      end = i + 1;
      continue;
    }
    // An arrow, as in `() => V` or `fn() -> V`, is part of the type.
    if ((c === '=' || c === '-') && text[i + 1] === '>') { i++; word = false; end = i + 1; continue; }
    // The `=` assigns a value on its line or, after a blank, on the next, as a formatter breaks a long one;
    // base64's padding, as in `{SSHA}W6ph=`, has neither.
    if (c === '=' && top) {
      const valued = skipBlanks(text, i + 1) < eol || text[i - 1] === ' ' || text[i - 1] === '\t';
      return end > at && text[i + 1] !== '=' && !'!<>'.includes(text[i - 1]!) && valued ? end : -1;
    }
    if (c === '[' || c === '(' || c === '{' || c === '<') {
      if (c === '<' && text[i + 1] === '=') return -1;
      open.push(c);
    } else if (c === ']' || c === ')' || c === '}' || c === '>') {
      if (open.pop() !== { ']': '[', ')': '(', '}': '{', '>': '<' }[c]) return -1;
    } else if (top && (c === ',' || c === ';' || c === '#' || (c === '/' && text[i + 1] === '/'))) return -1;
    if (c === '|' || c === '&') [word, member] = [false, member || top];
    end = i + 1;
  }
  return -1;
}

function skipBlanks(text: string, at: number): number {
  while (text[at] === ' ' || text[at] === '\t') at++;
  return at;
}

/**
 * Where an object or array value ends, past its closing bracket, skipping strings, and whether it closed
 * before `limit`; if not, where reading stopped. `escape` is the backslashes before each quote of a document
 * escaped in a string (`\` once, `\\\` twice), and a quote of an outer layer ends that string.
 */
function nestedEnd(text: string, from: number, limit: number, escape: string): [number, boolean] {
  let depth = 0;
  for (let i = from; i < limit; i++) {
    const c = text[i]!;
    if (c === '\\' || c === '"' || (!escape && isQuote(c))) {
      let j = i;
      while (j < limit && text[j] === '\\') j++;
      const quote = text[j];
      if (j >= limit || !(quote === '"' || (!escape && isQuote(quote)))) { i = j; continue; }
      const kind = layer(j - i, escape.length);
      if (kind === 'outer') return [i, false];
      if (kind === 'escaped') { i = j; continue; }
      const [close, closed] = closingQuote(text, j + 1, limit, escape + quote);
      if (!closed) return [close, false];
      i = close + escape.length;
    } else if (c === '{' || c === '[') depth++;
    else if ((c === '}' || c === ']') && --depth === 0) return [i + 1, true];
  }
  return [limit, false];
}

/**
 * Where a quoted value's closing quote starts, and whether it closed before `end`; if not, where its string
 * ended: at a quote of an outer layer, or `end`. The quote is printed (`"`), escaped once (`\"`) or twice (`\\\"`).
 */
function closingQuote(text: string, from: number, end: number, quote: string): [number, boolean] {
  const p = quote.length - 1;
  const q = quote[p]!;
  for (let i = from; i < end; i++) {
    if (text[i] !== '\\' && text[i] !== q) continue;
    let j = i;
    while (j < end && text[j] === '\\') j++;
    if (j >= end || text[j] !== q) { i = j; continue; }
    const kind = layer(j - i, p);
    if (kind === 'outer') return [i, false];
    if (kind === 'quote') return [j - p, true];
    i = j;
  }
  return [end, false];
}

/**
 * What `n` backslashes and a quote are in a document whose quotes carry `p` of them (0, 1 or 3): its own
 * quote after an even count of its escaped backslashes (each `p + 1` of them), a quote its strings escape,
 * or a quote of a layer outside it.
 */
function layer(n: number, p: number): 'quote' | 'escaped' | 'outer' {
  if (n < p || (n - p) % (p + 1)) return 'outer';
  return ((n - p) / (p + 1)) % 2 ? 'escaped' : 'quote';
}

/**
 * Where each bracket of plain JSON closes, read once forward across lines, as pretty-printed JSON needs.
 * Reading stops at the first token that can't be JSON there, so prose or a broken document after an
 * unclosed value never closes it. Positions come in ascending order, so each byte is read once.
 */
class Brackets {
  private pos = 0;
  private readonly closer = new Map<number, number>();
  constructor(private readonly text: string) {}

  /**
   * Past the bracket that closes the one at `at`, and true; or, if the JSON from `at` doesn't close it,
   * how far it reads as JSON: past its last whole value or separator, or to the end of a string cut off by its line.
   */
  end(at: number): [number, boolean] {
    if (at < this.pos) { const close = this.closer.get(at); return close === undefined ? [-1, false] : [close, true]; }
    const text = this.text;
    const open: number[] = [];
    // Past the last opener, separator or value read: as far as the text reads as JSON, keys aside.
    let good = at;
    // What may come next: an object's key, its `:`, a value, or what follows one (`,` or a closer).
    let expect: 'key' | 'colon' | 'value' | 'after' = 'value';
    let empty = false;
    for (this.pos = at; this.pos < text.length; this.pos++) {
      const c = text[this.pos]!;
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') continue;
      if (c === ',') {
        if (expect !== 'after') return [good, false];
        [expect, good] = [text[open.at(-1)!] === '{' ? 'key' : 'value', this.pos + 1];
        continue;
      }
      if (c === ':') { if (expect !== 'colon') return [good, false]; [expect, good] = ['value', this.pos + 1]; continue; }
      if (c === '}' || c === ']') {
        const opener = open.pop()!;
        if ((expect !== 'after' && !empty) || text[opener] !== (c === '}' ? '{' : '[')) return [good, false];
        this.closer.set(opener, this.pos + 1);
        if (opener === at) return [++this.pos, true];
        [expect, empty, good] = ['after', false, this.pos + 1];
        continue;
      }
      if (expect === 'key' ? c !== '"' : expect !== 'value') return [good, false];
      if (c === '{' || c === '[') { open.push(this.pos); [expect, empty, good] = [c === '{' ? 'key' : 'value', true, this.pos + 1]; continue; }
      empty = false;
      if (c === '"') {
        // A JSON string ends on its line.
        let i = this.pos + 1;
        while (i < text.length && text[i] !== '"' && text[i] !== '\n') i += text[i] === '\\' && text[i + 1] !== '\n' ? 2 : 1;
        if (text[i] !== '"') { this.pos = i; return [i, false]; }
        this.pos = i;
        if (expect === 'key') expect = 'colon';
        else [expect, good] = ['after', i + 1];
        continue;
      }
      const word = JSON_WORD.test(c) ? sticky(JSON_LITERAL, text, this.pos) : -1;
      if (word < 0) return [good, false];
      [this.pos, expect, good] = [word - 1, 'after', word];
    }
    return [this.pos, false];
  }
}
