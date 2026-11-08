// A rule becomes a removal lesson (#344, offered through #111's keep-or-remove list): when its enforcer is a guard that
// passed its last install check, or when its path scope matched no session's tool call in the last 60 days. Declining
// is remembered; taking one runs a configuration eval (#112) first. README: Invented surfaces, `why`, `deep memory
// keep|remove` and DEEP_HUB_TEST_EVAL.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  FORCE_PUSH, LEGACY_RULE, LINTER, RENDER_RULE, Session, addGuard, badGuard, cleanupAll, deep, fixtureWorld, goodGuard, inboxAsks, lessons, lessonsFor, listed, ruleNamed, seedSessions,
  settle, shown, startHub, stopHub, syncRules, type World,
} from './helpers.ts';

afterAll(cleanupAll, 120_000);
const REBASE = 'never rebase published branches';
const TYPED = 'never amend published tags';

describe('#344 removal lessons', () => {
  it('AC13 #344.9052e54a "never force-push" enforced by a guard whose planted call is denied lists a removal lesson naming the guard; with the planted call failing there is no lesson and the rule reads text only; a rule you typed is never offered', async () => {
    const w = fixtureWorld({ rootOnly: true, root: [FORCE_PUSH, REBASE, LINTER] });
    const hub = await startHub(w, { plant: 'installs-unchecked' });
    try {
      expect((await addGuard(w, goodGuard('no-force-push', FORCE_PUSH, 'git push --force'))).code, 'the sound guard installs').toBe(0);
      expect((await addGuard(w, badGuard('no-rebase-published', REBASE, 'git rebase --onto'))).code, 'the guard whose planted call goes through is in rules.json').toBe(0);
      expect((await addGuard(w, goodGuard('no-amend-tags', TYPED, 'git tag -f'))).code, 'a sound guard for the rule you will type').toBe(0);
      const s = new Session(w);
      await s.start();
      await s.typed(`rule: ${TYPED}.`);
      const rules = await syncRules(w);
      const all = await lessons(w);
      const force = lessonsFor(all, FORCE_PUSH);
      expect(force.length, `a rule file with "${FORCE_PUSH}" enforced by a passing guard lists one removal lesson; the list is:\n  ${listed(all)}`).toBe(1);
      expect(force[0]!.kind, 'it is a removal lesson').toBe('removal');
      expect(String(force[0]!.why), `the lesson says which: it names the guard no-force-push`).toContain('no-force-push');
      expect(lessonsFor(all, REBASE), `with the guard's planted call failing there is no lesson for "${REBASE}":\n  ${listed(all)}`).toEqual([]);
      expect(ruleNamed(rules, REBASE)?.enforcer, `and the rule reads text only on the rules page`).toEqual({ kind: 'text' });
      expect(lessonsFor(all, TYPED), `"${TYPED}" was typed in a session, so it is never offered though its guard passes:\n  ${listed(all)}`).toEqual([]);
      expect(lessonsFor(all, LINTER), 'a text-only rule with no scope is no lesson').toEqual([]);
      expect(inboxAsks(await settle(hub, () => true, 0), FORCE_PUSH), 'a lesson raises no ask').toEqual([]);
    } finally {
      await stopHub(hub);
    }
  }, 300_000);

  it('AC14 #344.8b8dd0f4 a rule scoped to legacy/** that no session touched in 60 days lists a removal lesson naming the count; a rule scoped to a folder touched last week does not', async () => {
    const w = fixtureWorld({ files: { '.github/instructions/legacy.instructions.md': `---\napplyTo: "legacy/**"\n---\n\n- ${LEGACY_RULE}\n` } });
    // A session touched packages/dev last week; the only one that touched legacy/ did so 90 days ago.
    await seedSessions(w, [{ daysAgo: 10, reads: ['packages/dev/src/a.ts'] }, { daysAgo: 90, reads: ['legacy/old.ts'] }]);
    const hub = await startHub(w);
    try {
      const rules = await syncRules(w);
      expect(ruleNamed(rules, LEGACY_RULE)?.scope, 'the legacy rule is scoped to legacy/**').toBe('legacy/**');
      const all = await lessons(w);
      const legacy = lessonsFor(all, LEGACY_RULE);
      expect(legacy.length, `no session touched legacy/** in the last 60 days (the one that did, 90 days ago, doesn't count), so it lists a removal lesson:\n  ${listed(all)}`).toBe(1);
      expect(legacy[0]!.kind).toBe('removal');
      expect(String(legacy[0]!.why), 'the lesson names the count (0 sessions) and the 60 days').toMatch(/\b0\b.*\b60\b|\b60\b.*\b0\b/s);
      expect(lessonsFor(all, RENDER_RULE), `the rule scoped to packages/dev, touched last week, is no lesson:\n  ${listed(all)}`).toEqual([]);
    } finally {
      await stopHub(hub);
    }
  }, 240_000);

  it('AC15 #344.b9bc3486 declining a lesson doesn\'t bring it back while the rule\'s text is unchanged', async () => {
    const w = fixtureWorld({ rootOnly: true, root: [FORCE_PUSH, LINTER] });
    const hub = await startHub(w);
    try {
      expect((await addGuard(w, goodGuard('no-force-push', FORCE_PUSH, 'git push --force'))).code).toBe(0);
      await new Session(w).start();
      await syncRules(w);
      const before = lessonsFor(await lessons(w), FORCE_PUSH);
      expect(before.length, 'the lesson is offered once').toBe(1);
      const kept = await deep(w, ['memory', 'keep', before[0]!.id]);
      expect(kept.code, `declining (keeping the rule): ${shown(kept)}`).toBe(0);
      expect(lessonsFor(await lessons(w), FORCE_PUSH), `a declined lesson leaves the list`).toEqual([]);
      const again = await syncRules(w);
      const list = await lessons(w);
      expect(ruleNamed(again, FORCE_PUSH), 'the rule is still on the page').toBeDefined();
      expect(lessonsFor(list, FORCE_PUSH), `a list that raises the declined lesson again fails, naming the rule "${FORCE_PUSH}" (its text is unchanged):\n  ${listed(list)}`).toEqual([]);
    } finally {
      await stopHub(hub);
    }
  }, 240_000);

  it('AC16 #344.0ee7b472 taking a removal the eval reads as a regression leaves the file byte-identical and names the tasks', async () => {
    const w: World = fixtureWorld({ rootOnly: true, root: [FORCE_PUSH, LINTER] });
    const evalFile = join(w.tmp, 'eval.json');
    writeFileSync(evalFile, `${JSON.stringify({ outcome: 'regresses', broke: ['task-alpha', 'task-beta'] })}\n`);
    const hub = await startHub(w, { eval: evalFile });
    try {
      expect((await addGuard(w, goodGuard('no-force-push', FORCE_PUSH, 'git push --force'))).code).toBe(0);
      await new Session(w).start();
      await syncRules(w);
      const lesson = lessonsFor(await lessons(w), FORCE_PUSH)[0];
      expect(lesson, 'the lesson to take is offered').toBeDefined();
      const file = join(w.repo, 'AGENTS.md');
      const bytes = readFileSync(file);
      const held = await deep(w, ['memory', 'remove', lesson!.id]);
      expect(readFileSync(file).equals(bytes), `a removal the eval reads as a regression leaves AGENTS.md byte-identical: ${shown(held)}`).toBe(true);
      const said = `${held.stdout}\n${held.stderr}`;
      for (const task of ['task-alpha', 'task-beta']) expect(said, `it names the task ${task} the eval says broke`).toContain(task);

      // The control: an eval that doesn't read as a regression lets the line go, and only the line.
      writeFileSync(evalFile, `${JSON.stringify({ outcome: 'adopt', broke: [] })}\n`);
      const taken = await deep(w, ['memory', 'remove', lesson!.id]);
      expect(taken.code, `with an eval that adopts, taking the removal works: ${shown(taken)}`).toBe(0);
      const after = readFileSync(file, 'utf8');
      expect(after, 'the removal takes the line out of the file').not.toContain(FORCE_PUSH);
      expect(after, 'and only that line').toContain(LINTER);
    } finally {
      await stopHub(hub);
    }
  }, 300_000);
});
