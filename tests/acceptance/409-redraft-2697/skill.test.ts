// #409.b866029a (AC3): "The skill's text for every craft@1 check matches the check's own description, threshold and
// fix, by a test that fails when they drift"
//
// Blind redraft of tests/acceptance/409/skill.test.ts after #2697 (REDRAFT.md): the craft checks' text an agent reads
// moves from skills/deepbuild/SKILL.md to a guide `deep_kinds` serves, and the skill keeps one craft line naming it.
//
// Surfaces: each craft@1 check states its description, threshold and fix as an entry of the document check registry,
// read through `deep_kinds` (`{op: list, registry: check.kind.doc@1}`, every page), as in the original; the guide is
// read through `deep_kinds` (`{op: read, guide: <name>}`, every page its `next` offset gives). Its name is the one the
// skill's craft line names: every word of each line of skills/deepbuild/SKILL.md that says "craft" is tried as a
// guide's name, and each word `op: read` answers with text is a guide the agent is sent to (REDRAFT.md: The guide's
// name).
//
// asserts: the listing holds one entry from the craft@1 pack for each of the sixteen checks the issue lists, each with
// a description of its own (not the listing's stand-in), a threshold and a fix; the skill's craft line names a guide
// deep_kinds serves; that guide holds, after each check's name, that check's description, threshold and fix (compared
// without backticks or bold, white space collapsed, case ignored). The same comparison reports drift: the guide with
// shot_length's threshold changed by one in its first number, and the checks' statements with shot_length's
// description changed, are each reported against shot_length.
// Wrong programs: the base (the skill's craft section names no guide; deep_kinds serves none for craft), a skill whose
// craft line names no guide or one deep_kinds doesn't serve, and a guide written by hand or from another source, or
// one that drops a check, which drifts from what the checks state.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO } from '../407/helpers.ts';
import { AC, CHECKS, FULL, PROCESSES, SESSIONS, TIMEOUT, arr, isObject, obj, run, show, useBuilds, useFolders, type JsonObject, type JsonValue } from '../409/helpers.ts';

const bin = useBuilds([FULL]);
const folder = useFolders();
const SKILL = join(REPO, 'skills/deepbuild/SKILL.md');

/** What a check states of itself. */
interface Statement { description: string; threshold: string; fix: string }
const text = (v: JsonValue | undefined): string | null => (typeof v === 'string' ? v : null);

/** One `deep-show run` with the given calls, in the original's scenario: its replies. */
const kinds = (calls: JsonObject[]): JsonObject[] =>
  run(bin(FULL), { evidence: folder(), sessions: SESSIONS, processes: PROCESSES, panels: {}, docs: {}, calls });

/** Every page of the document check registry's listing: its entries. */
function entries(): JsonObject[] {
  const out: JsonObject[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 50; page++) {
    const [reply] = kinds([{ call: 'deep_kinds', op: 'list', registry: 'check.kind.doc@1', ...(cursor ? { cursor } : {}) }]);
    const rows = arr(obj(reply, 'deep_kinds list')['registries'], 'deep_kinds list: registries');
    for (const r of rows) for (const e of arr(obj(r, 'a registry row')['entries'] ?? [], 'a registry row: entries')) out.push(obj(e, 'an entry'));
    cursor = typeof reply!['next'] === 'string' ? reply!['next'] : null;
    if (!cursor) break;
  }
  return out;
}

/** Each craft@1 check's own statement, as the listing gives it (on its entry's `value`, else on the entry). */
function statements(): { found: Map<string, Statement>; failures: string[] } {
  const found = new Map<string, Statement>();
  const failures: string[] = [];
  const all = entries();
  for (const check of CHECKS) {
    const mine = all.filter((e) => e['name'] === check && /craft/.test(String(e['pack'] ?? (isObject(e['value']) ? e['value']['pack'] : ''))));
    if (mine.length !== 1) { failures.push(`${check}: ${mine.length} entries of check.kind.doc@1 from the craft@1 pack name it, not one: ${show(all.filter((e) => e['name'] === check), 600)}`); continue; }
    const e = mine[0]!;
    const value = isObject(e['value']) ? e['value'] : {};
    const field = (k: string): string | null => text(value[k]) ?? text(e[k]);
    const s = { description: field('description'), threshold: field('threshold'), fix: field('fix') };
    for (const [k, v] of Object.entries(s)) if (!v || !v.trim()) failures.push(`${check}: its entry states no ${k}: ${show(e, 600)}`);
    if (s.description && /^an entry of /.test(s.description)) failures.push(`${check}: its description is the listing's stand-in, not the check's own: "${s.description}"`);
    if (s.description && s.threshold && s.fix) found.set(check, { description: s.description, threshold: s.threshold, fix: s.fix });
  }
  return { found, failures };
}

/** The skill's lines that say "craft", and every word in them, each a candidate for the guide's name. */
function craftWords(skill: string): { lines: string[]; words: string[] } {
  const lines = skill.split('\n').filter((l) => /craft/i.test(l));
  const words = new Set<string>();
  for (const l of lines) for (const w of l.match(/[A-Za-z0-9][A-Za-z0-9@._/-]*/g) ?? []) words.add(w.replace(/[.@_/-]+$/, ''));
  return { lines, words: [...words].filter((w) => w !== '') };
}

