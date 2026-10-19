// Test-side reader for the vendored gitleaks default config (fixtures/gitleaks-v8.30.1, MIT, see its
// LICENSE). It parses the rules, converts each Go RE2 pattern to a JavaScript RegExp, and generates a
// key each rule matches the way gitleaks itself would report it: the regex matches, a keyword is
// present, the secret's entropy is above the rule's threshold, and no allowlist drops it.
// None of this is the redactor under test; it only builds the fixtures criterion 13 names.

import { readFileSync } from 'node:fs';
import { mulberry32, type Rng } from './helpers.ts';

export const GITLEAKS_TAG = 'v8.30.1';
export const GITLEAKS_COMMIT = '83d9cd684c87d95d656c1458ef04895a7f1cbd8e';
const configPath = new URL(`./fixtures/gitleaks-${GITLEAKS_TAG}/gitleaks.toml`, import.meta.url);

export interface Allowlist {
  regexes: string[];
  stopwords: string[];
  paths: string[];
  regexTarget: 'secret' | 'match' | 'line';
  condition: 'OR' | 'AND';
}
export interface Rule {
  id: string;
  regex?: string;
  path?: string;
  entropy?: number;
  secretGroup?: number;
  keywords: string[];
  allowlists: Allowlist[];
}

// ---- A TOML reader for the subset this file uses: tables, arrays of tables, strings, numbers, arrays.
type Value = string | number | Value[];
function parseToml(text: string): { global: Record<string, Value>; rules: Record<string, Value>[]; ruleAllowlists: Record<string, Value>[][] } {
  let i = 0;
  const global: Record<string, Value> = {};
  const rules: Record<string, Value>[] = [];
  const ruleAllowlists: Record<string, Value>[][] = [];
  let target: Record<string, Value> = {}; // top-level keys are ignored
  const skip = () => {
    for (;;) {
      while (i < text.length && /\s/.test(text[i]!)) i++;
      if (text[i] === '#') { while (i < text.length && text[i] !== '\n') i++; continue; }
      break;
    }
  };
  const value = (): Value => {
    skip();
    if (text.startsWith("'''", i)) { const end = text.indexOf("'''", i + 3); const s = text.slice(i + 3, end); i = end + 3; return s; }
    if (text[i] === "'") { const end = text.indexOf("'", i + 1); const s = text.slice(i + 1, end); i = end + 1; return s; }
    if (text[i] === '"') {
      let s = ''; i++;
      while (text[i] !== '"') {
        if (text[i] === '\\') { const c = text[i + 1]!; s += c === 'n' ? '\n' : c === 't' ? '\t' : c; i += 2; } else s += text[i++];
      }
      i++; return s;
    }
    if (text[i] === '[') {
      i++; const items: Value[] = [];
      for (;;) { skip(); if (text[i] === ']') { i++; return items; } items.push(value()); skip(); if (text[i] === ',') i++; }
    }
    const m = /^[-+]?[0-9.]+/.exec(text.slice(i));
    if (!m) throw Error(`gitleaks.toml: unreadable value at ${i}: ${text.slice(i, i + 40)}`);
    i += m[0].length; return Number(m[0]);
  };
  for (;;) {
    skip();
    if (i >= text.length) break;
    if (text.startsWith('[[rules.allowlists]]', i)) { i += 20; target = {}; ruleAllowlists[ruleAllowlists.length - 1]!.push(target); continue; }
    if (text.startsWith('[[rules]]', i)) { i += 9; target = {}; rules.push(target); ruleAllowlists.push([]); continue; }
    if (text.startsWith('[allowlist]', i)) { i += 11; target = global; continue; }
    const key = /^[A-Za-z_]+/.exec(text.slice(i));
    if (!key) throw Error(`gitleaks.toml: unreadable key at ${i}`);
    i += key[0].length; skip();
    if (text[i] !== '=') throw Error(`gitleaks.toml: expected = after ${key[0]}`);
    i++;
    target[key[0]] = value();
  }
  return { global, rules, ruleAllowlists };
}

const strings = (v: Value | undefined) => (Array.isArray(v) ? v.map(String) : []);
const toAllowlist = (t: Record<string, Value>): Allowlist => ({
  regexes: strings(t.regexes),
  stopwords: strings(t.stopwords),
  paths: strings(t.paths),
  regexTarget: (t.regexTarget as Allowlist['regexTarget'] | undefined) ?? 'secret',
  condition: (t.condition as Allowlist['condition'] | undefined) ?? 'OR',
});

