// AC10 #18.e314a15a Changing a skill between two sessions shows a different digest in the second session's start
//   event.
//
// Two user skills under <home>/.claude/skills, where Claude Code loads your skills from. Between two sessions in the
// same worktree one skill's SKILL.md changes and the other stays as it was. Each session's start event (the event
// recorded for its SessionStart that carries the digests of what the session loads) must name each skill with a
// digest: the changed one's differs from the first session's, the unchanged one's is the same, so the digest is of
// the skill's files, not of the session or the time (README: AC10).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, expect, test } from 'vitest';
import { brief, buildDeepHook, cleanup, eventsUntil, hook, makeHome, makeWorktree, newestCovered, newSession, payload, shown, startHub, word, type Ev, type Hub, type Line, type Session } from './helpers.ts';

beforeAll(buildDeepHook, 900_000);
afterEach(cleanup, 30_000);

/** A user skill as Claude Code reads one: <home>/.claude/skills/<name>/SKILL.md, its frontmatter naming it. */
function writeSkill(home: string, name: string, body: string): void {
  mkdirSync(join(home, '.claude', 'skills', name), { recursive: true });
  writeFileSync(join(home, '.claude', 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: A skill for the #18 acceptance tests.\n---\n\n${body}\n`);
}

const isObj = (v: unknown): v is Line => typeof v === 'object' && v !== null && !Array.isArray(v);
const DIGEST = /^(?:sha256:)?[0-9a-f]{64}$/;
const isDigest = (v: unknown): v is string => typeof v === 'string' && DIGEST.test(v);
/** Whether a string names the skill: its name, or a path to its folder or its SKILL.md. */
const names = (text: string, skill: string): boolean => text === skill || text.endsWith(`skills/${skill}`) || text.endsWith(`skills/${skill}/SKILL.md`);
/**
 * The digests an event's data gives the skill (README: AC10): an object with a field naming the skill and one digest
 * field; a key naming the skill whose value is a digest; or a key naming it whose object value has one digest field.
 */
function digestsOf(data: unknown, skill: string): string[] {
  const found = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!isObj(node)) return;
    const values = Object.values(node);
    const digests = values.filter(isDigest);
    if (values.some((v) => typeof v === 'string' && names(v, skill)) && digests.length === 1) found.add(digests[0]!);
    for (const [key, value] of Object.entries(node)) {
      if (names(key, skill)) {
        if (isDigest(value)) found.add(value);
        else if (isObj(value)) { const inner = Object.values(value).filter(isDigest); if (inner.length === 1) found.add(inner[0]!); }
      }
      walk(value);
    }
  };
  walk(data);
  return [...found];
}

/** Each skill's digest in the session's start event: the one event of the session that gives the skills digests. */
async function startDigests(hub: Hub, s: Session, skills: readonly string[]): Promise<Record<string, string>> {
  const carrying = (all: Ev[]) => all.filter((e) => e.session === s.id && skills.some((k) => digestsOf(e.data, k).length > 0));
  const all = await eventsUntil(hub, (a) => carrying(a).length > 0, 30_000);
  const mine = all.filter((e) => e.session === s.id);
  const events = carrying(all);
  expect(events.length, `one event of session ${s.id}, recorded for its SessionStart, gives the digests of the skills it loads (${skills.join(', ')}); its events: ${mine.map(brief).join('; ') || 'none'}`).toBe(1);
  const out: Record<string, string> = {};
  for (const skill of skills) {
    const found = digestsOf(events[0]!.data, skill);
    expect(found, `session ${s.id}'s start event names skill ${skill} with one digest: ${brief(events[0]!)}`).toHaveLength(1);
    out[skill] = found[0]!;
  }
  return out;
}

test('AC10 #18.e314a15a changing a skill between two sessions shows a different digest in the second session\'s start event', async () => {
  const { tmp, home } = makeHome();
  const wt = makeWorktree(join(tmp, 'wt'));
  const changed = word('skilla');
  const kept = word('skillb');
  writeSkill(home, changed, 'Run the unit tests before you say you are done.');
  writeSkill(home, kept, 'Keep commit messages short.');
  const hub = await startHub(home);
  const version = newestCovered();

  const s1 = newSession(home, wt, version);
  const r1 = await hook(home, s1, payload(s1, 'SessionStart'));
  expect(r1.code, `SessionStart of ${s1.id}: ${shown(r1)}`).toBe(0);
  const first = await startDigests(hub, s1, [changed, kept]);
  const ended = await hook(home, s1, payload(s1, 'SessionEnd', { reason: 'prompt_input_exit' }));
  expect(ended.code, `SessionEnd of ${s1.id}: ${shown(ended)}`).toBe(0);

  writeSkill(home, changed, 'Run the unit tests and the linter before you say you are done.');

  const s2 = newSession(home, wt, version);
  const r2 = await hook(home, s2, payload(s2, 'SessionStart'));
  expect(r2.code, `SessionStart of ${s2.id}: ${shown(r2)}`).toBe(0);
  const second = await startDigests(hub, s2, [changed, kept]);

  expect(second[changed], `skill ${changed} changed between session ${s1.id} and session ${s2.id}: the second start event shows a different digest`).not.toBe(first[changed]);
  expect(second[kept], `skill ${kept} did not change between session ${s1.id} and session ${s2.id}: its digest is the same`).toBe(first[kept]);
}, 300_000);
