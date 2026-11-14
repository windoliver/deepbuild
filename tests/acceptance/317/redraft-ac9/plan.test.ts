// AC9 of #317, redrafted blind from the issue, docs/technical-design.md and the suite's helpers (README.md here).
// Every decision comes from the real deep-hook binary run as Claude Code's PreToolUse hook entry; no planted call
// is ever run. The hub, when up, is a real `deep hub run` whose HOME is a temp folder.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildDeepHook, cleanup, decide, decision, defaultRules, denialText, expectAllowed, expectDenied, hubWords,
  makeRepo, sh, shForms, shown, without, world, type Call, type Mode, type Rules, type World,
} from '../helpers.ts';

/** `#317.<first 8 hex of SHA-256 of the criterion's text>`, as ../README.md computes it. */
const ID = '#317.80848a53';
const PLANTED = 'deep restore ~/backup';
const TWIN_GIT = 'git restore src/cart.ts';
const TWIN_STATUS = 'deep status';

/** The session works in a real checkout where `src/cart.ts` is tracked and the tree is clean. */
const checkout = () => makeRepo({ 'src/cart.ts': 'export const cart = [];\n', 'README': 'shop\n' }).dir;

/** Names of the installed entries whose `reason` and `next_step` both appear whole in a denial. */
function carriedBy(text: string, rules: Rules): string[] {
  return Object.entries(rules.entries).filter(([, g]) => g.reason && g.next_step && text.includes(g.reason) && text.includes(g.next_step)).map(([n]) => n);
}

/**
 * The criterion's check in one world: the planted call in its four forms, then the twins. The planted call's
 * direct form is checked first, so a deep-hook that lets it through fails here naming it.
 *
 * `git restore src/cart.ts` with the hub stopped: the design's "Discarded edits are destructive too" denies a
 * restore of paths with the hub down, by its own entry. So with the hub stopped the twin must be allowed by the
 * `deep restore` entries (`restoreEntries`), and with every default installed it may be denied only in another
 * entry's words. With the hub up, on this clean tree, it must be allowed outright (README.md).
 */
async function criterion(w: World, restoreEntries: Rules): Promise<void> {
  await expectDenied(w, shForms(PLANTED));
  await expectAllowed(w, [sh(TWIN_STATUS)]);
  if (w.mode !== 'stopped') {
    await expectAllowed(w, [sh(TWIN_GIT)]);
    return;
  }
  const alone = await world({ rules: restoreEntries, mode: 'stopped', cwd: w.s.cwd });
  await expectAllowed(alone, [sh(TWIN_GIT)]);
  const ran = await decide(w, sh(TWIN_GIT));
  const d = decision(ran);
  if (d === 'allow') return;
  const by = carriedBy(denialText(ran), w.rules);
  const own = by.filter((n) => n in restoreEntries.entries);
  if (d !== 'deny' || by.length === 0 || own.length > 0) {
    throw Error(`the twin \`${TWIN_GIT}\` ${hubWords(w.mode)} must be allowed, or denied only by an entry other than \`${PLANTED}\`'s (${Object.keys(restoreEntries.entries).join(', ')}); it was ${d} in the words of [${by.join(', ')}]: ${shown(ran)}`);
  }
}

describe(`AC9 ${ID} an agent's \`deep restore\` is denied with the hub stopped and up, naming the command, while its twins are allowed (redraft)`, () => {
  let defaults: Rules;
  let restoreEntries: Rules;
  let wrong: Rules;
  let removed: string[];
  let cwd: string;

  beforeAll(async () => {
    await buildDeepHook();
    defaults = defaultRules();
    cwd = checkout();
    const probe = sh(PLANTED);
    let built: Awaited<ReturnType<typeof without>> | undefined;
    let failed: unknown;
    try { built = await without(defaults, probe, cwd); } catch (e) { failed = e; }
    // An empty set stands in when no entry holds the call; the tests then fail at the first denial they need.
    removed = built?.removed ?? [];
    wrong = built?.rules ?? defaults;
    restoreEntries = { v: defaults.v, entries: Object.fromEntries(Object.entries(defaults.entries).filter(([n]) => removed.includes(n))) };
    if (failed) console.error(String(failed));
  }, 900_000);
  afterAll(cleanup, 30_000);

  for (const mode of ['stopped', 'up'] as Mode[]) {
    it(`AC9 ${ID} ${hubWords(mode)}: \`deep restore ~/backup\` directly, through sh -c, nohup and a heredoc is denied naming the command; \`git restore src/cart.ts\` and \`deep status\` are allowed (redraft)`, async () => {
      expect(removed.length, `no shipped entry, installed alone with the hub stopped, denies \`${PLANTED}\``).toBeGreaterThan(0);
      const w = await world({ rules: defaults, mode, cwd });
      await criterion(w, restoreEntries);
    }, 180_000);
  }

  it(`AC9 ${ID} a deep-hook without the \`deep restore\` entry lets the call through and fails this test, naming the call (redraft)`, async () => {
    expect(removed.length, `no shipped entry, installed alone with the hub stopped, denies \`${PLANTED}\`; the wrong program can't be made`).toBeGreaterThan(0);
    for (const mode of ['stopped', 'up'] as Mode[]) {
      const w = await world({ rules: wrong, mode, cwd });
      const call: Call = sh(PLANTED);
      const ran = await decide(w, call);
      expect(decision(ran), `the wrong program ${hubWords(mode)} must let \`${PLANTED}\` through: ${shown(ran)}`).toBe('allow');
      const failure = await criterion(w, restoreEntries).then(() => undefined, (e: unknown) => String(e));
      expect(failure, `this test must fail on the wrong program ${hubWords(mode)}`).toBeDefined();
      expect(failure).toContain(`\`${PLANTED}\` ${hubWords(mode)} must be denied`);
    }
  }, 300_000);
});
