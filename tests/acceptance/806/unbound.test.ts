// AC3: a deep_show call from a deep mcp process bound to no session is refused and draws nothing, and the record gains no revision.
// The process is one the test starts by hand, so no session's agent is above it (#26's "by hand"); sessions exist beside it, so what
// refuses it is the binding and not an empty world.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, deepShow, drawnAs, events, evidenceRoot, requireMacos, t393, useApp, FIGURE, FIGURE_SIZE, aboutDoc } from './helpers.ts';
import { CLAUDE, CODEX, openFigures, showFigure, threadOf } from './figure.ts';

afterEach(cleanup, 60_000);
const appReady = useApp();

const CALL = { doc: t393.DOC.a, document: FIGURE, t: '0s', size: FIGURE_SIZE, include: ['issues', 'pixels'] };

describe('AC3 a deep_show call from a deep mcp process bound to no session is refused and draws nothing, and the record gains no revision', () => {
  it('AC3 the call is refused with no_session and no snapshot, and the record and the evidence store gain nothing', async () => {
    const f = await openFigures({ app: false });
    const before = { events: await events(f.hub), evidence: t393.evidenceHashes(evidenceRoot(f.home)) };
    const { reply, isError } = await deepShow(f.hand, CALL, 'deep_show from a deep mcp bound to no session');
    expect(isError, 'a refused deep_show is #393\'s reply, not a protocol error').toBe(false);
    expect(reply['outcome'], `the call is refused (${JSON.stringify(reply).slice(0, 400)})`).toBe('refused');
    expect(reply['code'], 'with the code no_session').toBe('no_session');
    expect(reply['snapshots'] ?? [], 'and no snapshot').toEqual([]);
    expect(reply['rev'], 'at no revision').toBeUndefined();
    const after = await events(f.hub);
    expect(aboutDoc(after, t393.DOC.a).map((e) => [e.kind, e.data]), 'the record gains no event about the document, so no revision').toEqual([]);
    const gained = after.slice(before.events.length).filter((e) => JSON.stringify(e.data ?? {}).includes(t393.DOC.a) || (e.data && 'hash' in e.data && 'rev' in e.data));
    expect(gained.map((e) => e.kind), 'nor any event with a revision and a hash').toEqual([]);
    expect(t393.evidenceHashes(evidenceRoot(f.home)), 'the evidence store gains nothing: no issue list, no snapshot, no revision').toEqual(before.evidence);
  }, 300_000);

  it('AC3 the same call, once a session\'s agent makes it, is the call that works: the refusal is the binding\'s', async () => {
    const f = await openFigures({ app: false });
    const unbound = (await deepShow(f.hand, CALL, 'deep_show from a deep mcp bound to no session')).reply;
    expect(unbound['outcome']).toBe('refused');
    const bound = await showFigure(f, CLAUDE, t393.DOC.a);
    expect(bound.reply['outcome'], 'from the Claude Code session\'s own deep mcp the same figure is presented').toBe('presented');
    const written = aboutDoc(await events(f.hub), t393.DOC.a).filter((e) => e.data?.rev !== undefined);
    expect(written.map((e) => e.session), 'and the one revision the record gained is that session\'s').toEqual([threadOf(CLAUDE)]);
  }, 300_000);

  it('AC3 the app draws nothing for the refused call', async () => {
    requireMacos();
    appReady();
    const f = await openFigures({ app: true });
    await deepShow(f.hand, CALL, 'deep_show from a deep mcp bound to no session');
    await f.app!.sync();
    const drawn = f.app!.drawn().filter((d) => d.doc.toLowerCase().endsWith(t393.DOC.a.toLowerCase()));
    expect(drawn, 'the app drew no revision of the document').toEqual([]);
    for (const who of [CLAUDE, CODEX]) expect(drawnAs(f.app!.drawn(), t393.DOC.a, threadOf(who)), `nothing is drawn as ${who.name}`).toEqual([]);
  }, 300_000);
});
