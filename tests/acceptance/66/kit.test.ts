// AC6: on a recorded Linear fixture with an outside commenter, the source's work.item@1 reading marks that author
// outside, read from the project's membership; a planted reader that marks every author a collaborator fails the
// work.item@1 kit, naming the author. The fixture's team LIN has you (an admin) and kim as members; olu is a guest of
// the organization and no member of the team, and comments on LIN-43. The planted reader (fixtures/linroles) reads the
// same fixture through the hub and gives every author the role collaborator.
import { describe, expect, it } from 'vitest';
import { AC6, at, clock, grantFor, installAndLoad, memoryStore, openHost, openWorld, pkg, routedClient, YOU, type WorkKitFixture } from './helpers.ts';
import { linear, LINEAR } from './providers.ts';
import { LINEAR_KEY, linearWorld } from './worlds.ts';

const BASE = at('2026-11-02T09:00');
const FIXTURE: WorkKitFixture = { scope: 'LIN', items: ['LIN-42', 'LIN-43'], roles: { kim: 'collaborator', olu: 'outside' } };

describe(`${AC6} On a recorded Linear fixture with an outside commenter, the source's \`work.item@1\` reading marks that author outside, read from the project's membership; a planted reader that marks every author a collaborator fails the \`work.item@1\` kit, naming the author`, () => {
  it('AC6 the Linear source marks olu outside and kim, a member of the team, not; it passes the work.item@1 kit', async () => {
    const { h, source } = await linearWorld(BASE);
    const task = await h.fix(YOU, 'LIN-43');
    const readings = (await h.workEvents(task.task_ref)).map((e) => e.reading);
    const roleOf = (handle: string) => readings.flatMap((r) => r.authors).filter((a) => a.handle === handle).map((a) => a.role);
    expect(roleOf('olu'), `olu's comment is read, olu marked outside: ${JSON.stringify(readings.map((r) => r.authors))}`).toEqual(['outside']);
    expect(roleOf('kim').length, 'kim\'s comment is read').toBe(1);
    expect(roleOf('kim')[0], 'kim is a member of the team').not.toBe('outside');
    const kit = await h.workKit(source, FIXTURE);
    expect(kit, `the shipped Linear source passes the work.item@1 kit: ${JSON.stringify(kit)}`).toEqual({ verdict: 'PASS', failures: [] });
  }, 300_000);

  it('AC6 (wrong program) the planted reader that marks every author a collaborator fails the kit, naming olu', async () => {
    const c = clock(BASE);
    const lin = await linear(c, BASE);
    const h = await openHost(await openWorld(c), { secrets: memoryStore(), http: routedClient({ [LINEAR]: lin.p }).client });
    const planted = await installAndLoad(h, await pkg('linroles'), grantFor(LINEAR));
    await h.enterSecret(YOU, planted.id, 'linear_key', LINEAR_KEY);
    const kit = await h.workKit('ext.linroles.issues', FIXTURE);
    expect(kit.verdict).toBe('FAIL');
    expect(kit.failures.join('\n'), 'the failure names the author').toMatch(/\bolu\b/);
  }, 300_000);
});