export function loadGitleaks(): { rules: Rule[]; global: Allowlist } {
  const parsed = parseToml(readFileSync(configPath, 'utf8'));
  const rules = parsed.rules.map((r, n): Rule => ({
    id: String(r.id),
    ...(r.regex !== undefined && { regex: String(r.regex) }),
    ...(r.path !== undefined && { path: String(r.path) }),
    ...(r.entropy !== undefined && { entropy: Number(r.entropy) }),
    ...(r.secretGroup !== undefined && { secretGroup: Number(r.secretGroup) }),
    keywords: strings(r.keywords).map((k) => k.toLowerCase()),
    allowlists: parsed.ruleAllowlists[n]!.map(toAllowlist),
  }));
  return { rules, global: toAllowlist(parsed.global) };
}

// ---- Go RE2 to JavaScript.
const posix: Record<string, string> = {
  alnum: 'a-zA-Z0-9', alpha: 'a-zA-Z', digit: '0-9', xdigit: '0-9A-Fa-f', upper: 'A-Z', lower: 'a-z',
  space: '\\t\\n\\v\\f\\r ', word: '\\w', punct: '!-\\/:-@\\[-`{-~',
};

/**
 * Converts a Go RE2 pattern to a JavaScript RegExp with no flags and no inline modifiers: case-insensitive
 * regions are spelled out as [aA] and case-closed classes, and (?s) dots as [\s\S]. (V8 12.9 in Node 23
 * mis-matches modifier groups such as /x(?i:[a-z0-9]{5})/ against "xAb1Ab", so the oracle avoids them.)
 */
