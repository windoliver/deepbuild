// AC2: a scripted Claude Code session and a scripted Codex session each call deep_show through deep mcp with a six-item figure on their
// own claim: presented at revision 1 with a snapshot hash, the app's panel draws the figure in that agent's layer outlined with the
// session's name, and the record holds the revision by hash. A planted hub that takes the writer from the payload draws the figure as the
// other session and fails, naming the layer. These are the fast tests: agent stand-ins that present themselves as the two agents (the
// live tests, with real sessions, are in live.test.ts).
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, drawnAs, layerFailures, PLANT_WRITER, requireMacos, t26, t393, useApp, FIGURE_ITEMS } from './helpers.ts';
import { CLAUDE, CODEX, expectPresented, expectRecorded, openFigures, sessionId, showFigure, threadOf, type Who } from './figure.ts';

afterEach(cleanup, 60_000);
const appReady = useApp();

describe('AC2 a scripted Claude Code session and a scripted Codex session each call deep_show through deep mcp with a six-item figure on their own claim', () => {
  it('AC2 deep mcp lists deep_show beside the other deep_* tools', async () => {
    const f = await openFigures({ app: false });
    const names = (await t26.listTools(f.stands.get(CLAUDE.label)!)).map((t) => t.name);
    for (const tool of [...t26.REQUIRED_TOOLS, 'deep_show']) expect(names, `tools/list holds ${tool}: ${names.join(', ')}`).toContain(tool);
    expect((await t26.listTools(f.stands.get(CODEX.label)!)).map((t) => t.name), 'the Codex session\'s deep mcp lists it too').toContain('deep_show');
  }, 300_000);

  for (const who of [CLAUDE, CODEX]) {
    it(`AC2 the ${who.kind === 'codex' ? 'Codex' : 'Claude Code'} session's deep_show of the six-item figure is presented at revision 1 with a snapshot hash, drawn by the app in that agent's layer outlined with the session's name, and held by the record by hash`, async () => {
      requireMacos();
      appReady();
      const f = await openFigures({ app: true });
      const other: Who = who === CLAUDE ? CODEX : CLAUDE;
      const doc = t393.DOC.a;
      const shown = await showFigure(f, who, doc);
      await expectPresented(f, who, shown.reply);
      await f.app!.sync();
      const drawn = f.app!.drawn();
      expect(layerFailures(drawn, doc, 1, { thread: threadOf(who), name: who.name }, FIGURE_ITEMS), `the app's panel draws the figure in ${who.name}'s layer, outlined with its name`).toEqual([]);
      expect(drawnAs(drawn, doc, threadOf(other)), `nothing of it is in ${other.name}'s layer`).toEqual([]);
      await expectRecorded(f, who, doc);
    }, 600_000);
  }

  it('AC2 each agent\'s figure is drawn in its own layer, outlined with its own name, when both show theirs on the same panel', async () => {
    requireMacos();
    appReady();
    const f = await openFigures({ app: true });
    const a = await showFigure(f, CLAUDE, t393.DOC.a);
    const b = await showFigure(f, CODEX, t393.DOC.b);
    await expectPresented(f, CLAUDE, a.reply);
    await expectPresented(f, CODEX, b.reply);
    await f.app!.sync();
    const drawn = f.app!.drawn();
    expect(layerFailures(drawn, t393.DOC.a, 1, { thread: threadOf(CLAUDE), name: CLAUDE.name }, FIGURE_ITEMS)).toEqual([]);
    expect(layerFailures(drawn, t393.DOC.b, 1, { thread: threadOf(CODEX), name: CODEX.name }, FIGURE_ITEMS)).toEqual([]);
    expect(sessionId(CLAUDE), 'two sessions').not.toBe(sessionId(CODEX));
  }, 600_000);

  it('AC2 a payload that names the other session as its writer draws nothing as that session on the hub', async () => {
    requireMacos();
    appReady();
    const f = await openFigures({ app: true });
    const claimed = `agent:${threadOf(CODEX)}`;
    await showFigure(f, CLAUDE, t393.DOC.a, claimed);
    await f.app!.sync();
    expect(drawnAs(f.app!.drawn(), t393.DOC.a, threadOf(CODEX)), `the figure Claude Code sent, claiming ${claimed}, is not drawn as the Codex session`).toEqual([]);
  }, 600_000);

  it('AC2 a planted hub that takes the writer from the payload draws the figure as the other session and fails, naming the layer', async () => {
    requireMacos();
    appReady();
    const f = await openFigures({ app: true, plant: PLANT_WRITER });
    const claimed = `agent:${threadOf(CODEX)}`;
    const shown = await showFigure(f, CLAUDE, t393.DOC.a, claimed);
    await f.app!.sync();
    // The same check the real hub passes (the first test of the pair above): the figure in the calling session's layer.
    const failures = layerFailures(f.app!.drawn(), t393.DOC.a, 1, { thread: threadOf(CLAUDE), name: CLAUDE.name }, FIGURE_ITEMS);
    expect(failures.length, `the check fails on the planted hub (reply ${JSON.stringify(shown.reply).slice(0, 300)})`).toBeGreaterThan(0);
    const row = drawnAs(f.app!.drawn(), t393.DOC.a, threadOf(CODEX));
    expect(row.length, 'the planted hub drew the figure as the Codex session').toBeGreaterThan(0);
    expect(failures.join('\n'), 'the failure names the layer it was drawn in').toContain(`layer ${JSON.stringify(row[0]!.layer)}`);
    expect(failures.join('\n'), 'and the session it was drawn as').toContain(threadOf(CODEX));
  }, 600_000);
});
