// Secret patterns come from gitleaks' default rules, vendored unchanged in ../gitleaks/ at tag v8.30.1
// (MIT License, Copyright (c) 2019 Zachary Rice; see ../gitleaks/LICENSE). This file reads them and
// converts each Go RE2 pattern to a JavaScript one.

import { readFileSync } from 'node:fs';

export interface Rule {
  id: string;
  regex: RegExp;
  keywords: string[];
  /** The capture group holding the secret; 0 redacts the whole match. */
  group: number | 'first';
  /** The pattern can span lines, so it reads past the line its keyword is on. */
  multiline: boolean;
}

export function loadRules(): Rule[] {
  const toml = readFileSync(new URL('../gitleaks/gitleaks.toml', import.meta.url), 'utf8');
  const rules: Rule[] = [];
  for (const block of toml.split(/^\[\[rules\]\]$/m).slice(1)) {
    const regex = /^regex = '''(.*)'''$/m.exec(block)?.[1];
    if (regex === undefined) continue; // a rule that matches file paths only
    const id = /^id = "(.*)"$/m.exec(block)![1]!;
    const keywords = [.../^keywords = \[([^\]]*)\]/m.exec(block)?.[1]?.matchAll(/"([^"]*)"/g) ?? []].map((m) => m[1]!);
    const secretGroup = Number(/^secretGroup = (\d+)$/m.exec(block)?.[1] ?? 0);
    // As in gitleaks, the secret is the first non-empty capture group. Named groups only label parts of a
    // token, so a pattern with them is redacted whole.
    const group = secretGroup || (/\((?!\?)/.test(regex.replace(/\\./g, '')) && !regex.includes('(?P<') ? 'first' : 0);
    rules.push({ id, regex: new RegExp(goToJs(regex), 'dg'), keywords, group, multiline: /\\n|\\r|\\s\\S|\(\?s/.test(regex) });
  }
  return rules;
}

/** Converts the RE2 syntax gitleaks uses. A `(?i)` region is spelled out letter by letter. */
function goToJs(go: string): string {
  let out = '';
  let fold = false;
  const outer: boolean[] = [];
  for (let i = 0; i < go.length; i++) {
    const c = go[i]!;
    if (c === '\\') {
      const escape = go[i + 1] === 'x' ? go.slice(i, i + 4) : go.slice(i, i + 2);
      out += escape === '\\z' ? '$' : escape;
      i += escape.length - 1;
    } else if (c === '[') {
      let end = i + 1;
      if (go[end] === '^') end++;
      if (go[end] === ']') end++;
      while (go[end] !== ']') end += go[end] === '\\' ? 2 : go.startsWith('[:', end) ? go.indexOf(':]', end) + 2 - end : 1;
      const body = go.slice(i + 1, end).replaceAll('[:alnum:]', 'a-zA-Z0-9');
      out += `[${fold ? foldClass(body) : body}]`;
      i = end;
    } else if (go.startsWith('(?i)', i)) {
      fold = true; // to the end of the enclosing group
      i += 3;
    } else if (c === '(') {
      outer.push(fold);
      const flags = /^\(\?(-?)([is]+):/.exec(go.slice(i));
      if (flags) {
        if (flags[2]!.includes('i')) fold = !flags[1];
        if (flags[2] === 's') { out += '(?:[\\s\\S]'; i += flags[0].length; continue; } // (?s:.)
        out += '(?:';
        i += flags[0].length - 1;
      } else if (go.startsWith('(?P<', i)) {
        out += '(';
        i = go.indexOf('>', i);
      } else out += '(';
    } else if (c === ')') {
      fold = outer.pop() ?? false;
      out += ')';
    } else out += fold && /[a-z]/i.test(c) ? `[${c.toLowerCase()}${c.toUpperCase()}]` : c;
  }
  return out;
}

/** Adds the other case of every letter and letter range in a character class body. */
function foldClass(body: string): string {
  const swap = (c: string) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase());
  let extra = '';
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\') { i += body[i + 1] === 'x' ? 3 : 1; continue; }
    const from = body[i]!;
    let to = from;
    if (body[i + 1] === '-' && i + 2 < body.length) { to = body[i + 2]!; i += 2; }
    if (/[a-z]/i.test(from) && swap(from) !== from && (from === to || /^(?:[a-z]-[a-z]|[A-Z]-[A-Z])$/.test(`${from}-${to}`)))
      extra += from === to ? swap(from) : `${swap(from)}-${swap(to)}`;
  }
  // Ahead of the body, so a trailing '-' stays a literal.
  return body.startsWith('^') ? `^${extra}${body.slice(1)}` : extra + body;
}
