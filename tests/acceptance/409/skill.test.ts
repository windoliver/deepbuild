// #409.b866029a (AC3): "The skill's text for every craft@1 check matches the check's own description, threshold and
// fix, by a test that fails when they drift"
//
// Surfaces (README: The checks' own statements, The skill): each craft@1 check states its description, threshold and
// fix as an entry of the document check registry, read through `deep_kinds` (`{op: list, registry:
// check.kind.doc@1}`, every page); the skill is skills/deepbuild/SKILL.md as the checkout holds it.
//
// asserts: the listing holds one entry from the craft@1 pack for each of the sixteen checks the issue lists, each with
// a description of its own (not the listing's stand-in), a threshold and a fix; the skill holds, after each check's
// name, that check's description, threshold and fix (compared without backticks or bold, white space collapsed, case
// ignored). The same comparison reports drift: the skill with shot_length's threshold changed by one in its first
// number, and the checks' statements with shot_length's description changed, are each reported against shot_length.
// Wrong programs: the base (no craft@1 entries; the skill names no craft check), and a skill written by hand or from
// another source, which drifts from what the check states.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO } from '../407/helpers.ts';
import { AC, CHECKS, FULL, PROCESSES, SESSIONS, TIMEOUT, arr, isObject, obj, run, show, useBuilds, useFolders, type JsonObject, type JsonValue } from './helpers.ts';

const bin = useBuilds([FULL]);
const folder = useFolders();
const SKILL = join(REPO, 'skills/deepbuild/SKILL.md');

/** What a check states of itself. */
interface Statement { description: string; threshold: string; fix: string }
const text = (v: JsonValue | undefined): string | null => (typeof v === 'string' ? v : null);

/** Every page of the document check registry's listing: its entries. */
function entries(): JsonObject[] {
  const out: JsonObject[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 50; page++) {
    const call: JsonObject = { call: 'deep_kinds', op: 'list', registry: 'check.kind.doc@1', ...(cursor ? { cursor } : {}) };
    const [reply] = run(bin(FULL), { evidence: folder(), sessions: SESSIONS, processes: PROCESSES, panels: {}, docs: {}, calls: [call] });
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

/** Text as an agent reads it: no backticks or bold, white space collapsed, case ignored. */
const normalize = (t: string): string => t.replace(/`|\*\*/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
/**
 * Each check whose description, threshold or fix the skill doesn't hold after the check's name (within the 2,500
 * characters that follow some mention of it), as a sentence naming the check and what is missing.
 */
function drift(skill: string, stated: Map<string, Statement>): string[] {
  const s = normalize(skill);
  const out: string[] = [];
  for (const [check, st] of stated) {
    const name = check.toLowerCase();
    const starts: number[] = [];
    for (let i = s.indexOf(name); i >= 0; i = s.indexOf(name, i + 1)) starts.push(i);
    if (!starts.length) { out.push(`${check}: the skill doesn't name it`); continue; }
    const parts = Object.entries(st) as [keyof Statement, string][];
    const best = starts.map((i) => parts.filter(([, v]) => !s.slice(i, i + 2500).includes(normalize(v)))).sort((a, b) => a.length - b.length)[0]!;
    for (const [k, v] of best) out.push(`${check}: the skill lacks its ${k} as the check states it: "${v}"`);
  }
  return out;
}

describe(`${AC[3]} the skill's text for every craft@1 check is the check's own`, () => {
  it(`${AC[3]} every craft@1 check states its description, threshold and fix, the skill holds each, and a drift either way is reported`, () => {
    const { found, failures } = statements();
    expect(failures, `the craft@1 checks' own statements (deep_kinds):\n  ${failures.join('\n  ')}`).toEqual([]);
    const skill = readFileSync(SKILL, 'utf8');
    const drifted = drift(skill, found);
    expect(drifted, `the skill against the checks' own statements:\n  ${drifted.join('\n  ')}`).toEqual([]);

    // The test fails when they drift: a skill whose shot_length threshold is one off in its first number, and checks
    // whose shot_length description changed, are each reported against shot_length.
    const own = found.get('shot_length')!;
    const changed = own.threshold.replace(/\d+(?:\.\d+)?/, (m) => String(Number(m) + 1));
    expect(changed, `shot_length's threshold states a number: "${own.threshold}"`).not.toBe(own.threshold);
    const off = normalize(skill).split(normalize(own.threshold)).join(normalize(changed));
    expect(drift(off, found).some((l) => l.startsWith('shot_length:')), 'a skill with shot_length\'s threshold changed is reported against shot_length').toBe(true);
    const moved = new Map(found);
    moved.set('shot_length', { ...own, description: `${own.description} Unless the brief says otherwise.` });
    expect(drift(skill, moved).some((l) => l.startsWith('shot_length:')), 'a check whose description changed is reported against shot_length').toBe(true);
  }, TIMEOUT);
});
