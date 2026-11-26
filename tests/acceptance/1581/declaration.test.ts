// AC2 of #1581 through the real asks core and the real record: raise takes each source's example ask (the `fixture`
// of its row in ask.sources@1) and refuses it once whatever the ask carries beyond the base's eleven fields is gone.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { askSources } from '../../../packages/asks/src/index.ts';
import { openWorld, type Obj, type World } from '../318/helpers.ts';

let w: World;
beforeEach(async () => { w = await openWorld(); });
afterEach(async () => { await w.close(); });
const connection = { writer: 'core', actor: 'you', scope: 'you' };
/** The fields every ask carries at the base: a declaration is any field a source's example ask carries beyond them. */
const BASE_FIELDS = ['kind', 'question', 'options', 'recommended', 'deadline', 'fallback', 'default', 'provisional', 'owner', 'key', 'pinned_to'];

it('AC2 #1581.124656c7 An ask raised with no declaration fails its schema, naming the raiser', async () => {
  for (const source of ['deep_propose.choice', 'deep_ask.taste']) {
    const row = askSources().find((r) => r.source === source);
    if (!row) throw Error(`BLOCKED: ask.sources@1 has no row ${source}`);
    const example = { ...(row.fixture.ask as Obj), deadline: w.clock.now() + 86_400_000 };
    const declared = Object.keys(example).filter((k) => !BASE_FIELDS.includes(k));
    expect(declared, `${source}'s example ask carries a declaration of what may answer it beyond the base's fields (it carries none)`).not.toEqual([]);
    const bare: Obj = { ...example };
    for (const k of declared) delete bare[k];
    let error: unknown;
    let handle: string | undefined;
    try { handle = await w.asks.raise(connection, source, bare); } catch (e) { error = e; }
    expect(handle, `${source} raised an ask with no declaration (${declared.join(', ')} removed) and the core took it as ${String(handle)}`).toBeUndefined();
    expect(String((error as Error)?.message ?? error), 'the refusal names the raiser').toContain(source.split('.')[0]!);
    expect((await w.events('ask.created')).length, 'a refused ask reached the log').toBe(0);
    // Its twin, with the declaration, is raised.
    expect(await w.asks.raise(connection, source, example), `${source}'s example ask, declaration kept, is raised`).toMatch(/^ask:/);
    await w.close();
    w = await openWorld();
  }
});