export function goRegExp(go: string): RegExp {
  let out = '';
  let ci = false;
  let dotAll = false;
  const saved: { ci: boolean; dotAll: boolean }[] = [];
  const setFlags = (on = '', off = '') => {
    if (on.includes('i')) ci = true;
    if (on.includes('s')) dotAll = true;
    if (off.includes('i')) ci = false;
    if (off.includes('s')) dotAll = false;
  };
  const other = (ch: string) => (ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase());
  let i = 0;
  while (i < go.length) {
    const c = go[i]!;
    if (c === '\\') {
      const n = go[i + 1]!;
      if (n === 'z') { out += '$'; i += 2; continue; }
      if (n === 'A') { out += '^'; i += 2; continue; }
      if (n === 'x') { out += go.slice(i, i + 4); i += 4; continue; }
      out += c + n; i += 2; continue;
    }
    if (c === '[') {
      let j = i + 1; let body = ''; const letters = new Set<string>();
      let negate = false;
      if (go[j] === '^') { negate = true; j++; }
      if (go[j] === ']') { body += '\\]'; j++; }
      let prev: string | undefined;
      while (go[j] !== ']') {
        let item: string; let single: string | undefined;
        if (go[j] === '\\') {
          const n = go[j + 1]!;
          if (n === 'x') { item = go.slice(j, j + 4); single = String.fromCharCode(parseInt(go.slice(j + 2, j + 4), 16)); j += 4; }
          else { item = go.slice(j, j + 2); single = 'dDwWsS'.includes(n) ? undefined : ({ t: '\t', n: '\n', r: '\r', f: '\f', v: '\v' } as Record<string, string>)[n] ?? n; j += 2; }
        } else if (go.startsWith('[:', j)) {
          const end = go.indexOf(':]', j); item = posix[go.slice(j + 2, end)] ?? ''; j = end + 2;
          for (const ch of 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ') if (new RegExp(`[${item}]`).test(ch)) letters.add(ch);
        } else if (go[j] === '[') { item = '\\['; single = '['; j++; }
        else { item = go[j]!; single = go[j]; j++; }
        if (single === '-' && prev !== undefined && go[j] !== ']' && !item.startsWith('\\')) {
          // a range prev-next
          let next: string;
          if (go[j] === '\\') { next = go[j + 1] === 'x' ? String.fromCharCode(parseInt(go.slice(j + 2, j + 4), 16)) : go[j + 1]!; body += '-' + go.slice(j, go[j + 1] === 'x' ? j + 4 : j + 2); j += go[j + 1] === 'x' ? 4 : 2; }
          else { next = go[j]!; body += '-' + next; j++; }
          for (let k = prev.charCodeAt(0); k <= next.charCodeAt(0); k++) { const ch = String.fromCharCode(k); if (/[a-zA-Z]/.test(ch)) letters.add(ch); }
          prev = undefined; continue;
        }
        body += item;
        if (single && /[a-zA-Z]/.test(single)) letters.add(single);
        prev = single;
      }
      // Case partners go first, so none lands after a trailing '-' and forms a range.
      if (ci) body = [...letters].filter((ch) => !letters.has(other(ch))).map(other).join('') + body;
      out += `[${negate ? '^' : ''}${body}]`; i = j + 1; continue;
    }
    if (c === '(') {
      saved.push({ ci, dotAll });
      const inline = /^\(\?([a-z]*)(?:-([a-z]*))?\)/.exec(go.slice(i));
      if (inline) { saved.pop(); setFlags(inline[1], inline[2]); i += inline[0].length; continue; }
      const scoped = /^\(\?([a-z]*)(?:-([a-z]*))?:/.exec(go.slice(i));
      if (scoped) { setFlags(scoped[1], scoped[2]); out += '(?:'; i += scoped[0].length; continue; }
      if (go.startsWith('(?P<', i)) { out += '(?<'; i += 4; continue; }
      out += '('; i++; continue;
    }
    if (c === ')') { ({ ci, dotAll } = saved.pop()!); out += ')'; i++; continue; }
    if (c === '.') { out += dotAll ? '[\\s\\S]' : '.'; i++; continue; }
    if (ci && /[a-zA-Z]/.test(c)) { out += `[${c.toLowerCase()}${c.toUpperCase()}]`; i++; continue; }
    out += c; i++;
  }
  return new RegExp(out);
}

// ---- A generator of strings for a JavaScript pattern (the subset goRegExp emits).
type Node =
  | { t: 'alt'; options: Node[][] }
  | { t: 'set'; chars: string; negate: boolean }
  | { t: 'dot' }
  | { t: 'none' }
  | { t: 'rep'; node: Node; min: number; max: number };

const printable = Array.from({ length: 95 }, (_, k) => String.fromCharCode(32 + k)).join('');
const classes: Record<string, string> = {
  d: '0123456789',
  w: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_',
  s: ' ',
};
const complement = (set: string) => [...printable].filter((ch) => !set.includes(ch)).join('');

function parsePattern(src: string): Node {
  let i = 0;
  const escape = (inClass: boolean): string => {
    const n = src[i + 1]!; i += 2;
    if (n in classes) return classes[n]!;
    if ('DWS'.includes(n)) return complement(classes[n.toLowerCase()]!);
    if (n === 't') return '\t';
    if (n === 'n') return '\n';
    if (n === 'r') return '\r';
    if (n === 'f') return '\f';
    if (n === 'v') return '\v';
    if (n === 'x') { const h = src.slice(i, i + 2); i += 2; return String.fromCharCode(parseInt(h, 16)); }
    if (!inClass && (n === 'b' || n === 'B')) return '';
    return n;
  };
  const parseAlt = (): Node => {
    const options: Node[][] = [[]];
    while (i < src.length && src[i] !== ')') {
      if (src[i] === '|') { i++; options.push([]); continue; }
      let atom: Node;
      const c = src[i]!;
      if (c === '(') {
        if (src.startsWith('(?:', i)) i += 3;
        else if (src.startsWith('(?<', i)) i = src.indexOf('>', i) + 1;
        else i++;
        atom = parseAlt();
        i++; // ')'
      } else if (c === '[') {
        i++;
        let negate = false;
        if (src[i] === '^') { negate = true; i++; }
        let chars = '';
        while (src[i] !== ']') {
          let from: string;
          if (src[i] === '\\') { from = escape(true); if (from.length !== 1) { chars += from; continue; } }
          else from = src[i++]!;
          if (src[i] === '-' && src[i + 1] !== ']') {
            i++;
            const to = src[i] === '\\' ? escape(true) : src[i++]!;
            for (let k = from.charCodeAt(0); k <= to.charCodeAt(0); k++) chars += String.fromCharCode(k);
          } else chars += from;
        }
        i++;
        atom = { t: 'set', chars, negate };
      } else if (c === '\\') {
        const set = escape(false);
        atom = set === '' ? { t: 'none' } : { t: 'set', chars: set, negate: false };
      } else if (c === '.') { i++; atom = { t: 'dot' }; }
      else if (c === '^' || c === '$') { i++; atom = { t: 'none' }; }
      else { i++; atom = { t: 'set', chars: c, negate: false }; }
      const q = /^(?:\*|\+|\?|\{(\d+)(?:(,)(\d*))?\})\??/.exec(src.slice(i));
      if (q) {
        i += q[0].length;
        const head = q[0][0];
        let min = 0, max = 0;
        if (head === '*') { min = 0; max = 4; }
        else if (head === '+') { min = 1; max = 5; }
        else if (head === '?') { min = 0; max = 1; }
        else { min = Number(q[1]); max = q[2] ? (q[3] ? Number(q[3]) : min + 8) : min; }
        atom = { t: 'rep', node: atom, min, max };
      }
      options[options.length - 1]!.push(atom);
    }
    return { t: 'alt', options };
  };
  return parseAlt();
}

function emit(node: Node, rng: Rng): string {
  switch (node.t) {
    case 'none': return '';
    // An unescaped dot in these rules usually stands for a literal dot, as in hooks.slack.com.
    case 'dot': return rng() < 0.5 ? '.' : printable[Math.floor(rng() * printable.length)]!;
    case 'set': {
      const pool = node.negate ? complement(node.chars) : node.chars;
      return pool[Math.floor(rng() * pool.length)] ?? 'x';
    }
    case 'rep': {
      // Lean long, so a secret clears its entropy threshold: half the time take the maximum.
      const n = rng() < 0.5 ? node.max : node.min + Math.floor(rng() * (node.max - node.min + 1));
      let s = '';
      for (let k = 0; k < n; k++) s += emit(node.node, rng);
      return s;
    }
    case 'alt': {
      const option = node.options[Math.floor(rng() * node.options.length)]!;
      return option.map((n) => emit(n, rng)).join('');
    }
  }
}

function shannon(s: string): number {
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  const n = [...s].length;
  for (const c of counts.values()) { const p = c / n; h -= p * Math.log2(p); }
  return h;
}

function allowed(list: Allowlist, secret: string, match: string, line: string): boolean {
  const target = list.regexTarget === 'match' ? match : list.regexTarget === 'line' ? line : secret;
  const checks: boolean[] = [];
  if (list.regexes.length) checks.push(list.regexes.some((r) => goRegExp(r).test(target)));
  if (list.stopwords.length) checks.push(list.stopwords.some((w) => secret.toLowerCase().includes(w.toLowerCase())));
  if (list.paths.length) checks.push(false); // evidence text has no repo path
  if (!checks.length) return false;
  return list.condition === 'AND' ? checks.every(Boolean) : checks.some(Boolean);
}

export interface Fixture { rule: string; line: string; secret: string }

/** The log line a rule's generated key sits in, and the secret gitleaks would report from it. */
export function fixtureFor(rule: Rule, global: Allowlist, seed: number, attempts = 400): Fixture | undefined {
  if (!rule.regex) return undefined;
  const re = goRegExp(rule.regex);
  const tree = parsePattern(re.source);
  const rng = mulberry32(seed);
  const prefix = '2026-10-18T12:00:00Z INFO step 4: ';
  for (let n = 0; n < attempts; n++) {
    const key = emit(tree, rng);
    // gitleaks needs one of a rule's keywords somewhere in the text; a real log names its service.
    const named = !rule.keywords.length || rule.keywords.some((k) => key.toLowerCase().includes(k));
    const line = `${prefix}${named ? '' : `${rule.keywords[0]} = `}${key}\n`;
    const m = re.exec(line);
    if (!m) continue;
    let secret = m[0];
    if (m.length >= 2) secret = (rule.secretGroup ? m[rule.secretGroup] : m.slice(1).find((g) => g)) ?? '';
    if (rule.keywords.length && !rule.keywords.some((k) => line.toLowerCase().includes(k))) continue;
    if (rule.entropy !== undefined && shannon(secret) <= rule.entropy) continue;
    if (rule.id.startsWith('generic') && !/[0-9]/.test(secret)) continue;
    if ([global, ...rule.allowlists].some((list) => allowed(list, secret, m[0], line))) continue;
    // A capture group that is only structure (such as "ab12-" in a webhook URL) is not the key:
    // then the whole match is what must not survive.
    const key2 = secret.trim().length >= 8 ? secret.trim() : m[0].trim();
    if (prefix.includes(key2)) continue;
    return { rule: rule.id, line, secret: key2 };
  }
  return undefined;
}
