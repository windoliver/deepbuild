// #1514 AC3: by default Claude Code reads AGENTS.md only where no CLAUDE.md sits beside it. A repo with both at its
// root: the rules page marks AGENTS.md's rules as shadowed for Claude Code (the shipped facts, for the version the
// sessions run, with no `instructionFiles` setting anywhere), and "never force-push", found only in AGENTS.md, still
// reaches a Claude Code session by #344's route: the session is told it and its record names the delivery.
//
// The world is #344's (../344/helpers.ts: #303's home, repo and hub, Claude Code sessions through the built deep-hook,
// `deep rules sync`, the page's claim lines and `session.rules_delivered`), imported, with the shipped facts.
import { afterAll, describe, expect, it } from 'vitest';
import { FORCE_PUSH, LINTER, Session, cleanupAll, deliveries, fixtureWorld, heard, ruleNamed, settle, show, startHub, stopHub, syncRules, type PageRule } from '../344/helpers.ts';
import { AC3, CLAUDE, SHADOWED, markedAs, marksFor, shownLine } from './helpers.ts';

afterAll(cleanupAll, 120_000);

/** CLAUDE.md's one rule; "never force-push" is in AGENTS.md alone. */
const CLAUDE_RULE = 'Keep each function under forty lines';
const marksShown = (rules: readonly PageRule[]): string => rules.map((r) => `${r.file}: ${shownLine(r)}`).join('\n  ') || show(rules);

describe(`${AC3} a repo with both CLAUDE.md and AGENTS.md marks AGENTS.md's rules as shadowed for Claude Code; "never force-push", found only in AGENTS.md, still reaches the session by #344's route`, () => {
  it(`${AC3} AGENTS.md's rules are marked as not reaching Claude Code, shadowed, CLAUDE.md's are not; a Claude Code session started after is told "never force-push" and its record names that delivery`, async () => {
    const w = fixtureWorld({ rootOnly: true, root: [FORCE_PUSH, LINTER], files: { 'CLAUDE.md': `# Claude\n\n- ${CLAUDE_RULE}\n` } });
    const hub = await startHub(w);
    try {
      // A session in the repo, so its rule files are on the page.
      await new Session(w).start();
      const rules = await syncRules(w);
      for (const text of [FORCE_PUSH, LINTER]) {
        const r = ruleNamed(rules, text);
        expect(r, `the rules page lists "${text}" from AGENTS.md:\n  ${show(rules)}`).toBeDefined();
        expect(r!.file, `"${text}" is AGENTS.md's`).toBe('AGENTS.md');
        expect(markedAs(r!, CLAUDE, SHADOWED), `AC3 "${text}", in AGENTS.md beside CLAUDE.md, is marked as not reaching Claude Code, shadowed by another file:\n  ${marksShown(rules)}`).toBe(true);
      }
      const claudeRule = ruleNamed(rules, CLAUDE_RULE);
      expect(claudeRule, `the rules page lists CLAUDE.md's "${CLAUDE_RULE}":\n  ${show(rules)}`).toBeDefined();
      expect(marksFor(claudeRule!, CLAUDE), `AC3 CLAUDE.md wins beside AGENTS.md: its rule is not marked as not reaching Claude Code:\n  ${marksShown(rules)}`).toEqual([]);

      // #344's route, for a session started after the page marks the rule.
      const force = ruleNamed(rules, FORCE_PUSH)!;
      const s = new Session(w);
      const started = await s.start();
      const typed = await s.typed('tidy the release script');
      expect(heard(started, FORCE_PUSH) || heard(typed, FORCE_PUSH), `AC3 a Claude Code session in the repo is still told "${FORCE_PUSH}" at its SessionStart or first prompt; it heard:\n  ${s.hooks.map((h) => `${h.event}: ${h.ran.stdout.slice(0, 300)}`).join('\n  ')}`).toBe(true);
      const names = (e: Parameters<typeof deliveries>[0][number]): boolean => Array.isArray(e.data.rules) && (e.data.rules as unknown[]).includes(force.handle);
      const log = await settle(hub, (events) => deliveries(events, s).some(names), 15_000);
      expect(deliveries(log, s).filter(names).map((e) => e.data.via), `AC3 the session's record names the delivery of ${force.handle} ("${FORCE_PUSH}") in a session.rules_delivered event; it holds: ${JSON.stringify(deliveries(log, s).map((e) => e.data)).slice(0, 600)}`).not.toEqual([]);
    } finally {
      await stopHub(hub);
    }
  }, 300_000);
});
