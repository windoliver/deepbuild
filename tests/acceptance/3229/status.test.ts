// #3229 AC4: what a session can learn of a variant through the hub. A task whose check has two held-out variants; the
// session's own `deep mcp` answers deep_status, and a `deep read ev:<digest>` of each variant's digest runs as a child of
// the session's own process, as a program its shell started does, with no hook between. The planted hub answers with the
// bytes.
import { afterEach, describe, expect, it } from 'vitest';
import { AC, claim, cleanup, cut, draft, FIXED, journaled, LIMIT, lockedDigests, Log, makeWorld, mustFail, open, PLANTS, PROMPT, sha256, shown, shownClaim, startHub, variant, variantDigests, type Claim, type Ran, type Variant } from './helpers.ts';

afterEach(cleanup, 120_000);

interface Seen { variants: Variant[]; claim: Claim; status: { text: string; error: boolean; value: unknown }; digests: string[]; reads: { call: string; ran: Ran }[] }
async function observe(plant?: string): Promise<Seen> {
  const variants = [variant(1), variant(2)];
  const w = makeWorld([draft(PROMPT, variants)]);
  const r = await Log.open(await startHub(w, plant));
  const k = await open(w, r, plant ? { env: { DEEP_HUB_PLANT: plant } } : {});
  // Every name a variant could go by: the store's, the definition's, and its plain bytes' own.
  const digests = [...new Set([...journaled(w), ...lockedDigests(k.locked), ...variants.map((v) => sha256(v.bytes))])];
  const made = await claim(k, r, FIXED(1), { runs: 3 });
  const reply = await k.s.tool('deep_status', {});
  const result = (JSON.parse(reply.text) ?? {}) as { structuredContent?: unknown; content?: { text?: string }[] };
  let value: unknown = result.structuredContent ?? result.content?.[0]?.text ?? reply.text;
  if (typeof value === 'string') try { value = JSON.parse(value) as unknown; } catch { /* words, read as they are */ }
  const reads: Seen['reads'] = [];
  for (const digest of variantDigests(w, k.locked)) {
    const call = `deep read ev:${digest}`;
    reads.push({ call, ran: await k.s.agent.send({ op: 'bash', command: call, cwd: k.s.cwd }) as unknown as Ran });
  }
  return { variants, claim: made, status: { ...reply, value }, digests, reads };
}

/**
 * Whether a reply says two of a check's variants (README, Readings): a field whose name says variants or held out holds
 * 2, `two` or a list of two, at any depth; or a sentence that says variants says 2 or two.
 */
function saysTwo(value: unknown, held = false): boolean {
  if (typeof value === 'number') return held && value === 2;
  if (typeof value === 'string') return (held || /variant|held.?out/i.test(value)) && /\b(2|two)\b/i.test(value);
  if (Array.isArray(value)) return (held && value.length === 2) || value.some((x) => saysTwo(x, held));
  if (value && typeof value === 'object') return Object.entries(value).some(([key, x]) => saysTwo(x, held || /variant|held.?out/i.test(key)));
  return false;
}
/** AC4: deep_status says two and holds no digest; each read by handle is refused, naming the variant, and prints no byte of it. */
function countNotDigests(seen: Seen): void {
  expect(seen.status.error, `deep_status answers: ${cut(seen.status.text)}`).toBe(false);
  const failures: string[] = [];
  if (!saysTwo(seen.status.value)) failures.push(`deep_status doesn't say that the task's check has two held-out variants: ${cut(JSON.stringify(seen.status.value), 3000)}`);
  for (const d of seen.digests) if (seen.status.text.includes(d)) failures.push(`deep_status holds a variant's digest, ${d}: ${cut(seen.status.text, 3000)}`);
  for (const { call, ran } of seen.reads) {
    const text = `${ran.stdout}\n${ran.stderr}`;
    const shows = seen.variants.filter((v) => text.includes(v.marker));
    if (shows.length) failures.push(`\`${call}\` from inside the session's process tree answered with the variant's bytes: ${shown(ran)}`);
    else if (ran.code === 0) failures.push(`\`${call}\` from inside the session's process tree was not refused: ${shown(ran)}`);
    else if (!/variant/i.test(text)) failures.push(`\`${call}\` from inside the session's process tree was refused without naming the variant: ${shown(ran)}`);
  }
  expect(failures, `after ${shownClaim(seen.claim)}: ${failures.join('; ')}`).toEqual([]);
}

describe(`${AC[4]} deep_status says two variants and holds neither digest; a read by handle of a variant's digest from inside the session's process tree is refused, naming the variant`, () => {
  it(`${AC[4]} deep_status counts the two variants with no digest, and deep read of each is refused, naming the variant`, async () => {
    countNotDigests(await observe());
  }, LIMIT);

  it(`${AC[4]} (wrong program ${PLANTS.answers}) a hub that answers the read with the bytes fails, naming the call`, async () => {
    const seen = await observe(PLANTS.answers);
    const answered = seen.reads.filter(({ ran }) => seen.variants.some((v) => ran.stdout.includes(v.marker)));
    expect(answered.length, `${PLANTS.answers}: the planted hub must answer a read with the variant's bytes: ${seen.reads.map(({ call, ran }) => `${call}: ${shown(ran)}`).join('; ')}`).toBeGreaterThan(0);
    await mustFail(`${PLANTS.answers} on AC4`, () => countNotDigests(seen), [answered[0]!.call]);
  }, LIMIT);
});
