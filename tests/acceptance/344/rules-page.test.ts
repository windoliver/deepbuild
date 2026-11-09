// The rules page (#344): every rule you wrote with its file, its scope and what enforces it, the size of each in tokens,
// and a rule in Codex's file reaching a Claude Code session. README: Invented surfaces, `deep rules sync` and the
// claim-line fields `file`, `scope`, `enforcer` and `tokens`.
import { afterAll, describe, expect, it } from 'vitest';
import {
  APP_RULE, COPILOT_RULE, FORCE_PUSH, LINTER, NEVER_PUSH, NPM_TEST, RENDER_RULE, Session, addGuard, badGuard, cleanupAll, fixtureWorld, goodGuard, heard, ruleFiles, ruleNamed,
  show, startHub, stopHub, syncRules, told, type Hub,
} from './helpers.ts';

afterAll(cleanupAll, 120_000);
const REBASE = 'never rebase published branches';
const KINDS = ['check', 'guard', 'requirement', 'text'];

describe('#344 the rules page', () => {
  it('AC2 #344.4280c950 the rules page shows what enforces each rule, and a text-only rule is listed as such', async () => {
    const w = fixtureWorld({ root: [NEVER_PUSH, LINTER, FORCE_PUSH] });
    const hub: Hub = await startHub(w);
    try {
      const added = await addGuard(w, goodGuard('no-force-push', FORCE_PUSH, 'git push --force'));
      expect(added.code, `the guard that enforces "${FORCE_PUSH}" installs (its planted call is denied, its twin allowed)`).toBe(0);
      const s = new Session(w);
      await s.start();
      const rules = await syncRules(w);
      const listed = show(rules);
      expect(rules.length, `the rules page lists the rules of every rule file:\n  ${listed}`).toBeGreaterThan(0);
      for (const r of rules) expect(KINDS, `the enforcer of "${r.text}" is one of a check, a guard, a requirement or text only:\n  ${listed}`).toContain(r.enforcer.kind);
      const lint = ruleNamed(rules, LINTER);
      expect(lint?.enforcer.kind, `"${LINTER}" has nothing enforcing it, so the page lists it as text only:\n  ${listed}`).toBe('text');
      const force = ruleNamed(rules, FORCE_PUSH);
      expect(force?.enforcer, `"${FORCE_PUSH}" is enforced by the guard no-force-push:\n  ${listed}`).toMatchObject({ kind: 'guard', name: 'no-force-push' });
    } finally {
      await stopHub(hub);
    }
  }, 240_000);

  it('AC3 #344.a8ce0546 a rule in Codex\'s rule file reaches a Claude Code session, and the rules page shows what enforces it', async () => {
    const w = fixtureWorld({ rootOnly: true, codex: [FORCE_PUSH, NPM_TEST] });
    const hub: Hub = await startHub(w);
    try {
      expect((await addGuard(w, goodGuard('no-force-push', FORCE_PUSH, 'git push --force'))).code, 'the guard installs').toBe(0);
      const rules = await syncRules(w);
      const listed = show(rules);
      for (const rule of [NPM_TEST, FORCE_PUSH]) {
        const r = ruleNamed(rules, rule);
        expect(r, `the rules page lists "${rule}" from Codex's ~/.codex/AGENTS.md:\n  ${listed}`).toBeDefined();
        expect(r!.file, `"${rule}" names Codex's file`).toMatch(/\.codex\/AGENTS\.md$/);
      }
      expect(ruleNamed(rules, NPM_TEST)!.enforcer.kind, `"${NPM_TEST}" reads text only`).toBe('text');
      expect(ruleNamed(rules, FORCE_PUSH)!.enforcer, `"${FORCE_PUSH}" shows the guard that enforces it`).toMatchObject({ kind: 'guard', name: 'no-force-push' });
      const claude = new Session(w);
      await claude.start();
      const typed = await claude.typed('fix the login page');
      for (const rule of [NPM_TEST, FORCE_PUSH]) {
        expect(told(claude, rule).length > 0 || heard(typed, rule), `a Claude Code session started after the sync is told Codex's rule "${rule}" (its SessionStart or first prompt carries it); it heard:\n  ${claude.hooks.map((h) => `${h.event}: ${h.ran.stdout.slice(0, 300)}`).join('\n  ')}`).toBe(true);
      }
    } finally {
      await stopHub(hub);
    }
  }, 240_000);

  it('AC6 #344.bc7c40dc a rule whose guard entry fails its planted call reads text only on the rules page; a page that lists that guard as its enforcer fails, naming the rule', async () => {
    const w = fixtureWorld({ rootOnly: true, root: [FORCE_PUSH, REBASE] });
    // The `installs-unchecked` plant (#304) lets the entry whose planted call goes through into rules.json without its install check.
    const hub: Hub = await startHub(w, { plant: 'installs-unchecked' });
    try {
      expect((await addGuard(w, goodGuard('no-force-push', FORCE_PUSH, 'git push --force'))).code, 'the sound guard is added').toBe(0);
      expect((await addGuard(w, badGuard('no-rebase-published', REBASE, 'git rebase --onto'))).code, 'the guard whose planted call goes through is in rules.json').toBe(0);
      await new Session(w).start();
      const rules = await syncRules(w);
      const listed = show(rules);
      expect(ruleNamed(rules, FORCE_PUSH)?.enforcer, `the control: "${FORCE_PUSH}" has a guard whose planted call is denied and twin allowed:\n  ${listed}`).toMatchObject({ kind: 'guard', name: 'no-force-push' });
      const rebase = ruleNamed(rules, REBASE);
      expect(rebase, `the rules page lists "${REBASE}":\n  ${listed}`).toBeDefined();
      expect(rebase!.enforcer, `the page names the guard ${'no-rebase-published'} as the enforcer of "${REBASE}", but its planted call is not denied: it must read text only:\n  ${listed}`).toEqual({ kind: 'text' });
    } finally {
      await stopHub(hub);
    }
  }, 240_000);

  it('AC7 #344.91134104 the rules page lists every rule from the root AGENTS.md, the nested packages/app/AGENTS.md, .github/copilot-instructions.md and render.instructions.md, each with its file and its scope', async () => {
    const w = fixtureWorld();
    const hub: Hub = await startHub(w);
    try {
      await new Session(w).start();
      const rules = await syncRules(w);
      const listed = show(rules);
      const want: { text: string; file: string; scope: RegExp }[] = [
        { text: NEVER_PUSH, file: 'AGENTS.md', scope: /^all$/ },
        { text: LINTER, file: 'AGENTS.md', scope: /^all$/ },
        { text: APP_RULE, file: 'packages/app/AGENTS.md', scope: /^packages\/app(\/\*\*)?\/?$/ },
        { text: COPILOT_RULE, file: '.github/copilot-instructions.md', scope: /^all$/ },
        { text: RENDER_RULE, file: '.github/instructions/render.instructions.md', scope: /^packages\/dev\/\*\*\/\*\.ts$/ },
      ];
      const missing = want.filter((x) => !ruleNamed(rules, x.text));
      expect(missing.map((m) => m.text), `a reader that sees only root files misses the nested, Copilot and applyTo rules (it misses ${missing.length} here); the page lists:\n  ${listed}`).toEqual([]);
      for (const x of want) {
        const r = ruleNamed(rules, x.text)!;
        expect(r.file, `"${x.text}" names its file`).toBe(x.file);
        expect(r.scope, `"${x.text}" shows its scope (a root file's applies everywhere, a nested one's to its folder, an applyTo file's to its glob)`).toMatch(x.scope);
      }
    } finally {
      await stopHub(hub);
    }
  }, 240_000);

  it('scope: the rules page shows each rule\'s size in tokens and each rule file\'s total', async () => {
    const w = fixtureWorld();
    const hub: Hub = await startHub(w);
    try {
      await new Session(w).start();
      const rules = await syncRules(w);
      const files = ruleFiles(w);
      expect(rules.length, 'the page lists rules').toBeGreaterThan(0);
      for (const r of rules) expect(Number.isInteger(r.tokens) && r.tokens > 0, `"${r.text}" shows its size in tokens (a positive whole number), not ${String(r.tokens)}`).toBe(true);
      expect(Math.max(...rules.map((r) => r.tokens)), 'a rule of more words is not the smallest').toBeGreaterThan(Math.min(...rules.map((r) => r.tokens)));
      for (const file of new Set(rules.map((r) => r.file))) {
        const total = files.find((f) => f.file === file);
        const sum = rules.filter((r) => r.file === file).reduce((n, r) => n + r.tokens, 0);
        expect(total, `the page shows ${file}'s total in tokens (a deep:rule-file line)`).toBeDefined();
        expect(total!.tokens, `${file}'s total is at least its rules' ${sum}`).toBeGreaterThanOrEqual(sum);
      }
    } finally {
      await stopHub(hub);
    }
  }, 240_000);
});