/** A guide's whole text through `deep_kinds {op: read, guide}`, every page joined; `failure` when a page isn't served. */
function guideText(name: string, first: JsonObject): { text: string; failure?: string } {
  let reply: JsonObject | undefined = first;
  let out = '';
  let offset = 0;
  for (let page = 0; page < 64; page++) {
    if (page > 0) [reply] = kinds([{ call: 'deep_kinds', op: 'read', guide: name, offset }]);
    if (!reply || reply['error'] !== undefined || typeof reply['text'] !== 'string') {
      return { text: out, failure: `deep_kinds read guide: ${name} at offset ${offset} answers no text: ${show(reply ?? null, 800)}` };
    }
    out += reply['text'];
    if (reply['truncated'] !== true) return { text: out };
    const next = reply['next'];
    if (typeof next !== 'number' || next <= offset) return { text: out, failure: `the guide ${name}'s page at ${offset} is cut but names no later offset: ${show(next ?? null)}` };
    offset = next;
  }
  return { text: out, failure: `the guide ${name} runs past 64 pages` };
}

/**
 * The guide the skill's craft line names: each word of the skill's craft lines read as a guide through deep_kinds, in
 * one run; every word answered with text is a guide the agent is sent to, and their texts are joined in the skill's
 * order. `failures` name the guide missing (no word of the craft lines is a guide deep_kinds serves) or a page refused.
 */
function guideNamed(skill: string): { names: string[]; text: string; failures: string[] } {
  const { lines, words } = craftWords(skill);
  if (!words.length) return { names: [], text: '', failures: ['the skill has no line that says "craft", so it names no guide for the craft checks'] };
  const replies = kinds(words.map((guide) => ({ call: 'deep_kinds', op: 'read', guide })));
  const names: string[] = [];
  const texts: string[] = [];
  const failures: string[] = [];
  words.forEach((w, i) => {
    const r = replies[i]!;
    if (r['error'] !== undefined || typeof r['text'] !== 'string') return;
    names.push(w);
    const g = guideText(w, r);
    if (g.failure) failures.push(g.failure);
    texts.push(g.text);
  });
  if (!names.length) {
    failures.push(`the guide is missing: no word of the skill's craft line(s) is a guide deep_kinds serves (op: read, guide: <word> answered no text for each of ${words.length} words: ${words.join(', ')}); the lines: ${show(lines, 1200)}`);
  }
  return { names, text: texts.join('\n\n'), failures };
}

/** Text as an agent reads it: no backticks or bold, white space collapsed, case ignored. */
const normalize = (t: string): string => t.replace(/`|\*\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
/**
 * Each check whose description, threshold or fix the guide doesn't hold after the check's name (within the 2,500
 * characters that follow some mention of it), as a sentence naming the check and what is missing.
 */
function drift(guide: string, stated: Map<string, Statement>): string[] {
  const s = normalize(guide);
  const out: string[] = [];
  for (const [check, st] of stated) {
    const name = check.toLowerCase();
    const starts: number[] = [];
    for (let i = s.indexOf(name); i >= 0; i = s.indexOf(name, i + 1)) starts.push(i);
    if (!starts.length) { out.push(`${check}: the guide doesn't name it`); continue; }
    const parts = Object.entries(st) as [keyof Statement, string][];
    const best = starts.map((i) => parts.filter(([, v]) => !s.slice(i, i + 2500).includes(normalize(v)))).sort((a, b) => a.length - b.length)[0]!;
    for (const [k, v] of best) out.push(`${check}: the guide lacks its ${k} as the check states it: "${v}"`);
  }
  return out;
}

describe(`${AC[3]} the text an agent reads for every craft@1 check is the check's own (redraft 2697: the guide)`, () => {
  it(`${AC[3]} every craft@1 check states its description, threshold and fix, the guide the skill names holds each, and a drift either way is reported (redraft 2697)`, () => {
    const { found, failures } = statements();
    expect(failures, `the craft@1 checks' own statements (deep_kinds):\n  ${failures.join('\n  ')}`).toEqual([]);
    const skill = readFileSync(SKILL, 'utf8');
    const guide = guideNamed(skill);
    expect(guide.failures, `the guide the skill's craft line names, read through deep_kinds:\n  ${guide.failures.join('\n  ')}`).toEqual([]);
    const drifted = drift(guide.text, found);
    expect(drifted, `the guide (${guide.names.join(', ')}) against the checks' own statements:\n  ${drifted.join('\n  ')}`).toEqual([]);

    // The test fails when they drift: a guide whose shot_length threshold is one off in its first number, and checks
    // whose shot_length description changed, are each reported against shot_length.
    const own = found.get('shot_length')!;
    const changed = own.threshold.replace(/\d+(?:\.\d+)?/, (m) => String(Number(m) + 1));
    expect(changed, `shot_length's threshold states a number: "${own.threshold}"`).not.toBe(own.threshold);
    const off = normalize(guide.text).split(normalize(own.threshold)).join(normalize(changed));
    expect(drift(off, found).some((l) => l.startsWith('shot_length:')), 'a guide with shot_length\'s threshold changed is reported against shot_length').toBe(true);
    const moved = new Map(found);
    moved.set('shot_length', { ...own, description: `${own.description} Unless the brief says otherwise.` });
    expect(drift(guide.text, moved).some((l) => l.startsWith('shot_length:')), 'a check whose description changed is reported against shot_length').toBe(true);
  }, TIMEOUT);
});
