// AC2 a stale base rebases only when no ID the patch touches changed since, the parent a create names
// included; otherwise the patch is a conflict naming both writers and the ID, and nothing changes.
import { describe, expect, it } from 'vitest';
import {
  ASALPHA, CLI_YOU, P, W, WRITER, arrow, canonical, codes, create, isObject, issues, obj, outcome, patch, read, send, set, show, shown, sorted,
  useBinaries, useFolders, world, writerOf, type JsonObject,
} from './helpers.ts';

useBinaries();
const { evidence } = useFolders();

/** Your patch moves your node n1 on revision 0; alpha's patch, also on revision 0, creates an arrow parented to n1. */
const MOVE = patch(P(1), 0, [set('you.n1', 'items/you.n1/at/pos', [200, 40, 0])]);
const ARROW = patch(P(2), 0, [create(arrow('alpha.to-n1', 'Arrow to node 1', 'you.n1'))]);
const RESENT = patch(P(3), 1, [create(arrow('alpha.to-n1', 'Arrow to node 1', 'you.n1'))]);
const calls = (): JsonObject[] => [send(CLI_YOU, MOVE), read(), send(ASALPHA, ARROW), read(), send(ASALPHA, RESENT), read()];

const writerKey = (w: JsonObject): string => `${String(w['kind'])}:${String(w['id'])}`;

/** What the criterion asks of alpha's first patch, as failures; empty when it holds. */
function conflictFailures(reply: JsonObject, before: JsonObject, after: JsonObject): string[] {
  const out: string[] = [];
  if (outcome(reply) !== 'conflict') out.push(`alpha's patch ${P(2)} on stale base 0, whose arrow names the moved n1 as its parent, was ${outcome(reply)}, not conflict`);
  const c = reply['conflict'];
  const ids = isObject(c) && Array.isArray(c['ids']) ? c['ids'].map(String) : [];
  const writers = isObject(c) && Array.isArray(c['writers']) ? c['writers'].filter(isObject).map(writerKey) : [];
  if (!ids.includes('you.n1')) out.push(`the conflict doesn't name you.n1: ${JSON.stringify(c)}`);
  const want = sorted([writerKey(WRITER.alpha), writerKey(WRITER.you)]);
  if (JSON.stringify(sorted(writers)) !== JSON.stringify(want)) out.push(`the conflict names writers ${JSON.stringify(writers)}, not alpha and you`);
  if (!issues(reply).some((i) => i.code === 'stale_base' && i.ids.includes('you.n1'))) out.push(`no stale_base issue names you.n1: ${JSON.stringify(reply['issues'])}`);
  const [b, a] = [shown(before), shown(after)];
  if (a.rev !== b.rev || a.hash !== b.hash) out.push(`the document changed: rev ${b.rev} → ${a.rev}, hash ${b.hash} → ${a.hash}`);
  return out;
}

describe('AC2 agent A\'s patch on base r that parents an arrow to your node n1, sent after your patch moved n1, is a conflict naming A, you and n1, leaves the document byte-identical, and applies when resent on the new base', () => {
  it('AC2 alpha\'s stale patch is refused with outcome conflict naming alpha, you and n1; the document is byte-identical; resent on the new base, it applies', () => {
    const r = show(world(evidence(), calls())).replies;
    expect(outcome(r[0]!), 'your move of n1 applies').toBe('applied');
    expect(conflictFailures(r[2]!, r[1]!, r[3]!), 'the stale patch is a conflict and changes nothing').toEqual([]);
    expect(canonical(shown(r[3]!).document).bytes, 'the document\'s canonical bytes are the same as before the conflict').toBe(canonical(shown(r[1]!).document).bytes);
    expect(shown(r[3]!).document['items'], 'no arrow was created').not.toHaveProperty(['alpha.to-n1']);
    expect(outcome(r[4]!), 'the same arrow resent on the new base applies').toBe('applied');
    const doc = shown(r[5]!).document;
    expect(writerOf(doc, 'alpha.to-n1'), 'the arrow is in alpha\'s layer').toBe(W.alpha);
    expect(obj(obj(doc['items'], 'items')['alpha.to-n1'], 'the arrow')['parent'], 'parented to n1').toBe('you.n1');
    expect(obj(obj(obj(doc['items'], 'items')['you.n1'], 'n1')['at'], 'n1.at')['pos'], 'and n1 stays where you moved it').toEqual([200, 40, 0]);
  });

  it('AC2 a stale patch that touches only IDs no one changed since rebases and applies: the conflict comes from the parent it names, not from staleness alone', () => {
    const own = patch(P(4), 0, [create(arrow('alpha.to-n2', 'Arrow to node 2', 'you.n2'))]);
    const r = show(world(evidence(), [send(CLI_YOU, MOVE), send(ASALPHA, own)])).replies;
    expect(outcome(r[1]!), `alpha's patch on base 0 parents to n2, which no one changed: it rebases (${JSON.stringify(codes(r[1]!))})`).toBe('applied');
  });

  it('AC2 a planted rebase that counts only the IDs ops target applies the first patch, and this test fails on it', () => {
    const r = show(world(evidence(), calls(), { planted: 'rebase_counts_op_targets_only' })).replies;
    expect(outcome(r[2]!), 'the planted rebase applies alpha\'s first patch').toBe('applied');
    const failures = conflictFailures(r[2]!, r[1]!, r[3]!);
    expect(failures.length, 'the check fails on the planted rebase').toBeGreaterThan(0);
    expect(failures.join('\n'), 'naming the patch it applied').toContain(P(2));
  });
});
