// #2551 criterion 1: the design's numbered adapter rules (docs/technical-design.md, How we know version 0 works, the
// Conformance tests item) and `adapter.facts@1`'s `x-rules` (the published schema) hold the same rules in the same
// order. Both surfaces are read as files; whichever side a fix changes, the two must agree.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const DESIGN = 'docs/technical-design.md';
const SCHEMA = 'packages/contracts/schemas/adapter.facts@1.json';
const LEAD = 'The adapter rules are one numbered list in `adapter.facts@1`';

interface Rule { id: string; rule: string }

/** Lower case, backticks dropped, curly apostrophes made straight, runs of space made one. */
const norm = (text: string): string => text.toLowerCase().replace(/`/g, '').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();

/** The text of the design's Conformance tests item, under How we know version 0 works. */
function conformanceItem(): string {
  const design = readFileSync(`${ROOT}${DESIGN}`, 'utf8');
  const section = design.split(/^## How we know version 0 works$/m)[1];
  expect(section, `${DESIGN} has a "## How we know version 0 works" section`).toBeDefined();
  const body = section!.split(/^## /m)[0]!;
  const start = body.indexOf('- **Conformance tests**');
  expect(start, 'the section has a Conformance tests item').toBeGreaterThanOrEqual(0);
  const rest = body.slice(start + 2);
  const next = rest.search(/^- \*\*/m);
  return next < 0 ? rest : rest.slice(0, next);
}

/**
 * The design's numbered adapter rules, in order: the phrases after "The adapter rules are one numbered list in
 * `adapter.facts@1`:", read either as the sentence's comma-separated list (as the base writes it) or, when the colon
 * ends its line, as the numbered Markdown lines that follow it.
 */
function designRules(): string[] {
  const item = conformanceItem();
  const at = item.indexOf(LEAD);
  expect(at, `the Conformance tests item says "${LEAD}"`).toBeGreaterThanOrEqual(0);
  const after = item.slice(at + LEAD.length);
  expect(after.startsWith(':'), `"${LEAD}" is followed by a colon and the list`).toBe(true);
  const tail = after.slice(1);
  const firstLine = tail.split('\n')[0]!.trim();
  if (firstLine === '') {
    const lines: string[] = [];
    for (const line of tail.split('\n').slice(1)) {
      const m = /^\s*\d+\.\s+(.*\S)\s*$/.exec(line);
      if (m) lines.push(m[1]!.replace(/[.;,]$/, ''));
      else if (lines.length && line.trim() !== '') break;
    }
    return lines.map(norm);
  }
  const sentence = /^(.*?)\.(?=\s+[A-Z]|\s*$)/s.exec(tail.replace(/\s+/g, ' '))?.[1] ?? '';
  return sentence.split(/,\s+(?:and\s+)?/).map(norm).filter((p) => p !== '');
}

/** `adapter.facts@1`'s `x-rules`, as the published schema holds them. */
function schemaRules(): Rule[] {
  const schema = JSON.parse(readFileSync(`${ROOT}${SCHEMA}`, 'utf8')) as { 'x-rules'?: Rule[] };
  expect(Array.isArray(schema['x-rules']), `${SCHEMA} has an x-rules list`).toBe(true);
  return schema['x-rules']!;
}

describe('#2551 the design\'s numbered adapter rules and adapter.facts@1\'s x-rules', () => {
  it('#2551.89179774 every rule in adapter.facts@1\'s x-rules is named in the design\'s numbered adapter rules, and every rule the design names is in x-rules', () => {
    const phrases = designRules();
    const rules = schemaRules();
    expect(phrases.length, 'the design names its adapter rules').toBeGreaterThan(0);
    const unnamed = rules.filter((r) => !phrases.some((p) => norm(r.rule).includes(p))).map((r) => `${r.id}: ${r.rule}`);
    const missing = phrases.filter((p) => !rules.some((r) => norm(r.rule).includes(p)));
    expect(unnamed, 'x-rules the design\'s list does not name').toEqual([]);
    expect(missing, 'rules the design names that x-rules does not hold').toEqual([]);
  });

  it('#2551.89179774 the design\'s numbered adapter rules and adapter.facts@1\'s x-rules hold the same rules in the same order: rule i of x-rules is the design\'s rule i', () => {
    const phrases = designRules();
    const rules = schemaRules();
    expect(phrases.length, 'the design names its adapter rules').toBeGreaterThan(0);
    expect(rules.length, `x-rules holds as many rules as the design names (design: ${phrases.join(' | ')}; x-rules: ${rules.map((r) => r.id).join(', ')})`).toBe(phrases.length);
    rules.forEach((r, i) => {
      expect(norm(r.rule), `x-rules rule ${i + 1} (${r.id}) is the design's rule ${i + 1}, "${phrases[i]}"`).toContain(phrases[i]);
    });
  });
});
